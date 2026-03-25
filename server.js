require('dotenv').config();
const express    = require('express');
const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const db   = require('./db');
const { generateOfferPDF, generateMSAPDF } = require('./pdf');

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDisplayDate(isoDate) {
  // "2026-02-18" → "18 February 2026"
  const d = new Date(isoDate + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatLetterDate(jsDate) {
  // e.g. "Feb 20, 2026"
  return jsDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function createTransporter() {
  const port = parseInt(process.env.SMTP_PORT || '465', 10);
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.titan.email',
    port,
    secure: port === 465,   // true for 465 (SSL), false for 587 (STARTTLS)
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    },
    tls: {
      rejectUnauthorized: false  // allow Titan's self-signed cert if present
    }
  });
}

// ─── Routes ─────────────────────────────────────────────────────────────────

// Create & send offer
app.post('/api/offers', async (req, res) => {
  const { pronounce, fname, mname, lname, position, joiningDate, stipend, duration, email } = req.body;

  if (!pronounce || !fname || !lname || !position || !joiningDate || !stipend || !duration || !email) {
    return res.status(400).json({ error: 'All required fields must be filled.' });
  }

  const id = uuidv4();
  const offerDate = formatLetterDate(new Date());

  db.createOffer({ id, pronounce, fname, mname: mname || '', lname, position, joiningDate, stipend, duration, email, offerDate, status: 'pending' });

  const offerLink = `${process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`}/offer/${id}`;
  const fullName  = `${pronounce} ${fname}${mname ? ' ' + mname : ''} ${lname}`;
  const joinDisp  = formatDisplayDate(joiningDate);

  // Fetch the full saved offer row so PDF generator has all fields
  const offerRow = db.getOffer(id);

  try {
    await sendOfferEmail({ offer: offerRow, to: email, fullName, offerLink, position, joiningDate: joinDisp, stipend, duration });
    res.json({ success: true, id, link: offerLink });
  } catch (err) {
    console.error('Email error:', err.message);
    res.json({ success: true, id, link: offerLink, emailWarning: err.message });
  }
});

// Get offer details (used by acceptance page)
app.get('/api/offers/:id', (req, res) => {
  const offer = db.getOffer(req.params.id);
  if (!offer) return res.status(404).json({ error: 'Offer not found.' });
  res.json(offer);
});

// Accept offer
app.post('/api/offers/:id/accept', async (req, res) => {
  const { signature } = req.body;
  if (!signature || !signature.trim()) return res.status(400).json({ error: 'Signature is required.' });

  const offer = db.getOffer(req.params.id);
  if (!offer) return res.status(404).json({ error: 'Offer not found.' });
  if (offer.status === 'accepted') return res.status(400).json({ error: 'This offer has already been accepted.' });

  // DD-MM-YYYY
  const now = new Date();
  const dd   = String(now.getDate()).padStart(2, '0');
  const mm   = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();
  const acceptedDate = `${dd}-${mm}-${yyyy}`;

  db.acceptOffer(req.params.id, signature.trim(), acceptedDate);

  try {
    await sendAcceptanceNotification(offer, signature.trim(), acceptedDate);
  } catch (e) {
    console.error('Admin notification failed:', e.message);
  }

  res.json({ success: true, acceptedDate });
});

// Serve SPA for /offer/:id
app.get('/offer/:id', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'offer.html'));
});

// ─── MSA Routes ─────────────────────────────────────────────────────────────

// Create & send MSA
app.post('/api/msa', async (req, res) => {
  const { clientName, clientCompanyType, clientAddress, clientGSTIN, clientSignatory, services, termLength, paymentTerms, clientEmail } = req.body;

  if (!clientName || !clientCompanyType || !clientAddress || !clientGSTIN || !clientSignatory || !services || !termLength || !paymentTerms || !clientEmail) {
    return res.status(400).json({ error: 'All required fields must be filled.' });
  }

  const id = uuidv4();
  const now = new Date();
  const dd   = String(now.getDate()).padStart(2, '0');
  const mm   = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();
  const dateStr = `${dd}/${mm}/${yyyy}`;

  db.createMsa({ 
    id, clientName, clientCompanyType, clientAddress, clientGSTIN, clientSignatory, 
    services, termLength, paymentTerms, clientEmail, date: dateStr, status: 'pending' 
  });

  const msaLink = `${process.env.BASE_URL || 'http://localhost:' + (process.env.PORT || 3000)}/msa/${id}`;
  const msaRow = db.getMsa(id);

  try {
    await sendMsaEmail({ msa: msaRow, to: clientEmail, msaLink });
    res.json({ success: true, id, link: msaLink });
  } catch (err) {
    console.error('Email error:', err.message);
    res.json({ success: true, id, link: msaLink, emailWarning: err.message });
  }
});

// Get MSA details
app.get('/api/msa/:id', (req, res) => {
  const msa = db.getMsa(req.params.id);
  if (!msa) return res.status(404).json({ error: 'MSA not found.' });
  res.json(msa);
});

// Accept MSA
app.post('/api/msa/:id/accept', async (req, res) => {
  const { signature, clientRole } = req.body;
  if (!signature || !signature.trim()) return res.status(400).json({ error: 'Signature is required.' });
  if (!clientRole || !clientRole.trim()) return res.status(400).json({ error: 'Role is required.' });

  const msa = db.getMsa(req.params.id);
  if (!msa) return res.status(404).json({ error: 'MSA not found.' });
  if (msa.status === 'accepted') return res.status(400).json({ error: 'This MSA has already been accepted.' });

  const now = new Date();
  const dd   = String(now.getDate()).padStart(2, '0');
  const mm   = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();
  const acceptedDate = `${dd}/${mm}/${yyyy}`;

  db.acceptMsa(req.params.id, signature.trim(), clientRole.trim(), acceptedDate);

  try {
    await sendMsaAcceptanceNotification(msa, signature.trim(), clientRole.trim(), acceptedDate);
  } catch (e) {
    console.error('Admin notification failed:', e.message);
  }

  res.json({ success: true, acceptedDate });
});

// Serve SPA for /msa/:id
app.get('/msa/:id', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'msa.html'));
});

// ─── Email senders ───────────────────────────────────────────────────────────

async function sendOfferEmail({ offer, to, fullName, offerLink, position, joiningDate, stipend, duration }) {
  const transporter = createTransporter();
  const isUnpaid = stipend === 'Unpaid';
  const stipendFormatted = isUnpaid ? 'Unpaid Internship' : '₹' + Number(stipend).toLocaleString('en-IN');

  // Generate unsigned offer letter PDF
  const pdfBuffer = await generateOfferPDF(offer, { signed: false });

  await transporter.sendMail({
    from: `"Novashield Cybertech LLP" <${process.env.EMAIL_USER}>`,
    to,
    subject: `Offer Letter – ${position} | Novashield Cybertech LLP`,
    attachments: [
      {
        filename: `Offer_Letter_${fullName.replace(/\s+/g, '_')}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf'
      }
    ],
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:30px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.10);">
        <!-- Header -->
        <tr>
          <td style="background:#fff;padding:24px 40px 20px;text-align:center;border-bottom:2px solid #00d4ff;">
              <img src="https://ucarecdn.com/789656b4-f209-4137-bfd7-c48f593d32b8/NOVALOGO1_Logo.png" alt="Novashield Cybertech LLP" style="height:64px;width:auto;object-fit:contain;display:block;margin:0 auto;" />
            </td>
          </tr>
        <!-- Body -->
        <tr>
          <td style="padding:40px;">
            <p style="color:#1e293b;font-size:16px;margin:0 0 12px;">Dear <strong>${fullName}</strong>,</p>
            <p style="color:#475569;font-size:14px;line-height:1.7;margin:0 0 24px;">
              We are delighted to offer you the position of <strong>${position}</strong> at
              <strong>Novashield Cybertech LLP</strong>. Please review the details below
              and click the button to view and accept your official offer letter.
            </p>
            <!-- Details card -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f9ff;border-left:4px solid #00d4ff;border-radius:6px;padding:20px;margin:0 0 24px;">
              <tr><td style="padding:8px 16px;color:#1e293b;font-size:14px;"><strong>Position:</strong> ${position}</td></tr>
              <tr><td style="padding:8px 16px;color:#1e293b;font-size:14px;"><strong>Joining Date:</strong> ${joiningDate}</td></tr>
              <tr><td style="padding:8px 16px;color:#1e293b;font-size:14px;"><strong>${isUnpaid ? 'Stipend' : 'Monthly Stipend'}:</strong> ${stipendFormatted}</td></tr>
              <tr><td style="padding:8px 16px;color:#1e293b;font-size:14px;"><strong>Duration:</strong> ${duration}</td></tr>
            </table>
            <!-- CTA -->
            <div style="text-align:center;margin:32px 0;">
              <a href="${offerLink}" style="display:inline-block;background:#0a0e1a;color:#00d4ff;padding:14px 36px;border-radius:6px;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:1.5px;border:1.5px solid #00d4ff;">
                VIEW &amp; ACCEPT OFFER LETTER
              </a>
            </div>
            <p style="color:#94a3b8;font-size:12px;text-align:center;">
              If the button doesn't work, copy this link into your browser:<br>
              <a href="${offerLink}" style="color:#00d4ff;">${offerLink}</a>
            </p>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:#f8fafc;padding:20px 40px;text-align:center;border-top:1px solid #e2e8f0;">
            <p style="color:#94a3b8;font-size:11px;margin:0;">
              Novashield Cybertech LLP &nbsp;|&nbsp; novashield.in &nbsp;|&nbsp; contact@novashield.in
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
  });
}

async function sendAcceptanceNotification(offer, signature, acceptedDate) {
  const transporter = createTransporter();
  const fullName = `${offer.pronounce} ${offer.fname}${offer.mname ? ' ' + offer.mname : ''} ${offer.lname}`;
  const isUnpaid = offer.stipend === 'Unpaid';
  const stipendFormatted = isUnpaid ? 'Unpaid Internship' : '₹' + Number(offer.stipend).toLocaleString('en-IN') + '/month';

  // Generate signed offer letter PDF (with signature + date pre-filled)
  const signedOffer = { ...offer, signature, acceptedDate };
  const pdfBuffer = await generateOfferPDF(signedOffer, { signed: true });

  // 1. Send notification to Admin (Novashield)
  await transporter.sendMail({
    from: `"Novashield Offer System" <${process.env.EMAIL_USER}>`,
    to: process.env.EMAIL_USER,
    subject: `✅ Offer Accepted — ${fullName} | ${offer.position}`,
    attachments: [
      {
        filename: `Accepted_Offer_Letter_${fullName.replace(/\s+/g, '_')}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf'
      }
    ],
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:30px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.10);">
        <tr><td style="background:#fff;padding:24px 40px 20px;text-align:center;border-bottom:2px solid #00d4ff;">
          <img src="https://ucarecdn.com/789656b4-f209-4137-bfd7-c48f593d32b8/NOVALOGO1_Logo.png" alt="Novashield Cybertech LLP" style="height:60px;width:auto;object-fit:contain;display:block;margin:0 auto;" />
        </td></tr>
        <tr><td style="padding:32px 40px;">
          <div style="background:#d1fae5;border-left:4px solid #10b981;padding:16px 20px;border-radius:6px;margin-bottom:24px;">
            <strong style="color:#065f46;font-size:16px;">✅ Offer Letter Accepted</strong>
            <p style="color:#065f46;margin:4px 0 0;font-size:14px;">${fullName} has accepted their offer letter.</p>
          </div>
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;">
            <tr style="background:#f8fafc;"><td style="padding:10px 14px;color:#64748b;font-weight:600;width:40%;border-bottom:1px solid #e2e8f0;">Full Name</td><td style="padding:10px 14px;color:#1e293b;border-bottom:1px solid #e2e8f0;">${fullName}</td></tr>
            <tr><td style="padding:10px 14px;color:#64748b;font-weight:600;border-bottom:1px solid #e2e8f0;">Email</td><td style="padding:10px 14px;color:#1e293b;border-bottom:1px solid #e2e8f0;">${offer.email}</td></tr>
            <tr style="background:#f8fafc;"><td style="padding:10px 14px;color:#64748b;font-weight:600;border-bottom:1px solid #e2e8f0;">Position</td><td style="padding:10px 14px;color:#1e293b;border-bottom:1px solid #e2e8f0;">${offer.position}</td></tr>
            <tr><td style="padding:10px 14px;color:#64748b;font-weight:600;border-bottom:1px solid #e2e8f0;">Joining Date</td><td style="padding:10px 14px;color:#1e293b;border-bottom:1px solid #e2e8f0;">${formatDisplayDate(offer.joiningDate)}</td></tr>
            <tr style="background:#f8fafc;"><td style="padding:10px 14px;color:#64748b;font-weight:600;border-bottom:1px solid #e2e8f0;">Stipend</td><td style="padding:10px 14px;color:#1e293b;border-bottom:1px solid #e2e8f0;">${stipendFormatted}</td></tr>
            <tr><td style="padding:10px 14px;color:#64748b;font-weight:600;border-bottom:1px solid #e2e8f0;">Duration</td><td style="padding:10px 14px;color:#1e293b;border-bottom:1px solid #e2e8f0;">${offer.duration}</td></tr>
            <tr style="background:#f8fafc;"><td style="padding:10px 14px;color:#64748b;font-weight:600;border-bottom:1px solid #e2e8f0;">Signature</td><td style="padding:10px 14px;color:#1e293b;font-style:italic;border-bottom:1px solid #e2e8f0;">${signature}</td></tr>
            <tr><td style="padding:10px 14px;color:#64748b;font-weight:600;">Accepted On</td><td style="padding:10px 14px;color:#1e293b;">${acceptedDate}</td></tr>
          </table>
        </td></tr>
        <tr><td style="background:#f8fafc;padding:16px 40px;text-align:center;border-top:1px solid #e2e8f0;">
          <p style="color:#94a3b8;font-size:11px;margin:0;">Novashield Intern Hiring System &nbsp;|&nbsp; This is an automated notification.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
  });

  // 2. Send official confirmation and signed offer to the Intern
  await transporter.sendMail({
    from: `"Novashield Cybertech LLP" <${process.env.EMAIL_USER}>`,
    to: offer.email,
    subject: `Your Accepted Offer Letter — Novashield Cybertech LLP`,
    attachments: [
      {
        filename: `Accepted_Offer_Letter_${fullName.replace(/\s+/g, '_')}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf'
      }
    ],
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:30px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.10);">
        <tr><td style="background:#fff;padding:24px 40px 20px;text-align:center;border-bottom:2px solid #00d4ff;">
          <img src="https://ucarecdn.com/789656b4-f209-4137-bfd7-c48f593d32b8/NOVALOGO1_Logo.png" alt="Novashield Cybertech LLP" style="height:60px;width:auto;object-fit:contain;display:block;margin:0 auto;" />
        </td></tr>
        <tr><td style="padding:32px 40px;">
          <p style="color:#1e293b;font-size:16px;margin:0 0 12px;">Dear <strong>${fullName}</strong>,</p>
          <p style="color:#475569;font-size:14px;line-height:1.7;margin:0 0 24px;">
            Thank you for accepting the offer for the position of <strong>${offer.position}</strong>.
            We are thrilled to welcome you to the team!
          </p>
          <p style="color:#475569;font-size:14px;line-height:1.7;margin:0 0 24px;">
            Please find attached your official, digitally signed offer letter for your records.
          </p>
          <p style="color:#475569;font-size:14px;line-height:1.7;margin:0 0 24px;">
            We look forward to working with you.
          </p>
          <p style="color:#475569;font-size:14px;line-height:1.7;margin:0;">
            Best regards,<br>
            <strong>Novashield Cybertech LLP</strong>
          </p>
        </td></tr>
        <tr><td style="background:#f8fafc;padding:16px 40px;text-align:center;border-top:1px solid #e2e8f0;">
          <p style="color:#94a3b8;font-size:11px;margin:0;">Novashield Intern Hiring System &nbsp;|&nbsp; This is an automated email.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
  });
}

// ─── MSA Email senders ───────────────────────────────────────────────────────

async function sendMsaEmail({ msa, to, msaLink }) {
  const transporter = createTransporter();
  const pdfBuffer = await generateMSAPDF(msa, { signed: false });

  await transporter.sendMail({
    from: `"Novashield Cybertech LLP" <${process.env.EMAIL_USER}>`,
    to,
    subject: `Master Service Agreement | Novashield Cybertech LLP`,
    attachments: [
      {
        filename: `MSA_${msa.clientName.replace(/\\s+/g, '_')}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf'
      }
    ],
    html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:30px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.10);">
        <tr><td style="background:#fff;padding:24px 40px 20px;text-align:center;border-bottom:2px solid #00d4ff;">
          <img src="https://ucarecdn.com/789656b4-f209-4137-bfd7-c48f593d32b8/NOVALOGO1_Logo.png" alt="Novashield Cybertech LLP" style="height:64px;width:auto;object-fit:contain;display:block;margin:0 auto;" />
        </td></tr>
        <tr><td style="padding:40px;">
          <p style="color:#1e293b;font-size:16px;margin:0 0 12px;">Dear <strong>${msa.clientSignatory}</strong>,</p>
          <p style="color:#475569;font-size:14px;line-height:1.7;margin:0 0 24px;">
            Please find attached the Master Service Agreement for cybersecurity services with <strong>Novashield Cybertech LLP</strong>.<br>
            Kindly click the button below to review and digitally sign the agreement.
          </p>
          <div style="text-align:center;margin:32px 0;">
            <a href="${msaLink}" style="display:inline-block;background:#0a0e1a;color:#00d4ff;padding:14px 36px;border-radius:6px;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:1.5px;border:1.5px solid #00d4ff;">
              REVIEW &amp; SIGN AGREEMENT
            </a>
          </div>
        </td></tr>
        <tr><td style="background:#f8fafc;padding:20px 40px;text-align:center;border-top:1px solid #e2e8f0;">
          <p style="color:#94a3b8;font-size:11px;margin:0;">Novashield Cybertech LLP &nbsp;|&nbsp; contact@novashield.in</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
  });
}

async function sendMsaAcceptanceNotification(msa, signature, clientRole, acceptedDate) {
  const transporter = createTransporter();
  const signedMsa = { ...msa, clientSignature: signature, clientRole, acceptedDate };
  const pdfBuffer = await generateMSAPDF(signedMsa, { signed: true });

  // To Admin
  await transporter.sendMail({
    from: `"Novashield Offer System" <${process.env.EMAIL_USER}>`,
    to: process.env.EMAIL_USER,
    subject: `✅ MSA Accepted — ${msa.clientName}`,
    attachments: [{ filename: `Signed_MSA_${msa.clientName.replace(/\\s+/g, '_')}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }],
    html: `<p>Client <strong>${msa.clientName}</strong> has signed their MSA on ${acceptedDate}. See attached PDF.</p>`
  });

  // To Client
  await transporter.sendMail({
    from: `"Novashield Cybertech LLP" <${process.env.EMAIL_USER}>`,
    to: msa.clientEmail,
    subject: `Your Signed Master Service Agreement — Novashield Cybertech LLP`,
    attachments: [{ filename: `Signed_MSA_${msa.clientName.replace(/\\s+/g, '_')}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }],
    html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:30px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.10);">
        <tr><td style="background:#fff;padding:24px 40px 20px;text-align:center;border-bottom:2px solid #00d4ff;">
          <img src="https://ucarecdn.com/789656b4-f209-4137-bfd7-c48f593d32b8/NOVALOGO1_Logo.png" alt="Novashield Cybertech LLP" style="height:60px;width:auto;object-fit:contain;display:block;margin:0 auto;" />
        </td></tr>
        <tr><td style="padding:32px 40px;">
          <p style="color:#1e293b;font-size:16px;margin:0 0 12px;">Dear <strong>${msa.clientSignatory}</strong>,</p>
          <p style="color:#475569;font-size:14px;line-height:1.7;margin:0 0 24px;">
            Thank you for signing the Master Service Agreement. We are thrilled to partner with you!<br>
            Please find attached your official, digitally signed copy for your records.
          </p>
          <p style="color:#475569;font-size:14px;line-height:1.7;margin:0;">Best regards,<br><strong>Novashield Cybertech LLP</strong></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
  });
}

// ─── Start ───────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
db.init().then(() => {
  app.listen(PORT, () => {
    console.log(`\n🛡️  Novashield Offer System`);
    console.log(`   Running at http://localhost:${PORT}\n`);
  });
}).catch(err => {
  console.error('Failed to initialise database:', err);
  process.exit(1);
});

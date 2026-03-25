/**
 * pdf.js — Generates offer letter PDF using puppeteer (headless Chromium)
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const LOGO_URL = 'https://ucarecdn.com/789656b4-f209-4137-bfd7-c48f593d32b8/NOVALOGO1_Logo.png';
const SIG_PATH = path.join(__dirname, 'public', 'signature.jpg');

function numberToWords(n) {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  if (n === 0) return 'Zero';
  if (n < 20) return ones[n];
  if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
  if (n < 1000) return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + numberToWords(n % 100) : '');
  if (n < 100000) return numberToWords(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + numberToWords(n % 1000) : '');
  if (n < 10000000) return numberToWords(Math.floor(n / 100000)) + ' Lakh' + (n % 100000 ? ' ' + numberToWords(n % 100000) : '');
  return numberToWords(Math.floor(n / 10000000)) + ' Crore' + (n % 10000000 ? ' ' + numberToWords(n % 10000000) : '');
}

function formatDisplayDate(isoStr) {
  const d = new Date(isoStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * Build the HTML for the offer letter (clean A4 print version).
 * @param {object} offer  - DB offer row
 * @param {object} opts   - { signed: bool }
 */
function buildHtml(offer, opts = {}) {
  const { signed = false } = opts;

  // Embed signature as base64 so headless Chrome can render it without network
  let sigDataUri = '';
  try {
    const sigBuf = fs.readFileSync(SIG_PATH);
    sigDataUri = 'data:image/jpeg;base64,' + sigBuf.toString('base64');
  } catch (e) { /* signature not found — skip */ }
  const p = offer.pronounce, f = offer.fname, m = offer.mname, l = offer.lname;
  const fullName = [p, f, m, l].filter(Boolean).join(' ');
  const dearName = [p, f].filter(Boolean).join(' ');
  const isUnpaid = offer.stipend === 'Unpaid';
  const stipNum = isUnpaid ? 0 : Number(offer.stipend);
  const stipFmt = isUnpaid ? '' : stipNum.toLocaleString('en-IN');
  const joinDisp = formatDisplayDate(offer.joiningDate);

  const acceptanceBlock = signed
    ? `
      <div class="acceptance">
        <div class="acceptance-title">ACCEPTANCE</div>
        <p class="acceptance-text">
          I, <strong>${fullName}</strong>, accept the terms and conditions stated in this offer letter.
        </p>
        <div class="acceptance-sig">
          <div class="sig-row"><span class="sig-label">Signature:</span> <em>${offer.signature}</em></div>
          <div class="sig-row"><span class="sig-label">Date:</span> ${offer.acceptedDate}</div>
        </div>
      </div>`
    : `
      <div class="acceptance">
        <div class="acceptance-title">ACCEPTANCE</div>
        <p class="acceptance-text">
          I, <strong>${fullName}</strong>, accept the terms and conditions stated in this offer letter.
        </p>
        <div class="acceptance-sig">
          <div class="sig-row"><span class="sig-label">Signature:</span> <span class="placeholder">________________________</span></div>
          <div class="sig-row"><span class="sig-label">Date:</span> <span class="placeholder">______________</span></div>
        </div>
      </div>`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:wght@300;400;500&display=swap');

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'DM Sans', Arial, sans-serif;
      color: #1a1a1a;
      background: #fff;
      padding: 0;
      margin: 0;
    }

    .page {
      width: 210mm;
      min-height: 297mm;
      padding: 10mm 18mm 18mm;
    }

    .logo-wrap {
      text-align: center;
      padding: 4mm 0 0;
    }
    .logo-wrap img {
      height: 28mm;
      width: auto;
      object-fit: contain;
    }

    .letter-title {
      font-family: 'Syne', Arial, sans-serif;
      font-size: 18pt;
      font-weight: 700;
      text-align: center;
      letter-spacing: 2px;
      margin: 1mm 0 2mm;
      color: #0a0e1a;
    }
    .rule {
      width: 50px; height: 2px;
      background: #0a0e1a;
      margin: 0 auto 6mm;
      border: none;
    }

    .date { font-size: 10pt; color: #64748b; text-align: right; margin-bottom: 5mm; }
    .to   { font-size: 11pt; margin-bottom: 1mm; }
    .subject { font-weight: 700; font-size: 11pt; margin: 4mm 0; }

    p { font-size: 11pt; line-height: 1.75; color: #374151; margin-bottom: 4mm; }

    .detail-section { font-weight: 700; font-size: 11pt; margin: 5mm 0 2mm; }
    .detail-row { font-size: 11pt; margin-bottom: 2mm; color: #1e293b; }
    .detail-row strong { font-weight: 700; }

    .note { font-size: 10pt; color: #6b7280; line-height: 1.75; margin: 4mm 0 5mm; }

    .sign-block  { margin-top: 8mm; }
    .sign-from   { font-size: 10pt; color: #374151; margin-bottom: 2mm; }
    .sign-name   { font-weight: 700; font-size: 11pt; }

    .acceptance {
      margin-top: 8mm;
      padding-top: 6mm;
      border-top: 1px solid #e2e8f0;
    }
    .acceptance-title {
      font-family: 'Syne', Arial, sans-serif;
      font-size: 12pt;
      font-weight: 700;
      letter-spacing: 1px;
      margin-bottom: 3mm;
    }
    .acceptance-text { font-size: 11pt; color: #374151; margin-bottom: 4mm; }
    .acceptance-sig  { font-size: 11pt; color: #374151; }
    .sig-row  { margin-bottom: 3mm; }
    .sig-label { font-weight: 600; }
    .placeholder { color: #94a3b8; }
  </style>
</head>
<body>
<div class="page">

  <div class="logo-wrap">
    <img src="${LOGO_URL}" alt="Novashield Cybertech LLP" />
  </div>

  <div class="letter-title">OFFER LETTER</div>
  <hr class="rule">

  <div class="date">Date: ${offer.offerDate}</div>

  <div class="to">To,</div>
  <div class="to"><strong>${fullName}</strong></div>

  <div class="subject">Subject: Offer for the Position of ${offer.position}</div>

  <p>Dear ${dearName},</p>

  <p>
    We are pleased to offer you an internship opportunity with <strong>Novashield Cybertech LLP</strong>
    for the position of <strong>${offer.position}</strong>. This internship is intended to provide
    practical exposure to cybersecurity practices, vulnerability assessment workflows, and
    responsible reporting standards.
  </p>

  <div class="detail-section">Position Details:</div>
  <div class="detail-row"><strong>Joining Date:</strong> ${joinDisp}</div>
  ${isUnpaid
      ? `<div class="detail-row"><strong>Stipend:</strong> This is an unpaid internship. However, a performance-based stipend or incentive may be provided at the discretion of the organization.</div>`
      : `<div class="detail-row"><strong>Monthly Stipend:</strong> ₹${stipFmt} (Rupees ${numberToWords(stipNum)} only)</div>`}
  <div class="detail-row"><strong>Internship Duration:</strong> ${offer.duration}</div>

  ${!isUnpaid ? `<div class="note">
    The stipend may be reviewed and increased based on your performance, quality of work,
    consistency, and contribution after a few months, at the discretion of the organization.
  </div>` : '<div style="margin-bottom:6mm;"></div>'}

  <p>We look forward to your contribution and wish you a productive learning experience with Novashield.in.</p>

  <div class="sign-block">
    <div class="sign-from">Sincerely,</div>
    ${sigDataUri ? `<img src="${sigDataUri}" alt="Signature" style="height:18mm;width:auto;display:block;margin:-3mm 0 -4mm;transform:rotate(-8deg) translateX(-2mm);position:relative;z-index:1;mix-blend-mode:multiply;object-fit:contain;" />` : ''}
    <div class="sign-name" style="position:relative;z-index:0;">Novashield Cybertech LLP</div>
  </div>

  ${acceptanceBlock}

</div>
</body>
</html>`;
}

/**
 * Generate a PDF buffer for an offer letter.
 * @param {object} offer  - DB offer row
 * @param {object} opts   - { signed: bool }
 * @returns {Buffer} PDF bytes
 */
async function generateOfferPDF(offer, opts = {}) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  try {
    const page = await browser.newPage();
    await page.setContent(buildHtml(offer, opts), { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' }
    });
    return pdf;
  } finally {
    await browser.close();
  }
}

/**
 * Build the HTML for the MSA (clean A4 print version).
 * @param {object} msa  - DB msa row
 * @param {object} opts - { signed: bool }
 */
function buildMsaHtml(msa, opts = {}) {
  const { signed = false } = opts;

  // Embed signature as base64
  let sigDataUri = '';
  try {
    const sigBuf = fs.readFileSync(SIG_PATH);
    sigDataUri = 'data:image/jpeg;base64,' + sigBuf.toString('base64');
  } catch (e) { /* signature not found — skip */ }

  const clientSignBox = signed
    ? `<strong>For the Client</strong><br>
       <img src="${msa.clientSignature}" class="nova-sig-img" style="max-height: 50px;"/><br>
       <div class="sig-row">Name: <strong>${msa.clientSignatory}</strong></div>
       <div class="sig-row">Designation: ${msa.clientRole || 'Authorized Signatory'}</div>
       <div class="sig-row">Date: <strong>${msa.acceptedDate}</strong></div>`
    : `<strong>For the Client</strong><br><br><br>
       <div class="sig-row">Name: <strong>${msa.clientSignatory}</strong></div>
       <div class="sig-row">Designation: Authorized Signatory</div>`;

  const servicesHtml = (msa.services || '').split('\n').map(s => `<li>${s.trim()}</li>`).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:wght@300;400;500&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'DM Sans', Arial, sans-serif; color: #1a1a1a; background: #fff; }
    .page { width: 210mm; min-height: 297mm; padding: 10mm 15mm 15mm; font-size: 10pt; line-height: 1.5; }
    .logo-wrap { text-align: center; padding: 0; border-bottom: 2px solid #00d4ff; margin-bottom: 3mm; padding-bottom: 2mm; }
    .logo-wrap img { height: 28mm; width: auto; object-fit: contain; mix-blend-mode: multiply; }
    h1 { font-family: 'Syne', sans-serif; font-size: 14pt; text-align: center; margin-bottom: 3mm; }
    h2 { font-size: 11pt; margin: 3mm 0 1mm; font-family: 'Syne', sans-serif; }
    p { margin-bottom: 2mm; }
    ul { margin: 0 0 2mm 5mm; }
    li { margin-bottom: 1mm; }
    .party-block { margin-bottom: 3mm; }
    .party-title { font-weight: bold; margin-bottom: 1mm; font-size: 11pt; }
    .signatures { display: flex; justify-content: space-between; margin-top: 6mm; }
    .sign-box { width: 45%; }
    .sig-row { margin-bottom: 2mm; }
    .sig-label { font-weight: 600; }
    .placeholder { color: #94a3b8; }
    .nova-sig-img { height: 14mm; margin-bottom: -3mm; margin-top: -2mm; transform: rotate(-5deg); mix-blend-mode: multiply; }
  </style>
</head>
<body>
<div class="page">
  <div class="logo-wrap"><img src="${LOGO_URL}" alt="Novashield" /></div>
  <h1>MASTER SERVICE AGREEMENT</h1>
  <p><strong>This Master Service Agreement</strong> (“Agreement”) is entered into on <strong>${msa.date}</strong> (“Effective Date”)</p>
  
  <p align="center"><strong>BETWEEN</strong></p>

  <div class="party-block">
    <div class="party-title">Novashield Cybertech LLP</div>
    <p>A Limited Liability Partnership registered under the LLP Act, 2008<br>
    Having its registered office at <strong>Pune, Maharashtra, India</strong><br>
    GSTIN: <strong>27AAAAA0000A1Z5</strong> | PAN: <strong>AAAAA0000A</strong><br>
    Represented by its Designated Partner & CEO, <strong>Mr. Nishant Lungare</strong><br>
    (hereinafter referred to as the “Service Provider” or “Novashield”)</p>
  </div>

  <p align="center"><strong>AND</strong></p>

  <div class="party-block">
    <div class="party-title">${msa.clientName}</div>
    <p>A <strong>${msa.clientCompanyType}</strong> having its registered office at <strong>${msa.clientAddress}</strong><br>
    GSTIN: <strong>${msa.clientGSTIN}</strong><br>
    Represented by its Authorized Signatory, <strong>${msa.clientSignatory}</strong><br>
    (hereinafter referred to as the “Client”)</p>
  </div>

  <h2>WHEREAS</h2>
  <p>The Service Provider is engaged in providing cybersecurity services including Vulnerability Assessment & Penetration Testing (VAPT), Bug Bounty Programs, Security Consulting, and Real-time Security Dashboard Monitoring.<br>
  The Client wishes to avail these services on the terms and conditions set forth herein.</p>

  <p><strong>NOW THEREFORE</strong>, in consideration of the mutual covenants, the parties agree as follows:</p>

  <h2>1. Services</h2>
  <p>1.1 The Service Provider shall provide the following services as per separate Statement of Work (SOW) attached or to be issued:</p>
  <ul>${servicesHtml}</ul>
  <p>1.2 All testing shall be performed only on staging/test environments unless written permission is given for production.</p>

  <h2>2. Term</h2>
  <p>This Agreement shall commence on the Effective Date and continue for <strong>${msa.termLength}</strong> unless terminated earlier.</p>

  <h2>3. Payment Terms</h2>
  <p>3.1 Fees shall be as per the approved SOW/Proforma Invoice.<br>
  3.2 Payment Schedule: <strong>${msa.paymentTerms}</strong><br>
  3.3 Taxes: GST extra at applicable rate.<br>
  3.4 Late payment: 1.5% per month.</p>

  <h2>4. Confidentiality & NDA</h2>
  <p>Both parties shall abide by the separate Non-Disclosure Agreement executed simultaneously with this MSA.</p>

  <h2>5. Intellectual Property & Reports</h2>
  <p>All reports, findings, and dashboard access remain the property of the Client after full payment. Novashield retains right to use anonymised findings for marketing/portfolio (with Client approval).</p>

  <h2>6. Limitation of Liability</h2>
  <p>Novashield’s total liability shall not exceed the fees paid in the last 12 months. Novashield follows responsible disclosure and shall not be liable for any indirect damages.</p>

  <h2>7. Termination</h2>
  <p>Either party may terminate with 30 days written notice. Upon termination, Client shall pay for all services rendered till date.</p>

  <h2>8. Governing Law & Jurisdiction</h2>
  <p>This Agreement shall be governed by the laws of India. Any disputes shall be subject to the exclusive jurisdiction of courts in Pune, Maharashtra.</p>

  <h2>9. Miscellaneous</h2>
  <ul>
    <li>Entire Agreement clause</li>
    <li>Force Majeure</li>
    <li>Electronic signatures accepted</li>
    <li>Counterparts</li>
  </ul>

  <p><strong>IN WITNESS WHEREOF</strong> the parties have executed this Agreement on the date first above written.</p>

  <div class="signatures">
    <div class="sign-box">
      <strong>For Novashield Cybertech LLP</strong><br>
      ${sigDataUri ? `<img src="${sigDataUri}" class="nova-sig-img"/><br>` : '<br><br><br>'}
      <div class="sig-row">Name: <strong>Mr. Nishant Narendra Lungare</strong></div>
      <div class="sig-row">Designation: CEO & Designated Partner</div>
      <div class="sig-row">Date: <strong>${msa.date}</strong></div>
    </div>
    <div class="sign-box">
      ${clientSignBox}
    </div>
  </div>

</div>
</body>
</html>`;
}

/**
 * Generate a PDF buffer for an MSA.
 * @param {object} msa  - DB msa row
 * @param {object} opts - { signed: bool }
 * @returns {Buffer} PDF bytes
 */
async function generateMSAPDF(msa, opts = {}) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  try {
    const page = await browser.newPage();
    await page.setContent(buildMsaHtml(msa, opts), { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' }
    });
    return pdf;
  } finally {
    await browser.close();
  }
}

module.exports = { generateOfferPDF, generateMSAPDF };


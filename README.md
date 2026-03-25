# 🛡️ Novashield Offer Letter System

A self-hosted web application for generating, sending, and collecting acceptance of internship offer letters.

---

## Features

- **Admin Form** — Fill in intern details with a live real-time preview of the offer letter
- **Email Delivery** — Sends a branded email via your Titan business email (`contact@novashield.in`)
- **Employee Acceptance Page** — Intern clicks the link, reads the letter, types their name as signature, and submits
- **Auto Date** — Acceptance date is recorded automatically in DD-MM-YYYY format
- **Admin Notification** — You receive a confirmation email when the intern accepts
- **SQLite Storage** — All offers and acceptances are stored locally; no cloud DB needed

---

## Quick Start

### 1. Prerequisites
- Node.js v18 or later
- npm

### 2. Install Dependencies

```bash
cd novashield-offer-system
npm install
```

### 3. Configure Environment

```bash
cp .env.example .env
```

Open `.env` and fill in:

| Variable     | Description                                            |
|-------------|--------------------------------------------------------|
| `PORT`       | Port to run the server (default: `3000`)              |
| `BASE_URL`   | Public URL of your server (e.g. `https://hiring.novashield.in`) |
| `EMAIL_USER` | Your Titan email: `contact@novashield.in`             |
| `EMAIL_PASS` | Your Titan email password                              |
| `SMTP_HOST`  | `smtp.titan.email` (default, no change needed)        |
| `SMTP_PORT`  | `587` (default, no change needed)                     |

### 4. Run

```bash
# Production
npm start

# Development (auto-restart on changes)
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000)

---

## How It Works

```
Admin fills form
     ↓
Clicks "Send Offer Letter"
     ↓
Server saves to SQLite + sends branded email to intern
     ↓
Intern receives email → clicks link
     ↓
Intern sees formatted offer letter
     ↓
Intern types name in Signature field → clicks Accept
     ↓
Server records acceptance with today's date
     ↓
Admin receives notification email with full details
```

---

## Deployment (Optional)

To deploy on a VPS or server:

1. Set `BASE_URL` in `.env` to your domain (e.g. `https://hiring.novashield.in`)
2. Use a process manager like `pm2`:
   ```bash
   npm install -g pm2
   pm2 start server.js --name novashield-offers
   pm2 save
   ```
3. Set up Nginx as a reverse proxy pointing to your `PORT`
4. Add SSL with Let's Encrypt

---

## File Structure

```
novashield-offer-system/
├── server.js          ← Express server + email logic
├── db.js              ← SQLite database layer
├── package.json
├── .env.example       ← Copy to .env and fill in
├── offers.db          ← Auto-created on first run
└── public/
    ├── index.html     ← Admin: offer form + live preview
    └── offer.html     ← Employee: acceptance page
```

---

## Titan SMTP Settings Reference

| Setting   | Value              |
|-----------|--------------------|
| Host      | `smtp.titan.email` |
| Port      | `587`              |
| Security  | STARTTLS           |
| Username  | Your full email    |
| Password  | Your email password|

---

*Built for Novashield Cybertech LLP — novashield.in*

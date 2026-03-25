/**
 * db.js — SQLite wrapper using sql.js (pure JS, no native compilation required)
 * Persists data to offers.db on disk using Node's fs module.
 */

const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const DB_PATH = path.join(__dirname, 'offers.db');

let db;   // sql.js Database instance (synchronous after init)

/** Save the in-memory database back to disk. Called after every write. */
function persist() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

/** Initialise sql.js and load (or create) the on-disk database. */
async function init() {
  if (db) return;   // already initialised

  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  // Create schema if it doesn't already exist
  db.run(`
    CREATE TABLE IF NOT EXISTS offers (
      id          TEXT PRIMARY KEY,
      pronounce   TEXT NOT NULL,
      fname       TEXT NOT NULL,
      mname       TEXT,
      lname       TEXT NOT NULL,
      position    TEXT NOT NULL,
      joiningDate TEXT NOT NULL,
      stipend     TEXT NOT NULL,
      duration    TEXT NOT NULL,
      email       TEXT NOT NULL,
      offerDate   TEXT NOT NULL,
      status      TEXT DEFAULT 'pending',
      signature   TEXT,
      acceptedDate TEXT,
      createdAt   TEXT DEFAULT (datetime('now'))
    )
  `);

  // Create MSA table
  db.run(`
    CREATE TABLE IF NOT EXISTS msas (
      id TEXT PRIMARY KEY,
      clientName TEXT NOT NULL,
      clientCompanyType TEXT NOT NULL,
      clientAddress TEXT NOT NULL,
      clientGSTIN TEXT NOT NULL,
      clientSignatory TEXT NOT NULL,
      services TEXT NOT NULL,
      termLength TEXT NOT NULL,
      paymentTerms TEXT NOT NULL,
      clientEmail TEXT NOT NULL,
      date TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      clientSignature TEXT,
      clientRole TEXT,
      acceptedDate TEXT,
      createdAt TEXT DEFAULT (datetime('now'))
    )
  `);

  // Try to add clientRole to existing table (ignores error if column exists)
  try {
    db.run("ALTER TABLE msas ADD COLUMN clientRole TEXT;");
  } catch (e) {
    // Column already exists
  }

  persist();
}

/** Convert a sql.js result (array of {columns, values}) to an array of plain objects. */
function toRows(results) {
  if (!results || results.length === 0) return [];
  const { columns, values } = results[0];
  return values.map(row =>
    Object.fromEntries(columns.map((col, i) => [col, row[i]]))
  );
}

// ---------------------------------------------------------------------------
// Public API — mirrors the better-sqlite3 interface used in server.js
// ---------------------------------------------------------------------------

module.exports = {
  /** Must be called once at startup before using any other method. */
  init,

  createOffer(offer) {
    db.run(`
      INSERT INTO offers
        (id, pronounce, fname, mname, lname, position, joiningDate,
         stipend, duration, email, offerDate, status)
      VALUES
        (:id, :pronounce, :fname, :mname, :lname, :position, :joiningDate,
         :stipend, :duration, :email, :offerDate, :status)
    `, {
      ':id': offer.id,
      ':pronounce': offer.pronounce,
      ':fname': offer.fname,
      ':mname': offer.mname ?? null,
      ':lname': offer.lname,
      ':position': offer.position,
      ':joiningDate': offer.joiningDate,
      ':stipend': offer.stipend,
      ':duration': offer.duration,
      ':email': offer.email,
      ':offerDate': offer.offerDate,
      ':status': offer.status ?? 'pending',
    });
    persist();
  },

  getOffer(id) {
    const results = db.exec('SELECT * FROM offers WHERE id = ?', [id]);
    const rows = toRows(results);
    return rows.length > 0 ? rows[0] : undefined;
  },

  acceptOffer(id, signature, acceptedDate) {
    db.run(
      `UPDATE offers SET status = 'accepted', signature = ?, acceptedDate = ? WHERE id = ?`,
      [signature, acceptedDate, id]
    );
    persist();
  },

  getAllOffers() {
    const results = db.exec('SELECT * FROM offers ORDER BY createdAt DESC');
    return toRows(results);
  },

  // --- MSA Methods ---

  createMsa(msa) {
    db.run(`
      INSERT INTO msas
        (id, clientName, clientCompanyType, clientAddress, clientGSTIN, clientSignatory,
         services, termLength, paymentTerms, clientEmail, date, status)
      VALUES
        (:id, :clientName, :clientCompanyType, :clientAddress, :clientGSTIN, :clientSignatory,
         :services, :termLength, :paymentTerms, :clientEmail, :date, :status)
    `, {
      ':id': msa.id,
      ':clientName': msa.clientName,
      ':clientCompanyType': msa.clientCompanyType,
      ':clientAddress': msa.clientAddress,
      ':clientGSTIN': msa.clientGSTIN,
      ':clientSignatory': msa.clientSignatory,
      ':services': msa.services,
      ':termLength': msa.termLength,
      ':paymentTerms': msa.paymentTerms,
      ':clientEmail': msa.clientEmail,
      ':date': msa.date,
      ':status': msa.status ?? 'pending',
    });
    persist();
  },

  getMsa(id) {
    const results = db.exec('SELECT * FROM msas WHERE id = ?', [id]);
    const rows = toRows(results);
    return rows.length > 0 ? rows[0] : undefined;
  },

  acceptMsa(id, signature, role, acceptedDate) {
    db.run(
      `UPDATE msas SET status = 'accepted', clientSignature = ?, clientRole = ?, acceptedDate = ? WHERE id = ?`,
      [signature, role, acceptedDate, id]
    );
    persist();
  },

  getAllMsas() {
    const results = db.exec('SELECT * FROM msas ORDER BY createdAt DESC');
    return toRows(results);
  },
};

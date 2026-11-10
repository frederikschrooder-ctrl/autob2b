'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file, { timeout: 5000 });
  if (file !== ':memory:') { try { fs.chmodSync(file, 0o600); } catch { /* ignore */ } }
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin','dealer')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
    company_name TEXT, cvr TEXT, city TEXT, phone TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS vehicles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vin TEXT NOT NULL UNIQUE,
    make TEXT NOT NULL, model TEXT NOT NULL, variant TEXT,
    first_registration TEXT, mileage INTEGER, fuel TEXT, transmission TEXT, color TEXT,
    price INTEGER NOT NULL,
    images TEXT NOT NULL DEFAULT '[]',
    condition_report_url TEXT,
    status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','reserved','sold')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE TABLE IF NOT EXISTS packages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, total_price INTEGER NOT NULL, description TEXT,
    status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','reserved','sold')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE TABLE IF NOT EXISTS package_vehicles (
    package_id INTEGER NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
    vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    PRIMARY KEY (package_id, vehicle_id)
  );
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dealer_id INTEGER NOT NULL REFERENCES users(id),
    vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
    package_id INTEGER REFERENCES packages(id) ON DELETE SET NULL,
    kind TEXT NOT NULL CHECK (kind IN ('reserve','buy')),
    status TEXT NOT NULL CHECK (status IN ('pending','confirmed','completed','cancelled','expired')),
    price INTEGER NOT NULL,
    item_label TEXT NOT NULL,
    expires_at TEXT,
    agreement TEXT,
    admin_note TEXT,
    archived_at TEXT,
    archived_by INTEGER,
    archive_note TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE TABLE IF NOT EXISTS order_corrections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id),
    previous_price INTEGER NOT NULL,
    new_price INTEGER NOT NULL,
    reason TEXT NOT NULL,
    admin_id INTEGER,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS order_vehicles (
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    vehicle_id INTEGER NOT NULL,
    PRIMARY KEY (order_id, vehicle_id)
  );
  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message TEXT NOT NULL, link TEXT,
    read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  `);
  const orderCols = db.prepare('PRAGMA table_info(orders)').all().map((c) => c.name);
  const addOrderCol = (name, ddl) => { if (!orderCols.includes(name)) db.exec(ddl); };
  addOrderCol('admin_note', 'ALTER TABLE orders ADD COLUMN admin_note TEXT');
  addOrderCol('archived_at', 'ALTER TABLE orders ADD COLUMN archived_at TEXT');
  addOrderCol('archived_by', 'ALTER TABLE orders ADD COLUMN archived_by INTEGER');
  addOrderCol('archive_note', 'ALTER TABLE orders ADD COLUMN archive_note TEXT');
  const packageCols = db.prepare('PRAGMA table_info(packages)').all().map((c) => c.name);
  if (!packageCols.includes('archived_at')) db.exec('ALTER TABLE packages ADD COLUMN archived_at TEXT');
  if (!packageCols.includes('purged_at')) db.exec('ALTER TABLE packages ADD COLUMN purged_at TEXT');
  const vehicleCols = db.prepare('PRAGMA table_info(vehicles)').all().map((c) => c.name);
  if (!vehicleCols.includes('archived_at')) db.exec('ALTER TABLE vehicles ADD COLUMN archived_at TEXT');
  if (!vehicleCols.includes('purged_at')) db.exec('ALTER TABLE vehicles ADD COLUMN purged_at TEXT');
  const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!userCols.includes('phone')) db.exec('ALTER TABLE users ADD COLUMN phone TEXT');
  addOrderCol('purged_at', 'ALTER TABLE orders ADD COLUMN purged_at TEXT');
  db.exec(`CREATE TABLE IF NOT EXISTS vehicle_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    position INTEGER NOT NULL
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS carts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dealer_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
    created_at TEXT NOT NULL
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS cart_vehicles (
    cart_id INTEGER NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
    vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
    PRIMARY KEY (cart_id, vehicle_id)
  )`);
  return db;
}
module.exports = { openDb };

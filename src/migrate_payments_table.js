// src/migrate_payments_table.js
import Database from "better-sqlite3";

const db = new Database("data.sqlite");

db.exec(`
  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,

    provider TEXT NOT NULL,
    provider_env TEXT,

    order_id TEXT NOT NULL,
    capture_id TEXT,

    status TEXT NOT NULL,
    amount TEXT,
    currency TEXT,
    payer_email TEXT,
    payer_account_id TEXT,

    raw_json TEXT,
    created_at TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_provider_order
    ON payments(provider, order_id);

  CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_provider_capture
    ON payments(provider, capture_id);
`);

console.log("✅ payments table ready");

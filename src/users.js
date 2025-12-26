import path from "path";
import sqlite3 from "sqlite3";

const dbPath = path.join(process.cwd(), "data.sqlite");
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      plan TEXT NOT NULL DEFAULT 'free',
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      subscription_status TEXT,
      current_period_end INTEGER
    )
  `);
});

export function getUserPlan(userId) {
    return new Promise((resolve, reject) => {
        db.get("SELECT plan FROM users WHERE id = ?", [userId], (err, row) => {
            if (err) return reject(err);
            resolve(row?.plan ?? "free");
        });
    });
}

export function setUserPlan(userId, plan, extra = {}) {
    const {
        stripe_customer_id = null,
        stripe_subscription_id = null,
        subscription_status = null,
        current_period_end = null,
    } = extra;

    return new Promise((resolve, reject) => {
        db.run(
            `
      INSERT INTO users (id, plan, stripe_customer_id, stripe_subscription_id, subscription_status, current_period_end)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        plan=excluded.plan,
        stripe_customer_id=COALESCE(excluded.stripe_customer_id, users.stripe_customer_id),
        stripe_subscription_id=COALESCE(excluded.stripe_subscription_id, users.stripe_subscription_id),
        subscription_status=COALESCE(excluded.subscription_status, users.subscription_status),
        current_period_end=COALESCE(excluded.current_period_end, users.current_period_end)
      `,
            [userId, plan, stripe_customer_id, stripe_subscription_id, subscription_status, current_period_end],
            (err) => (err ? reject(err) : resolve(true))
        );
    });
}

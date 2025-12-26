import path from "path";
import sqlite3 from "sqlite3";

const dbPath = path.join(process.cwd(), "data.sqlite");
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    console.log("DB:", dbPath);

    db.run(`DROP TABLE IF EXISTS users`, (err) => {
        if (err) console.error("DROP users error:", err.message);
        else console.log("Dropped table users");
    });

    db.run(
        `
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      plan TEXT NOT NULL DEFAULT 'free',
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      subscription_status TEXT,
      current_period_end INTEGER
    )
  `,
        (err) => {
            if (err) console.error("CREATE users error:", err.message);
            else console.log("Created table users with id column ✅");
        }
    );
});

db.close();

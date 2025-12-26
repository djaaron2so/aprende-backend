import { db } from "../db.js";

export function addUsage(userId, key, amount = 1) {
    const month = new Date().toISOString().slice(0, 7); // YYYY-MM
    db.prepare(
        `INSERT INTO usage (user_id, month, key, count)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, month, key) DO UPDATE SET
       count = count + excluded.count`
    ).run(userId, month, key, amount);
}

export function getUsage(userId, key) {
    const month = new Date().toISOString().slice(0, 7);
    return db.prepare(
        `SELECT count FROM usage WHERE user_id=? AND month=? AND key=?`
    ).get(userId, month, key)?.count ?? 0;
}

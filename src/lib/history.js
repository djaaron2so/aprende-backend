import { db } from "../db.js";
import { v4 as uuidv4 } from "uuid";
import { requireAuth } from "../middleware/requireAuth.js";

const insertStmt = db.prepare(`
  INSERT INTO history (id, userId, type, status, createdAt, meta)
  VALUES (?, ?, ?, ?, ?, ?)
`);

export function logHistory(userId, type, status, meta = null) {
    const id = uuidv4();
    const createdAt = Date.now();
    const metaText = meta == null ? null : JSON.stringify(meta);

    insertStmt.run(id, userId, type, status, createdAt, metaText);
    return { id, createdAt };
}

export function getHistory(userId, { limit = 50, type = null } = {}) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));

    let rows;
    if (type) {
        rows = db
            .prepare(
                `SELECT id, userId, type, status, createdAt, meta
         FROM history
         WHERE userId = ? AND type = ?
         ORDER BY createdAt DESC
         LIMIT ?`
            )
            .all(userId, type, safeLimit);
    } else {
        rows = db
            .prepare(
                `SELECT id, userId, type, status, createdAt, meta
         FROM history
         WHERE userId = ?
         ORDER BY createdAt DESC
         LIMIT ?`
            )
            .all(userId, safeLimit);
    }

    return rows.map((r) => ({
        ...r,
        meta: r.meta ? safeJsonParse(r.meta) : null,
    }));
}

function safeJsonParse(s) {
    try {
        return JSON.parse(s);
    } catch {
        return { raw: s };
    }
}

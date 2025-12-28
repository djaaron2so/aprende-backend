import { db } from "../db.js";
import { v4 as uuidv4 } from "uuid";

/**
 * Asegura que la tabla history exista (y con índices).
 * Esto evita fallos en producción si el DB se inicializa “en frío”.
 */
function ensureHistoryTable() {
    try {
        db.prepare(`
      CREATE TABLE IF NOT EXISTS history (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL,         -- 'ok' | 'error'
        createdAt INTEGER NOT NULL,   -- epoch ms
        meta TEXT                    -- JSON string
      );
    `).run();

        db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_history_user_createdAt
      ON history(userId, createdAt DESC);
    `).run();

        db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_history_user_type_createdAt
      ON history(userId, type, createdAt DESC);
    `).run();
    } catch (e) {
        // No queremos romper el server si algo raro pasa con DB.
        console.error("ensureHistoryTable failed:", e);
    }
}

function safeJsonParse(s) {
    try {
        return JSON.parse(s);
    } catch {
        return { raw: s };
    }
}

function safeMetaToText(meta) {
    if (meta == null) return null;

    let text;
    try {
        text = JSON.stringify(meta);
    } catch {
        return JSON.stringify({ note: "meta_not_serializable" });
    }

    // Evita meter metas gigantes al DB (protección)
    const MAX = 10_000; // 10KB
    if (text.length > MAX) {
        return JSON.stringify({
            note: "meta_truncated",
            length: text.length,
        });
    }

    return text;
}

// Inicializa tabla + statement una sola vez al importar el módulo
ensureHistoryTable();

const insertStmt = db.prepare(`
  INSERT INTO history (id, userId, type, status, createdAt, meta)
  VALUES (?, ?, ?, ?, ?, ?)
`);

export function logHistory(userId, type, status, meta = null) {
    const id = uuidv4();
    const createdAt = Date.now();

    // Normaliza inputs
    const safeUserId = String(userId || "").trim();
    const safeType = String(type || "").trim();
    const safeStatus = status === "ok" ? "ok" : "error"; // only ok/error

    if (!safeUserId || !safeType) {
        // No romper: solo ignora si inputs inválidos
        return { id, createdAt, skipped: true };
    }

    const metaText = safeMetaToText(meta);

    insertStmt.run(id, safeUserId, safeType, safeStatus, createdAt, metaText);
    return { id, createdAt };
}

export function getHistory(userId, { limit = 50, type = null } = {}) {
    const safeUserId = String(userId || "").trim();
    if (!safeUserId) return [];

    const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
    const safeType = type ? String(type).trim() : null;

    let rows;
    if (safeType) {
        rows = db
            .prepare(
                `SELECT id, userId, type, status, createdAt, meta
         FROM history
         WHERE userId = ? AND type = ?
         ORDER BY createdAt DESC
         LIMIT ?`
            )
            .all(safeUserId, safeType, safeLimit);
    } else {
        rows = db
            .prepare(
                `SELECT id, userId, type, status, createdAt, meta
         FROM history
         WHERE userId = ?
         ORDER BY createdAt DESC
         LIMIT ?`
            )
            .all(safeUserId, safeLimit);
    }

    return rows.map((r) => ({
        ...r,
        meta: r.meta ? safeJsonParse(r.meta) : null,
    }));
}

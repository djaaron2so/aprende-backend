import express from "express";
import { db } from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = express.Router();

/**
 * Helpers
 */
function maskId(id) {
    if (!id) return null;
    if (id.length <= 8) return id.slice(0, 2) + "…" + id.slice(-2);
    return id.slice(0, 4) + "…" + id.slice(-4);
}

function sanitizePaymentRow(row) {
    return {
        id: row.id,
        provider: row.provider,
        provider_env: row.provider_env,
        status: row.status,
        amount: row.amount,
        currency: row.currency,
        created_at: row.created_at,

        // 🔐 SOLO versiones ocultas
        order_id_masked: maskId(row.order_id),
        capture_id_masked: maskId(row.capture_id),
    };
}

/**
 * GET /api/payments
 * Lista pagos del usuario (SANITIZADO)
 */
router.get("/", requireAuth, (req, res) => {
    try {
        const userId = req.user.id;
        const limit = Math.min(parseInt(req.query.limit || "20", 10), 100);
        const offset = Math.max(parseInt(req.query.offset || "0", 10), 0);

        const items = db.prepare(`
      SELECT
        id,
        provider,
        provider_env,
        order_id,
        capture_id,
        status,
        amount,
        currency,
        payer_email,
        created_at
      FROM payments
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(userId, limit, offset);

        const total = db
            .prepare("SELECT COUNT(*) AS c FROM payments WHERE user_id = ?")
            .get(userId).c;

        res.json({
            ok: true,
            total,
            items: items.map(sanitizePaymentRow),
        });
    } catch (e) {
        console.error("GET /api/payments error:", e);
        res.status(500).json({ error: "Failed to load payments" });
    }
});

export default router;

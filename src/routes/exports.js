import { Router } from "express";
import { db } from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();

function getMonthPrefix(q) {
    const s = String(q || "").trim();
    if (/^\d{4}-\d{2}$/.test(s)) return s;
    return new Date().toISOString().slice(0, 7);
}

router.get("/exports", requireAuth, (req, res) => {
    try {
        const userId = req.user?.id || req.userId;
        if (!userId) return res.status(401).json({ error: "Unauthorized" });

        const limit = Math.min(Number(req.query.limit ?? 20), 100);
        const offset = Math.max(Number(req.query.offset ?? 0), 0);
        const monthPrefix = getMonthPrefix(req.query.month);

        const planId =
            db
                .prepare("SELECT COALESCE(plan_id, plan, 'free') AS plan_id FROM users WHERE id=?")
                .get(userId)?.plan_id || "free";

        const maxExports = Number(
            db.prepare("SELECT max_exports FROM plans WHERE id=?").get(planId)?.max_exports ??
            (planId !== "free" ? 999 : 0)
        );

        const usedThisMonth =
            db
                .prepare(
                    `SELECT COUNT(*) AS n
           FROM exports
           WHERE user_id=? AND format='mp3' AND created_at LIKE ?`
                )
                .get(userId, `${monthPrefix}%`)?.n ?? 0;

        const remainingThisMonth = Math.max(0, maxExports - usedThisMonth);

        const total =
            db
                .prepare(
                    `SELECT COUNT(*) AS n
           FROM exports
           WHERE user_id=? AND created_at LIKE ?`
                )
                .get(userId, `${monthPrefix}%`)?.n ?? 0;

        const items = db
            .prepare(
                `SELECT id, beat_id, format, size_bytes, created_at
         FROM exports
         WHERE user_id=? AND created_at LIKE ?
         ORDER BY id DESC
         LIMIT ? OFFSET ?`
            )
            .all(userId, `${monthPrefix}%`, limit, offset);

        res.set("Cache-Control", "no-store");
        return res.json({
            ok: true,
            month: monthPrefix,
            limit,
            offset,
            total,
            items,
            stats: {
                max_exports: maxExports,
                used_exports_this_month: usedThisMonth,
                remaining_exports_this_month: remainingThisMonth,
            },
        });
    } catch (e) {
        return res.status(500).json({ error: "Failed to load exports", details: String(e?.message || e) });
    }
});

export default router;

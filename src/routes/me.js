import express from "express";
import { db } from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = express.Router();

/**
 * GET /api/me
 * Devuelve user + plan + features
 * + used_exports_this_month + remaining_exports_this_month
 */
router.get("/", requireAuth, (req, res) => {
    try {
        const userId = req.user?.id; // ✅ consistente con beats.js
        if (!userId) return res.status(401).json({ error: "Unauthorized" });

        // 1) Leer usuario + plan_id (fallback a plan antiguo)
        const userRow = db
            .prepare(
                `
        SELECT id,
               COALESCE(plan_id, plan, 'free') AS plan_id
        FROM users
        WHERE id = ?
      `
            )
            .get(userId);

        const planId = userRow?.plan_id || "free";

        // 2) Leer plan (incluye max_exports)
        const planRow = db
            .prepare(
                `
        SELECT id, name, price_cents, currency, interval, features_json, max_exports
        FROM plans
        WHERE id = ? AND is_active = 1
      `
            )
            .get(planId);

        // 3) Features JSON (opcional)
        let featuresFromJson = {};
        try {
            if (planRow?.features_json) featuresFromJson = JSON.parse(planRow.features_json);
        } catch { }

        // 4) max_exports desde columna (source of truth)
        const maxExports = Number(planRow?.max_exports ?? (planId !== "free" ? 999 : 0));

        // 5) usados este mes
        const monthPrefix = new Date().toISOString().slice(0, 7); // "YYYY-MM"
        const usedThisMonth =
            db
                .prepare(
                    `SELECT COUNT(*) AS n
           FROM exports
           WHERE user_id=? AND format='mp3' AND created_at LIKE ?`
                )
                .get(userId, `${monthPrefix}%`)?.n ?? 0;

        const remainingThisMonth = Math.max(0, maxExports - usedThisMonth);

        // 6) features final
        const features = {
            mp3:
                typeof featuresFromJson.mp3 === "boolean"
                    ? featuresFromJson.mp3
                    : planId !== "free",
            pro:
                typeof featuresFromJson.pro === "boolean"
                    ? featuresFromJson.pro
                    : planId !== "free",

            max_exports: maxExports,
            used_exports_this_month: usedThisMonth,
            remaining_exports_this_month: remainingThisMonth,
        };

        res.set("Cache-Control", "no-store");
        return res.json({
            ok: true,
            user: { id: userId, plan: planId },
            plan: planRow
                ? {
                    id: planRow.id,
                    name: planRow.name,
                    price_cents: planRow.price_cents,
                    currency: planRow.currency,
                    interval: planRow.interval,
                }
                : { id: planId },
            features,
        });
    } catch (e) {
        return res.status(500).json({
            error: "Failed to load me",
            details: String(e?.message || e),
        });
    }
});

export default router;

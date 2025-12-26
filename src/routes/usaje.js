import { Router } from "express";
import { db } from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();

router.get("/usage", requireAuth, (req, res) => {
    try {
        const userId = req.user?.id || req.userId;
        if (!userId) return res.status(401).json({ error: "Unauthorized" });

        const day = new Date().toISOString().slice(0, 10);   // YYYY-MM-DD
        const month = new Date().toISOString().slice(0, 7);  // YYYY-MM

        // plan + max_exports
        const planId =
            db
                .prepare("SELECT COALESCE(plan_id, plan, 'free') AS plan_id FROM users WHERE id=?")
                .get(userId)?.plan_id || "free";

        const maxExports = Number(
            db.prepare("SELECT max_exports FROM plans WHERE id=?").get(planId)?.max_exports ??
            (planId !== "free" ? 999 : 0)
        );

        // exports mp3 del mes (por created_at ISO)
        const usedExports =
            db.prepare(
                `SELECT COUNT(*) AS n
         FROM exports
         WHERE user_id=? AND format='mp3' AND created_at LIKE ?`
            ).get(userId, `${month}%`)?.n ?? 0;

        // beats hoy (fila exacta userId+day+month)
        const todayRow = db.prepare(
            `SELECT dailyUsed
       FROM usage
       WHERE userId=? AND day=? AND month=?`
        ).get(userId, day, month);

        const beatsToday = Number(todayRow?.dailyUsed ?? 0);

        // beats mes real: suma dailyUsed del mes
        const beatsMonth =
            db.prepare(
                `SELECT COALESCE(SUM(dailyUsed), 0) AS n
         FROM usage
         WHERE userId=? AND month=?`
            ).get(userId, month)?.n ?? 0;

        res.set("Cache-Control", "no-store");
        return res.json({
            ok: true,
            day,
            month,
            plan: planId,
            exports: {
                max_exports: maxExports,
                used_exports_this_month: usedExports,
                remaining_exports_this_month: Math.max(0, maxExports - usedExports),
            },
            generation: {
                beats_generated_today: beatsToday,
                beats_generated_this_month: Number(beatsMonth),
            },
        });
    } catch (e) {
        return res.status(500).json({
            error: "Failed to load usage",
            details: String(e?.message || e),
        });
    }
});

export default router;

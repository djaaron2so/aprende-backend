import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { db } from "../db.js";
import { laDayISO, laMonthISO, LA_TZ } from "../lib/time.js";
import { getUserPlan } from "../users.js";

const router = Router();

function normalizePlanId(planId) {
    if (!planId) return "free";
    if (planId === "pro") return "pro_monthly";
    return planId;
}

function getPlanLimits(planId) {
    // Primero intentamos con columnas opcionales (si existen)
    try {
        return db
            .prepare(
                `SELECT id, max_exports, max_beats_daily, max_beats_monthly
         FROM plans
         WHERE id=?`
            )
            .get(planId);
    } catch (e) {
        // Fallback si tu tabla plans NO tiene esas columnas
        return db
            .prepare(
                `SELECT id, max_exports
         FROM plans
         WHERE id=?`
            )
            .get(planId);
    }
}

router.get("/usage", requireAuth, async (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const day = laDayISO();     // YYYY-MM-DD (LA)
    const month = laMonthISO(); // YYYY-MM (LA)

    // Plan real
    const rawPlan = await getUserPlan(userId);
    const planId = normalizePlanId(rawPlan);

    const planRow = getPlanLimits(planId);
    if (!planRow) {
        return res.status(500).json({ error: `Plan not found in DB: ${planId}` });
    }

    const maxExports = Number(planRow.max_exports ?? 0);

    // Opcionales (pueden no existir)
    const maxBeatsDaily =
        planRow.max_beats_daily === undefined ? null : Number(planRow.max_beats_daily);
    const maxBeatsMonthly =
        planRow.max_beats_monthly === undefined ? null : Number(planRow.max_beats_monthly);

    // Beats usage
    const usageRow = db
        .prepare(
            `SELECT dailyUsed, monthlyUsed
       FROM usage
       WHERE userId=? AND day=? AND month=?`
        )
        .get(userId, day, month);

    const beatsToday = Number(usageRow?.dailyUsed ?? 0);
    const beatsMonth = Number(usageRow?.monthlyUsed ?? 0);

    // Exports mp3 del mes
    const usedExports =
        Number(
            db
                .prepare(
                    `SELECT COUNT(*) AS n
           FROM exports
           WHERE user_id=? AND format='mp3' AND created_at LIKE ?`
                )
                .get(userId, `${month}%`)?.n
        ) || 0;

    const remainingExports =
        Number.isFinite(maxExports) && maxExports >= 0 ? Math.max(0, maxExports - usedExports) : 0;

    return res.json({
        ok: true,
        tz: LA_TZ,
        day,
        month,
        plan: planId,
        exports: {
            max_exports: maxExports,
            used_exports_this_month: usedExports,
            remaining_exports_this_month: remainingExports,
        },
        generation: {
            beats_generated_today: beatsToday,
            beats_generated_this_month: beatsMonth,
            max_beats_daily: maxBeatsDaily,
            max_beats_monthly: maxBeatsMonthly,
            remaining_beats_today:
                Number.isFinite(maxBeatsDaily) ? Math.max(0, maxBeatsDaily - beatsToday) : null,
            remaining_beats_this_month:
                Number.isFinite(maxBeatsMonthly) ? Math.max(0, maxBeatsMonthly - beatsMonth) : null,
        },
    });
});

export default router;

import { Router } from "express";
import { getUserPlan, setUserPlan } from "./users.js";
import { PLANS } from "./plans.js";
import { db } from "./db.js";

const r = Router();

// Auth: Authorization: Bearer <userId>
function requireUser(req, res, next) {
    const h = req.headers.authorization || "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Missing auth" });
    req.user = { id: token };
    next();
}

function nextLocalMidnightISO() {
    const now = new Date();
    const next = new Date(now);
    next.setHours(24, 0, 0, 0);
    return next.toISOString();
}

function nextLocalMonthISO() {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
    return next.toISOString();
}

r.get("/me", requireUser, (req, res) => {
    const userId = req.user.id;

    const planName = getUserPlan(userId);
    const plan = PLANS[planName] || PLANS.free;

    const day = new Date().toISOString().slice(0, 10);
    const month = new Date().toISOString().slice(0, 7);

    const row =
        db.prepare(
            `SELECT dailyUsed, monthlyUsed
       FROM usage
       WHERE userId=? AND day=? AND month=?`
        ).get(userId, day, month) || { dailyUsed: 0, monthlyUsed: 0 };

    const resetDailyAt = nextLocalMidnightISO();
    const resetMonthlyAt = nextLocalMonthISO();

    return res.json({
        userId,
        plan: planName,
        limits: {
            daily: plan.daily,
            monthly: plan.monthly,
            mp3: plan.mp3,
            bitrate: plan.bitrate,
        },
        usage: {
            day,
            month,
            dailyUsed: row.dailyUsed,
            monthlyUsed: row.monthlyUsed,
            dailyRemaining: Math.max(0, plan.daily - row.dailyUsed),
            monthlyRemaining: Math.max(0, plan.monthly - row.monthlyUsed),
        },
        resetAt: {
            daily: resetDailyAt,
            monthly: resetMonthlyAt,
        },
        upgradeRequiredForMp3: planName === "free",
        upgradeMessage: planName === "free" ? "Upgrade to Pro to download MP3." : null,
    });
});

/**
 * GET /api/me
 * Devuelve el plan del usuario autenticado
 */
router.get("/", (req, res) => {
    try {
        const userId = req.userId;

        const row = db.prepare("SELECT plan FROM users WHERE id=?").get(userId);
        const plan = row?.plan || "free";

        res.set("Cache-Control", "no-store");

        return res.json({
            ok: true,
            user: { id: userId, plan },
            features: {
                pro: plan === "pro",
                mp3: plan === "pro",
            },
        });
    } catch (e) {
        return res.status(500).json({
            error: "Failed to load /api/me",
            details: String(e?.message || e),
        });
    }
});

   ;

// ✅ Cambiar plan (manual para pruebas)
r.post("/me/plan", requireUser, (req, res) => {
    const planName = String(req.body?.plan || "").toLowerCase();

    if (!PLANS[planName]) {
        return res.status(400).json({
            error: "Invalid plan",
            allowed: Object.keys(PLANS),
        });
    }

    const updated = setUserPlan(req.user.id, planName);

    return res.json({
        ok: true,
        userId: req.user.id,
        plan: updated,
    });
});

export default r;

import { db } from "./db.js";
import { PLANS } from "./plans.js";
import { getUserPlan } from "./users.js";

function today() {
    return new Date().toISOString().slice(0, 10);
}
function month() {
    return new Date().toISOString().slice(0, 7);
}

export function enforceBeatLimits(req, res, next) {
    const userId = req.user.id;

    const planName = getUserPlan(userId);
    const plan = PLANS[planName] || PLANS.free;

    const d = today();
    const m = month();

    const row =
        db.prepare(
            `SELECT dailyUsed, monthlyUsed
       FROM usage
       WHERE userId=? AND day=? AND month=?`
        ).get(userId, d, m) || { dailyUsed: 0, monthlyUsed: 0 };

    if (row.dailyUsed >= plan.daily) {
        return res.status(429).json({ error: "Daily limit reached" });
    }
    if (row.monthlyUsed >= plan.monthly) {
        return res.status(429).json({ error: "Monthly limit reached" });
    }

    // opcional: para que /generate-beat devuelva usage actualizado
    res.locals._counts = {
        day: d,
        month: m,
        daily: row.dailyUsed,
        monthly: row.monthlyUsed,
    };

    next();
}

export function commitUsage(req, res) {
    const userId = req.user.id;
    const d = today();
    const m = month();

    // UPSERT: si no existe, inserta; si existe, incrementa
    db.prepare(
        `INSERT INTO usage (userId, day, month, dailyUsed, monthlyUsed)
     VALUES (?, ?, ?, 1, 1)
     ON CONFLICT(userId, day, month)
     DO UPDATE SET
       dailyUsed = dailyUsed + 1,
       monthlyUsed = monthlyUsed + 1`
    ).run(userId, d, m);
}

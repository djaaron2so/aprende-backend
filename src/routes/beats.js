import { Router } from "express";
import path from "path";
import fs from "fs";

import { generateBeatWav } from "../services/beatGenerator.js";
import { wavToMp3 } from "../services/mp3.js";
import { getUserPlan } from "../users.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { db } from "../db.js";
import { laDayISO, laMonthISO, LA_TZ } from "../lib/time.js";
import { createRateLimiter } from "../middleware/rateLimit.js";

const router = Router();

// ✅ Rate limiters (por userId; fallback anon)
const rlGenerateBeat = createRateLimiter({
    name: "generate-beat",
    windowMs: 60_000, // 1 min
    limit: 10,        // 10/min por user
    keyFn: (req) => `user:${req.user?.id || "anon"}`,
});

const rlMp3 = createRateLimiter({
    name: "mp3",
    windowMs: 60_000, // 1 min
    limit: 30,        // 30/min por user
    keyFn: (req) => `user:${req.user?.id || "anon"}`,
});

function isProPlan(planId) {
    return typeof planId === "string" && planId.toLowerCase().startsWith("pro");
}

// compat: si tu DB de users guarda "pro", lo mapeamos a un plan real
function normalizePlanId(planId) {
    if (!planId) return "free";
    if (planId === "pro") return "pro_monthly";
    return planId;
}

// -------- Beat limits helpers (bulletproof) --------
function getPlanBeatLimits(planId) {
    // Intentamos columnas opcionales; si no existen, no hay límites
    try {
        return db
            .prepare(
                `SELECT max_beats_daily, max_beats_monthly
         FROM plans
         WHERE id=?`
            )
            .get(planId);
    } catch {
        return { max_beats_daily: null, max_beats_monthly: null };
    }
}

function getUsageCounts(userId, day, month) {
    const row = db
        .prepare(
            `SELECT dailyUsed, monthlyUsed
       FROM usage
       WHERE userId=? AND day=? AND month=?`
        )
        .get(userId, day, month);

    return {
        dailyUsed: Number(row?.dailyUsed ?? 0),
        monthlyUsed: Number(row?.monthlyUsed ?? 0),
    };
}

function clampNumber(v, min, max, fallback) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}

function safeLimitNumber(v) {
    if (v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function remaining(limit, used) {
    if (!Number.isFinite(limit)) return null; // ilimitado
    return Math.max(0, limit - used);
}

const beatsDir = path.join(process.cwd(), "public", "beats");
const wavPathFor = (id) => path.join(beatsDir, `${id}.wav`);
const mp3PathFor = (id) => path.join(beatsDir, `${id}.mp3`);

// ------------------------------
// POST /api/generate-beat
// ------------------------------
router.post("/generate-beat", requireAuth, rlGenerateBeat, async (req, res, next) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({
                ok: false,
                error: "Unauthorized",
                code: "UNAUTHORIZED",
            });
        }

        // Plan y límites
        const rawPlanId = await getUserPlan(userId);
        const planId = normalizePlanId(rawPlanId);

        const day = laDayISO();
        const month = laMonthISO();

        const limits = getPlanBeatLimits(planId);
        const maxDaily = safeLimitNumber(limits?.max_beats_daily);
        const maxMonthly = safeLimitNumber(limits?.max_beats_monthly);

        const { dailyUsed, monthlyUsed } = getUsageCounts(userId, day, month);

        const remainingToday = remaining(maxDaily, dailyUsed);
        const remainingMonth = remaining(maxMonthly, monthlyUsed);

        // Límite diario
        if (Number.isFinite(maxDaily) && maxDaily >= 0 && dailyUsed >= maxDaily) {
            return res.status(402).json({
                ok: false,
                error: "Daily beat limit reached",
                code: "LIMIT_DAILY",
                meta: {
                    tz: LA_TZ,
                    day,
                    month,
                    plan: planId,
                    max_beats_daily: maxDaily,
                    beats_generated_today: dailyUsed,
                    remaining_beats_today: 0,
                    remaining_beats_this_month: remainingMonth,
                },
            });
        }

        // Límite mensual
        if (
            Number.isFinite(maxMonthly) &&
            maxMonthly >= 0 &&
            monthlyUsed >= maxMonthly
        ) {
            return res.status(402).json({
                ok: false,
                error: "Monthly beat limit reached",
                code: "LIMIT_MONTHLY",
                meta: {
                    tz: LA_TZ,
                    day,
                    month,
                    plan: planId,
                    max_beats_monthly: maxMonthly,
                    beats_generated_this_month: monthlyUsed,
                    remaining_beats_today: remainingToday,
                    remaining_beats_this_month: 0,
                },
            });
        }

        // Input (con límites razonables)
        const bpm = clampNumber(req.body?.bpm ?? 95, 40, 220, 95);
        const bars = clampNumber(req.body?.bars ?? 16, 1, 128, 16);
        const swing = clampNumber(req.body?.swing ?? 0, 0, 100, 0);
        const style = String(req.body?.style ?? "dembow");

        const energy = clampNumber(req.body?.energy ?? 2, 0, 10, 2);
        const density = clampNumber(req.body?.density ?? 2, 0, 10, 2);
        const humanize = clampNumber(req.body?.humanize ?? 0, 0, 100, 0);

        fs.mkdirSync(beatsDir, { recursive: true });

        const result = await generateBeatWav({
            bpm,
            bars,
            swing,
            style,
            energy,
            density,
            humanize,
        });

        const id =
            result?.id ||
            (result?.filename ? String(result.filename).replace(/\.wav$/i, "") : null);

        if (!id) {
            return res.status(500).json({
                ok: false,
                error: "Beat generator did not return id",
                code: "GENERATOR_NO_ID",
            });
        }

        // Asegurar WAV en /public/beats/<id>.wav
        const expectedWav = wavPathFor(id);

        const srcWav =
            result?.filePath ||
            result?.path ||
            (result?.filename ? path.resolve(String(result.filename)) : null);

        if (!fs.existsSync(expectedWav) && srcWav && fs.existsSync(srcWav)) {
            try {
                fs.renameSync(srcWav, expectedWav);
            } catch {
                fs.copyFileSync(srcWav, expectedWav);
            }
        }

        if (!fs.existsSync(expectedWav)) {
            return res.status(500).json({
                ok: false,
                error: "WAV not found after generation",
                code: "WAV_MISSING",
                meta: {
                    expectedWav,
                    srcWav,
                    resultKeys: Object.keys(result || {}),
                },
            });
        }

        // usage: beats generados (timezone LA) -> SOLO si ya existe WAV
        try {
            db.prepare(
                `INSERT INTO usage (userId, day, month, dailyUsed, monthlyUsed)
         VALUES (?, ?, ?, 1, 1)
         ON CONFLICT(userId, day, month) DO UPDATE SET
           dailyUsed = dailyUsed + 1,
           monthlyUsed = monthlyUsed + 1`
            ).run(userId, day, month);
        } catch (e) {
            console.error("USAGE LOG FAILED", e);
        }

        // after increment
        const usedTodayAfter = dailyUsed + 1;
        const usedMonthAfter = monthlyUsed + 1;

        const remainingTodayAfter = remaining(maxDaily, usedTodayAfter);
        const remainingMonthAfter = remaining(maxMonthly, usedMonthAfter);

        return res.json({
            ok: true,
            tz: LA_TZ,
            id,
            fileUrl: `/beats/${id}.wav`,
            usage: {
                day,
                month,
                beats_generated_today: usedTodayAfter,
                beats_generated_this_month: usedMonthAfter,
                max_beats_daily: Number.isFinite(maxDaily) ? maxDaily : null,
                max_beats_monthly: Number.isFinite(maxMonthly) ? maxMonthly : null,
                remaining_beats_today: remainingTodayAfter,
                remaining_beats_this_month: remainingMonthAfter,
            },
        });
    } catch (err) {
        return next(err);
    }
});

// ------------------------------
// GET /api/beats/:id.mp3 (solo PRO)
// + registra export + respeta max_exports MENSUAL
// ------------------------------
router.get("/beats/:id.mp3", requireAuth, rlMp3, async (req, res, next) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({
                ok: false,
                error: "Unauthorized",
                code: "UNAUTHORIZED",
            });
        }

        const rawPlanId = await getUserPlan(userId);
        if (!isProPlan(rawPlanId)) {
            return res.status(402).json({
                ok: false,
                error: "Upgrade required for MP3",
                code: "UPGRADE_REQUIRED",
            });
        }

        const planId = normalizePlanId(rawPlanId);

        const id = String(req.params.id || "").trim();
        if (!id) {
            return res.status(400).json({
                ok: false,
                error: "Missing id",
                code: "MISSING_ID",
            });
        }

        fs.mkdirSync(beatsDir, { recursive: true });

        const mp3Path = mp3PathFor(id);

        // 1) si mp3 no existe, generarlo desde wav
        if (!fs.existsSync(mp3Path)) {
            const wavPath = wavPathFor(id);
            if (!fs.existsSync(wavPath)) {
                return res.status(404).json({
                    ok: false,
                    error: "MP3 not found",
                    code: "MP3_NOT_FOUND",
                });
            }

            await wavToMp3(wavPath, mp3Path);

            if (!fs.existsSync(mp3Path)) {
                return res.status(500).json({
                    ok: false,
                    error: "MP3 generation failed",
                    code: "MP3_GEN_FAILED",
                });
            }
        }

        // 2) enforce max_exports (mensual)
        const planRow = db.prepare("SELECT max_exports FROM plans WHERE id=?").get(planId);
        if (!planRow) {
            return res.status(500).json({
                ok: false,
                error: `Plan not found in DB: ${planId}`,
                code: "PLAN_NOT_FOUND",
            });
        }

        const maxExports = Number(planRow.max_exports);
        if (!Number.isFinite(maxExports) || maxExports < 0) {
            return res.status(500).json({
                ok: false,
                error: "Invalid max_exports in DB",
                code: "PLAN_EXPORTS_INVALID",
            });
        }

        // Mes en LA
        const monthPrefix = laMonthISO(); // "YYYY-MM"

        const used =
            db
                .prepare(
                    "SELECT COUNT(*) AS n FROM exports WHERE user_id=? AND format='mp3' AND created_at LIKE ?"
                )
                .get(userId, `${monthPrefix}%`)?.n ?? 0;

        if (used >= maxExports) {
            return res.status(402).json({
                ok: false,
                error: "Export limit reached",
                code: "EXPORT_LIMIT",
                meta: {
                    month: monthPrefix,
                    used: Number(used),
                    max: Number(maxExports),
                },
            });
        }

        // 3) registrar export (upsert)
        try {
            const stat = fs.statSync(mp3Path);

            db.prepare(
                `INSERT INTO exports (user_id, beat_id, format, file_path, size_bytes, ip, user_agent)
         VALUES (?, ?, 'mp3', ?, ?, ?, ?)
         ON CONFLICT(user_id, beat_id, format) DO UPDATE SET
           file_path=excluded.file_path,
           size_bytes=excluded.size_bytes,
           ip=excluded.ip,
           user_agent=excluded.user_agent,
           created_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`
            ).run(
                userId,
                id,
                mp3Path,
                stat.size,
                req.ip || null,
                req.headers["user-agent"] || null
            );
        } catch (e) {
            console.error("EXPORT LOG FAILED", e);
        }

        return res.sendFile(mp3Path);
    } catch (err) {
        return next(err);
    }
});

export default router;

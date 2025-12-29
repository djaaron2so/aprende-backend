// src/routes/beats.js
import { Router } from "express";
import path from "path";
import fs from "fs";
import os from "os";
import crypto from "crypto";

import { generateBeatWav } from "../services/beatGenerator.js";
import { wavToMp3 } from "../services/mp3.js";
import { getUserPlan } from "../users.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { db } from "../db.js";
import { laDayISO, laMonthISO, LA_TZ } from "../lib/time.js";
import { createRateLimiter } from "../middleware/rateLimit.js";
import { logHistory } from "../lib/history.js";

import { r2PutFile, r2Exists, r2DownloadToFile, r2SignedGetUrl } from "../lib/r2.js";

const router = Router();

// ===============================
// Rate limiters (por userId)
// ===============================
const rlGenerateBeat = createRateLimiter({
    name: "generate-beat",
    windowMs: 60_000,
    limit: 10,
    keyFn: (req) => `user:${req.user?.id || "anon"}`,
});

const rlWav = createRateLimiter({
    name: "wav",
    windowMs: 60_000,
    limit: 60,
    keyFn: (req) => `user:${req.user?.id || "anon"}`,
});

const rlMp3 = createRateLimiter({
    name: "mp3",
    windowMs: 60_000,
    limit: 30,
    keyFn: (req) => `user:${req.user?.id || "anon"}`,
});

// ===============================
// Helpers
// ===============================
const beatsDir = path.join(process.cwd(), "public", "beats");
const wavPathFor = (id) => path.join(beatsDir, `${id}.wav`);

const r2KeyWav = (id) => `beats/${id}.wav`;
const r2KeyMp3 = (id) => `beats/${id}.mp3`;

function tmpFile(ext) {
    const name = `aprende-${crypto.randomUUID()}.${ext}`;
    return path.join(os.tmpdir(), name);
}

function safeLogHistory(userId, type, status, meta) {
    try {
        logHistory(userId, type, status, meta ?? null);
    } catch (e) {
        console.error("HISTORY LOG FAILED", e);
    }
}

function isProPlan(planId) {
    return typeof planId === "string" && planId.toLowerCase().startsWith("pro");
}

function normalizePlanId(planId) {
    if (!planId) return "free";
    if (planId === "pro") return "pro_monthly";
    return planId;
}

function getPlanBeatLimits(planId) {
    try {
        return db
            .prepare(`SELECT max_beats_daily, max_beats_monthly FROM plans WHERE id=?`)
            .get(planId);
    } catch {
        return { max_beats_daily: null, max_beats_monthly: null };
    }
}

function getUsageCounts(userId, day, month) {
    const row = db
        .prepare(
            `SELECT dailyUsed, monthlyUsed FROM usage WHERE userId=? AND day=? AND month=?`
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

function tableExists(name) {
    try {
        const row = db
            .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=? LIMIT 1")
            .get(name);
        return !!row;
    } catch {
        return false;
    }
}

// ===============================
// POST /api/generate-beat
// ===============================
router.post(
    "/generate-beat",
    requireAuth,
    rlGenerateBeat,
    async (req, res, next) => {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res
                    .status(401)
                    .json({ ok: false, error: "Unauthorized", code: "UNAUTHORIZED" });
            }

            const rawPlanId = await getUserPlan(userId);
            const planId = normalizePlanId(rawPlanId);

            const day = laDayISO();
            const month = laMonthISO();

            const limits = getPlanBeatLimits(planId);
            const maxDaily = safeLimitNumber(limits?.max_beats_daily);
            const maxMonthly = safeLimitNumber(limits?.max_beats_monthly);

            const { dailyUsed, monthlyUsed } = getUsageCounts(userId, day, month);

            // Limite diario
            if (Number.isFinite(maxDaily) && maxDaily >= 0 && dailyUsed >= maxDaily) {
                safeLogHistory(userId, "generate_beat", "error", {
                    code: "LIMIT_DAILY",
                    day,
                    month,
                    plan: planId,
                    max_beats_daily: maxDaily,
                    beats_generated_today: dailyUsed,
                });

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
                        remaining_beats_this_month: remaining(maxMonthly, monthlyUsed),
                    },
                });
            }

            // Limite mensual
            if (
                Number.isFinite(maxMonthly) &&
                maxMonthly >= 0 &&
                monthlyUsed >= maxMonthly
            ) {
                safeLogHistory(userId, "generate_beat", "error", {
                    code: "LIMIT_MONTHLY",
                    day,
                    month,
                    plan: planId,
                    max_beats_monthly: maxMonthly,
                    beats_generated_this_month: monthlyUsed,
                });

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
                        remaining_beats_today: remaining(maxDaily, dailyUsed),
                        remaining_beats_this_month: 0,
                    },
                });
            }

            // Input (público)
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
                safeLogHistory(userId, "generate_beat", "error", {
                    code: "GENERATOR_NO_ID",
                    bpm,
                    bars,
                    swing,
                    style,
                });

                return res.status(500).json({
                    ok: false,
                    error: "Beat generator did not return id",
                    code: "GENERATOR_NO_ID",
                });
            }

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
                safeLogHistory(userId, "generate_beat", "error", {
                    code: "WAV_MISSING",
                    id,
                    expectedWav,
                    srcWav,
                });

                return res.status(500).json({
                    ok: false,
                    error: "WAV not found after generation",
                    code: "WAV_MISSING",
                    meta: { expectedWav, srcWav, resultKeys: Object.keys(result || {}) },
                });
            }

            // Subir WAV a R2
            try {
                await r2PutFile({
                    key: r2KeyWav(id),
                    filePath: expectedWav,
                    contentType: "audio/wav",
                });
            } catch (e) {
                const details = {
                    name: e?.name,
                    message: e?.message,
                    code: e?.Code || e?.code,
                    httpStatusCode: e?.$metadata?.httpStatusCode,
                    requestId: e?.$metadata?.requestId,
                };

                console.error("R2 WAV UPLOAD FAILED", { beatId: id, ...details });

                safeLogHistory(userId, "generate_beat", "error", {
                    beatId: id,
                    reason: "r2_wav_upload_failed",
                    ...details,
                });

                return res.status(500).json({
                    ok: false,
                    error: "Failed to upload WAV",
                    code: "R2_WAV_UPLOAD_FAILED",
                    debug_marker: "BEATS_JS_V1",
                    details: {
                        name: e?.name,
                        message: e?.message,
                        code: e?.Code || e?.code,
                        httpStatusCode: e?.$metadata?.httpStatusCode,
                        requestId: e?.$metadata?.requestId,
                    },
                });

            }

            // Usage increment
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

            // Opcional: tabla beats
            if (tableExists("beats")) {
                try {
                    db.prepare(
                        `INSERT INTO beats (id, user_id, bpm, bars, swing, style, energy, density, humanize, wav_path)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               user_id=excluded.user_id,
               bpm=excluded.bpm,
               bars=excluded.bars,
               swing=excluded.swing,
               style=excluded.style,
               energy=excluded.energy,
               density=excluded.density,
               humanize=excluded.humanize,
               wav_path=excluded.wav_path,
               created_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`
                    ).run(
                        id,
                        userId,
                        bpm,
                        bars,
                        swing,
                        style,
                        energy,
                        density,
                        humanize,
                        `r2:${r2KeyWav(id)}`
                    );
                } catch (e) {
                    console.error("BEATS INSERT FAILED", e);
                }
            }

            const usedTodayAfter = dailyUsed + 1;
            const usedMonthAfter = monthlyUsed + 1;

            const remainingTodayAfter = remaining(maxDaily, usedTodayAfter);
            const remainingMonthAfter = remaining(maxMonthly, usedMonthAfter);

            safeLogHistory(userId, "generate_beat", "ok", { beatId: id, bpm, style });

            return res.json({
                ok: true,
                tz: LA_TZ,
                id,
                fileUrl: `/api/beats/${id}.wav`,
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
    }
);

// ===============================
// GET /api/beats/:id.wav (R2 signed URL + history + export log)
// ===============================
router.get("/beats/:id.wav", requireAuth, rlWav, async (req, res, next) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res
                .status(401)
                .json({ ok: false, error: "Unauthorized", code: "UNAUTHORIZED" });
        }

        const id = String(req.params.id || "").trim();
        if (!id) {
            return res
                .status(400)
                .json({ ok: false, error: "Missing id", code: "MISSING_ID" });
        }

        const key = r2KeyWav(id);

        if (!(await r2Exists(key))) {
            safeLogHistory(userId, "download_wav", "error", {
                beatId: id,
                reason: "file_not_found",
            });
            return res
                .status(404)
                .json({ ok: false, error: "WAV not found", code: "WAV_NOT_FOUND" });
        }

        // export log
        try {
            db.prepare(
                `INSERT INTO exports (user_id, beat_id, format, file_path, size_bytes, ip, user_agent)
         VALUES (?, ?, 'wav', ?, 0, ?, ?)
         ON CONFLICT(user_id, beat_id, format) DO UPDATE SET
           file_path=excluded.file_path,
           size_bytes=excluded.size_bytes,
           ip=excluded.ip,
           user_agent=excluded.user_agent,
           created_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`
            ).run(
                userId,
                id,
                `r2:${key}`,
                req.ip || null,
                req.headers["user-agent"] || null
            );
        } catch (e) {
            console.error("EXPORT WAV LOG FAILED", e);
        }

        safeLogHistory(userId, "download_wav", "ok", { beatId: id });

        const url = await r2SignedGetUrl(key);
        return res.redirect(302, url);
    } catch (err) {
        return next(err);
    }
});

// ===============================
// GET /api/beats/:id.mp3 (PRO + max_exports mensual + R2 cache/generate)
// ===============================
router.get("/beats/:id.mp3", requireAuth, rlMp3, async (req, res, next) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res
                .status(401)
                .json({ ok: false, error: "Unauthorized", code: "UNAUTHORIZED" });
        }

        const id = String(req.params.id || "").trim();
        if (!id) {
            return res
                .status(400)
                .json({ ok: false, error: "Missing id", code: "MISSING_ID" });
        }

        const rawPlanId = await getUserPlan(userId);
        const planId = normalizePlanId(rawPlanId);

        if (!isProPlan(planId)) {
            safeLogHistory(userId, "download_mp3", "error", {
                beatId: id,
                reason: "upgrade_required",
                plan: planId,
            });
            return res.status(402).json({
                ok: false,
                error: "Upgrade required for MP3",
                code: "UPGRADE_REQUIRED",
            });
        }

        // enforce max_exports mensual
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

        const monthPrefix = laMonthISO(); // YYYY-MM
        const used =
            db
                .prepare(
                    "SELECT COUNT(*) AS n FROM exports WHERE user_id=? AND format='mp3' AND created_at LIKE ?"
                )
                .get(userId, `${monthPrefix}%`)?.n ?? 0;

        if (Number(used) >= maxExports) {
            safeLogHistory(userId, "download_mp3", "error", {
                beatId: id,
                reason: "export_limit",
                month: monthPrefix,
                used: Number(used),
                max: Number(maxExports),
            });

            return res.status(402).json({
                ok: false,
                error: "Export limit reached",
                code: "EXPORT_LIMIT",
                meta: { month: monthPrefix, used: Number(used), max: Number(maxExports) },
            });
        }

        const mp3Key = r2KeyMp3(id);
        const wavKey = r2KeyWav(id);

        // MP3 en cache?
        if (await r2Exists(mp3Key)) {
            // export log
            try {
                db.prepare(
                    `INSERT INTO exports (user_id, beat_id, format, file_path, size_bytes, ip, user_agent)
           VALUES (?, ?, 'mp3', ?, 0, ?, ?)
           ON CONFLICT(user_id, beat_id, format) DO UPDATE SET
             file_path=excluded.file_path,
             size_bytes=excluded.size_bytes,
             ip=excluded.ip,
             user_agent=excluded.user_agent,
             created_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`
                ).run(
                    userId,
                    id,
                    `r2:${mp3Key}`,
                    req.ip || null,
                    req.headers["user-agent"] || null
                );
            } catch (e) {
                console.error("EXPORT MP3 LOG FAILED", e);
            }

            safeLogHistory(userId, "download_mp3", "ok", { beatId: id, source: "r2_cache" });

            const url = await r2SignedGetUrl(mp3Key);
            return res.redirect(302, url);
        }

        // si no hay mp3, debe existir wav
        if (!(await r2Exists(wavKey))) {
            safeLogHistory(userId, "download_mp3", "error", { beatId: id, reason: "wav_missing" });
            return res
                .status(404)
                .json({ ok: false, error: "WAV not found for MP3", code: "WAV_NOT_FOUND" });
        }

        // descargar wav => convertir => subir mp3
        const tmpWav = tmpFile("wav");
        const tmpMp3 = tmpFile("mp3");

        try {
            await r2DownloadToFile({ key: wavKey, outPath: tmpWav });
            await wavToMp3(tmpWav, tmpMp3);

            if (!fs.existsSync(tmpMp3)) {
                safeLogHistory(userId, "download_mp3", "error", {
                    beatId: id,
                    reason: "mp3_gen_failed",
                });
                return res
                    .status(500)
                    .json({ ok: false, error: "MP3 generation failed", code: "MP3_GEN_FAILED" });
            }

            await r2PutFile({ key: mp3Key, filePath: tmpMp3, contentType: "audio/mpeg" });
        } finally {
            try {
                fs.unlinkSync(tmpWav);
            } catch { }
            try {
                fs.unlinkSync(tmpMp3);
            } catch { }
        }

        // export log
        try {
            db.prepare(
                `INSERT INTO exports (user_id, beat_id, format, file_path, size_bytes, ip, user_agent)
         VALUES (?, ?, 'mp3', ?, 0, ?, ?)
         ON CONFLICT(user_id, beat_id, format) DO UPDATE SET
           file_path=excluded.file_path,
           size_bytes=excluded.size_bytes,
           ip=excluded.ip,
           user_agent=excluded.user_agent,
           created_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`
            ).run(
                userId,
                id,
                `r2:${mp3Key}`,
                req.ip || null,
                req.headers["user-agent"] || null
            );
        } catch (e) {
            console.error("EXPORT MP3 LOG FAILED", e);
        }

        safeLogHistory(userId, "download_mp3", "ok", { beatId: id, source: "generated" });

        const url = await r2SignedGetUrl(mp3Key);
        return res.redirect(302, url);
    } catch (err) {
        return next(err);
    }
});

export default router;

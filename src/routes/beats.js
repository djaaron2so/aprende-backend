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
// Signed URL TTL (BLINDADO)
// ===============================
function signedTtlSeconds() {
    const raw = process.env.R2_SIGNED_URL_TTL_SECONDS;
    const n = Number(raw);
    if (!Number.isFinite(n)) return 600; // default
    const i = Math.floor(n);
    if (i < 1) return 1;
    if (i > 604800) return 604800; // 7 días
    return i;
}

// ===============================
// Helpers
// ===============================
const beatsDir = path.resolve("public", "beats");
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
        .prepare(`SELECT dailyUsed, monthlyUsed FROM usage WHERE userId=? AND day=? AND month=?`)
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

function safeR2Err(e) {
    return {
        name: e?.name,
        message: e?.message,
        code: e?.Code || e?.code,
        httpStatusCode: e?.$metadata?.httpStatusCode,
    };
}

// ---------- BLINDADO: validar UUID ----------
function isUuid(v) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        String(v || "")
    );
}

// ---------- BLINDADO: ownership (si hay tabla beats) ----------
function assertBeatOwnerOr404(userId, beatId) {
    if (!tableExists("beats")) return true; // no romper si no existe
    const row = db.prepare("SELECT user_id FROM beats WHERE id=? LIMIT 1").get(beatId);
    if (!row) return false;
    return String(row.user_id) === String(userId);
}

// ---------- BLINDADO: exports_log para contar eventos reales ----------
function ensureExportsLogTable() {
    try {
        db.prepare(
            `CREATE TABLE IF NOT EXISTS exports_log (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        beat_id TEXT NOT NULL,
        format TEXT NOT NULL,
        file_path TEXT,
        size_bytes INTEGER DEFAULT 0,
        ip TEXT,
        user_agent TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      )`
        ).run();

        db.prepare(
            `CREATE INDEX IF NOT EXISTS idx_exports_log_user_fmt_time
       ON exports_log(user_id, format, created_at)`
        ).run();
    } catch (e) {
        console.error("ensureExportsLogTable failed", e);
    }
}

function logExportEventBestEffort({ userId, beatId, format, filePath, req }) {
    try {
        ensureExportsLogTable();
        if (!tableExists("exports_log")) return;

        db.prepare(
            `INSERT INTO exports_log (id, user_id, beat_id, format, file_path, size_bytes, ip, user_agent)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
        ).run(
            crypto.randomUUID(),
            userId,
            beatId,
            format,
            filePath || null,
            req?.ip || null,
            req?.headers?.["user-agent"] || null
        );
    } catch (e) {
        console.error("EXPORTS_LOG INSERT FAILED", e);
    }
}

// ===============================
// GET /api/usage  (FUERA, correcto)
// ===============================
router.get("/usage", requireAuth, async (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "Unauthorized", code: "UNAUTHORIZED" });

    const day = laDayISO();
    const month = laMonthISO();

    const rawPlanId = await getUserPlan(userId);
    const planId = normalizePlanId(rawPlanId);

    const limits = getPlanBeatLimits(planId);
    const maxDaily = safeLimitNumber(limits?.max_beats_daily);
    const maxMonthly = safeLimitNumber(limits?.max_beats_monthly);

    const { dailyUsed, monthlyUsed } = getUsageCounts(userId, day, month);

    // mp3 exports this month (real)
    ensureExportsLogTable();
    const mp3Used =
        db
            .prepare("SELECT COUNT(*) AS n FROM exports_log WHERE user_id=? AND format='mp3' AND created_at LIKE ?")
            .get(userId, `${month}%`)?.n ?? 0;

    const planRow = db.prepare("SELECT max_exports FROM plans WHERE id=?").get(planId);
    const maxExports = Number(planRow?.max_exports ?? 0);

    return res.json({
        ok: true,
        tz: LA_TZ,
        day,
        month,
        plan: planId,
        beats: {
            maxDaily: Number.isFinite(maxDaily) ? maxDaily : null,
            maxMonthly: Number.isFinite(maxMonthly) ? maxMonthly : null,
            usedToday: dailyUsed,
            usedThisMonth: monthlyUsed,
            remainingToday: remaining(maxDaily, dailyUsed),
            remainingThisMonth: remaining(maxMonthly, monthlyUsed),
        },
        mp3_exports: {
            max: Number.isFinite(maxExports) ? maxExports : null,
            usedThisMonth: Number(mp3Used),
            remainingThisMonth: Number.isFinite(maxExports) ? Math.max(0, maxExports - Number(mp3Used)) : null,
        },
    });
});

// ===============================
// POST /api/generate-beat
// ===============================
router.post("/generate-beat", requireAuth, rlGenerateBeat, async (req, res, next) => {
    try {
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ ok: false, error: "Unauthorized", code: "UNAUTHORIZED" });

        const rawPlanId = await getUserPlan(userId);
        const planId = normalizePlanId(rawPlanId);

        const day = laDayISO();
        const month = laMonthISO();

        const limits = getPlanBeatLimits(planId);
        const maxDaily = safeLimitNumber(limits?.max_beats_daily);
        const maxMonthly = safeLimitNumber(limits?.max_beats_monthly);

        const { dailyUsed, monthlyUsed } = getUsageCounts(userId, day, month);

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

        if (Number.isFinite(maxMonthly) && maxMonthly >= 0 && monthlyUsed >= maxMonthly) {
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

        const bpm = clampNumber(req.body?.bpm ?? 95, 40, 220, 95);
        const bars = clampNumber(req.body?.bars ?? 16, 1, 128, 16);
        const swing = clampNumber(req.body?.swing ?? 0, 0, 100, 0);
        const style = String(req.body?.style ?? "dembow");

        const energy = clampNumber(req.body?.energy ?? 2, 0, 10, 2);
        const density = clampNumber(req.body?.density ?? 2, 0, 10, 2);
        const humanize = clampNumber(req.body?.humanize ?? 0, 0, 100, 0);

        fs.mkdirSync(beatsDir, { recursive: true });

        const result = await generateBeatWav({ bpm, bars, swing, style, energy, density, humanize });

        const id = result?.id || (result?.filename ? String(result.filename).replace(/\.wav$/i, "") : null);
        if (!id) {
            safeLogHistory(userId, "generate_beat", "error", { code: "GENERATOR_NO_ID", bpm, bars, swing, style });
            return res.status(500).json({ ok: false, error: "Beat generator did not return id", code: "GENERATOR_NO_ID" });
        }

        if (!isUuid(id)) {
            safeLogHistory(userId, "generate_beat", "error", { code: "INVALID_ID_FROM_GENERATOR", id });
            return res.status(500).json({ ok: false, error: "Invalid beat id generated", code: "INVALID_BEAT_ID" });
        }

        const expectedWav = wavPathFor(id);

        const srcWav =
            result?.filePath || result?.path || (result?.filename ? path.resolve(String(result.filename)) : null);

        if (!fs.existsSync(expectedWav) && srcWav && fs.existsSync(srcWav)) {
            try {
                fs.renameSync(srcWav, expectedWav);
            } catch {
                fs.copyFileSync(srcWav, expectedWav);
            }
        }

        if (!fs.existsSync(expectedWav)) {
            safeLogHistory(userId, "generate_beat", "error", { code: "WAV_MISSING", id, expectedWav, srcWav });
            return res.status(500).json({
                ok: false,
                error: "WAV not found after generation",
                code: "WAV_MISSING",
                meta: { expectedWav, srcWav, resultKeys: Object.keys(result || {}) },
            });
        }

        let wavStorage = "local";
        let r2Fail = null;

        try {
            await r2PutFile({ key: r2KeyWav(id), filePath: expectedWav, contentType: "audio/wav" });
            wavStorage = "r2";
        } catch (e) {
            r2Fail = safeR2Err(e);
            console.warn("R2 WAV UPLOAD FAILED (fallback local)", { beatId: id, key: r2KeyWav(id), ...r2Fail });
            safeLogHistory(userId, "generate_beat", "warn", {
                beatId: id,
                reason: "r2_wav_upload_failed_fallback_local",
                r2: r2Fail,
            });
        }

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
                    wavStorage === "r2" ? `r2:${r2KeyWav(id)}` : `local:${expectedWav}`
                );
            } catch (e) {
                console.error("BEATS INSERT FAILED", e);
            }
        }

        const usedTodayAfter = dailyUsed + 1;
        const usedMonthAfter = monthlyUsed + 1;

        safeLogHistory(userId, "generate_beat", "ok", { beatId: id, bpm, style, storage: wavStorage });

        return res.json({
            ok: true,
            tz: LA_TZ,
            id,
            storage: { wav: wavStorage },
            fileUrl: `/api/beats/${id}.wav`,
            usage: {
                day,
                month,
                beats_generated_today: usedTodayAfter,
                beats_generated_this_month: usedMonthAfter,
                max_beats_daily: Number.isFinite(maxDaily) ? maxDaily : null,
                max_beats_monthly: Number.isFinite(maxMonthly) ? maxMonthly : null,
                remaining_beats_today: remaining(maxDaily, usedTodayAfter),
                remaining_beats_this_month: remaining(maxMonthly, usedMonthAfter),
            },
            r2: r2Fail ? { ok: false, ...r2Fail } : { ok: true },
        });
    } catch (err) {
        return next(err);
    }
});

// ===============================
// GET /api/beats/:id.wav
// ===============================
router.get("/beats/:id.wav", requireAuth, rlWav, async (req, res, next) => {
    try {
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ ok: false, error: "Unauthorized", code: "UNAUTHORIZED" });

        const id = String(req.params.id || "").trim();
        if (!id) return res.status(400).json({ ok: false, error: "Missing id", code: "MISSING_ID" });
        if (!isUuid(id)) return res.status(400).json({ ok: false, error: "Invalid id", code: "INVALID_ID" });
        if (!assertBeatOwnerOr404(userId, id)) return res.status(404).json({ ok: false, error: "Not found", code: "NOT_FOUND" });

        const key = r2KeyWav(id);

        try {
            const exists = await r2Exists(key);
            if (exists) {
                safeLogHistory(userId, "download_wav", "ok", { beatId: id, source: "r2" });

                const ttl = signedTtlSeconds();
                const url = await r2SignedGetUrl(key, ttl);

                res.set("Cache-Control", "no-store");
                return res.redirect(302, url);
            }
        } catch (e) {
            console.warn("R2 WAV CHECK/SIGN FAILED (fallback local)", { beatId: id, key, ...safeR2Err(e) });
        }

        const localPath = wavPathFor(id);
        if (!fs.existsSync(localPath)) {
            safeLogHistory(userId, "download_wav", "error", { beatId: id, reason: "file_not_found" });
            return res.status(404).json({ ok: false, error: "WAV not found", code: "WAV_NOT_FOUND" });
        }

        safeLogHistory(userId, "download_wav", "ok", { beatId: id, source: "local" });
        return res.sendFile(path.resolve(localPath));
    } catch (err) {
        return next(err);
    }
});

// ===============================
// GET /api/beats/:id.wav-url
// ===============================
router.get("/beats/:id.wav-url", requireAuth, rlWav, async (req, res, next) => {
    try {
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ ok: false, error: "Unauthorized", code: "UNAUTHORIZED" });

        const id = String(req.params.id || "").trim();
        if (!id) return res.status(400).json({ ok: false, error: "Missing id", code: "MISSING_ID" });
        if (!isUuid(id)) return res.status(400).json({ ok: false, error: "Invalid id", code: "INVALID_ID" });
        if (!assertBeatOwnerOr404(userId, id)) return res.status(404).json({ ok: false, error: "Not found", code: "NOT_FOUND" });

        const key = r2KeyWav(id);
        const exists = await r2Exists(key);
        if (!exists) return res.status(404).json({ ok: false, error: "WAV not found", code: "WAV_NOT_FOUND" });

        const ttl = signedTtlSeconds();
        const url = await r2SignedGetUrl(key, ttl);

        res.set("Cache-Control", "no-store");
        return res.json({ ok: true, id, url, ttl });
    } catch (err) {
        return next(err);
    }
});

// ===============================
// GET /api/beats/:id.mp3-url (PRO)
// ===============================
router.get("/beats/:id.mp3-url", requireAuth, rlMp3, async (req, res, next) => {
    try {
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ ok: false, error: "Unauthorized", code: "UNAUTHORIZED" });

        const id = String(req.params.id || "").trim();
        if (!id) return res.status(400).json({ ok: false, error: "Missing id", code: "MISSING_ID" });
        if (!isUuid(id)) return res.status(400).json({ ok: false, error: "Invalid id", code: "INVALID_ID" });
        if (!assertBeatOwnerOr404(userId, id)) return res.status(404).json({ ok: false, error: "Not found", code: "NOT_FOUND" });

        const rawPlanId = await getUserPlan(userId);
        const planId = normalizePlanId(rawPlanId);
        if (!isProPlan(planId)) return res.status(402).json({ ok: false, error: "Upgrade required for MP3", code: "UPGRADE_REQUIRED" });

        const mp3Key = r2KeyMp3(id);
        if (!(await r2Exists(mp3Key))) return res.status(404).json({ ok: false, error: "MP3 not found", code: "MP3_NOT_FOUND" });

        const ttl = signedTtlSeconds();
        const url = await r2SignedGetUrl(mp3Key, ttl);

        res.set("Cache-Control", "no-store");
        return res.json({ ok: true, id, url, ttl });
    } catch (err) {
        return next(err);
    }
});

// ===============================
// GET /api/beats/:id.mp3 (PRO + max_exports mensual REAL)
// ===============================
router.get("/beats/:id.mp3", requireAuth, rlMp3, async (req, res, next) => {
    try {
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ ok: false, error: "Unauthorized", code: "UNAUTHORIZED" });

        const id = String(req.params.id || "").trim();
        if (!id) return res.status(400).json({ ok: false, error: "Missing id", code: "MISSING_ID" });
        if (!isUuid(id)) return res.status(400).json({ ok: false, error: "Invalid id", code: "INVALID_ID" });
        if (!assertBeatOwnerOr404(userId, id)) return res.status(404).json({ ok: false, error: "Not found", code: "NOT_FOUND" });

        const rawPlanId = await getUserPlan(userId);
        const planId = normalizePlanId(rawPlanId);

        if (!isProPlan(planId)) {
            safeLogHistory(userId, "download_mp3", "error", { beatId: id, reason: "upgrade_required", plan: planId });
            return res.status(402).json({ ok: false, error: "Upgrade required for MP3", code: "UPGRADE_REQUIRED" });
        }

        const planRow = db.prepare("SELECT max_exports FROM plans WHERE id=?").get(planId);
        if (!planRow) return res.status(500).json({ ok: false, error: `Plan not found in DB: ${planId}`, code: "PLAN_NOT_FOUND" });

        const maxExports = Number(planRow.max_exports);
        if (!Number.isFinite(maxExports) || maxExports < 0) {
            return res.status(500).json({ ok: false, error: "Invalid max_exports in DB", code: "PLAN_EXPORTS_INVALID" });
        }

        ensureExportsLogTable();
        const monthPrefix = laMonthISO();

        let used =
            db
                .prepare("SELECT COUNT(*) AS n FROM exports_log WHERE user_id=? AND format='mp3' AND created_at LIKE ?")
                .get(userId, `${monthPrefix}%`)?.n ?? 0;

        if (Number(used) >= maxExports) {
            safeLogHistory(userId, "download_mp3", "error", { beatId: id, reason: "export_limit", month: monthPrefix, used: Number(used), max: Number(maxExports) });
            return res.status(402).json({ ok: false, error: "Export limit reached", code: "EXPORT_LIMIT", meta: { month: monthPrefix, used: Number(used), max: Number(maxExports) } });
        }

        const mp3Key = r2KeyMp3(id);
        const wavKey = r2KeyWav(id);

        // cache?
        if (await r2Exists(mp3Key)) {
            logExportEventBestEffort({ userId, beatId: id, format: "mp3", filePath: `r2:${mp3Key}`, req });
            safeLogHistory(userId, "download_mp3", "ok", { beatId: id, source: "r2_cache" });

            const ttl = signedTtlSeconds();
            const url = await r2SignedGetUrl(mp3Key, ttl);

            res.set("Cache-Control", "no-store");
            return res.redirect(302, url);
        }

        // generate
        if (!(await r2Exists(wavKey))) {
            safeLogHistory(userId, "download_mp3", "error", { beatId: id, reason: "wav_missing" });
            return res.status(404).json({ ok: false, error: "WAV not found for MP3", code: "WAV_NOT_FOUND" });
        }

        const tmpWav = tmpFile("wav");
        const tmpMp3 = tmpFile("mp3");

        try {
            await r2DownloadToFile({ key: wavKey, outPath: tmpWav });
            await wavToMp3(tmpWav, tmpMp3);

            if (!fs.existsSync(tmpMp3)) {
                safeLogHistory(userId, "download_mp3", "error", { beatId: id, reason: "mp3_gen_failed" });
                return res.status(500).json({ ok: false, error: "MP3 generation failed", code: "MP3_GEN_FAILED" });
            }

            await r2PutFile({ key: mp3Key, filePath: tmpMp3, contentType: "audio/mpeg" });
        } finally {
            try { fs.unlinkSync(tmpWav); } catch { }
            try { fs.unlinkSync(tmpMp3); } catch { }
        }

        logExportEventBestEffort({ userId, beatId: id, format: "mp3", filePath: `r2:${mp3Key}`, req });
        safeLogHistory(userId, "download_mp3", "ok", { beatId: id, source: "generated" });

        const ttl = signedTtlSeconds();
        const url = await r2SignedGetUrl(mp3Key, ttl);

        res.set("Cache-Control", "no-store");
        return res.redirect(302, url);
    } catch (err) {
        return next(err);
    }
});

export default router;

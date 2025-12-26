import { Router } from "express";
import { v4 as uuid } from "uuid";
import axios from "axios";
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";

import { enforceBeatLimits, commitUsage } from "./subscriptionLimit.js";
import { PLANS } from "./plans.js";
import { getUserPlan } from "./users.js";

const WORKER_URL = process.env.WORKER_URL || "http://localhost:8091";
const PUBLIC_BASE = process.env.PUBLIC_FILES_BASE || "http://localhost:8081";

const r = Router();

// Auth simple: Authorization: Bearer <userId>
function requireUser(req, res, next) {
    const h = req.headers.authorization || "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Missing auth" });
    req.user = { id: token };
    next();
}

// ✅ Limits by subscription happen here
r.post("/generate-beat", requireUser, enforceBeatLimits, async (req, res) => {
    try {
        const { genre, mood, bpm, complexity } = req.body || {};
        const userId = req.user.id;

        const projectId = uuid();
        const jobId = uuid();

        // 1) Call worker
        const { data } = await axios.post(
            `${WORKER_URL}/api/generate-beat`,
            { jobId, userId, projectId, genre, mood, bpm, complexity },
            { timeout: 240000 }
        );

        // 2) Ensure storage dir
        const storageDir = path.join(process.cwd(), "storage");
        fs.mkdirSync(storageDir, { recursive: true });

        // 3) Copy WAV into storage
        const destWav = path.join(storageDir, `${projectId}.wav`);
        fs.copyFileSync(data.wav_path, destWav);

        // 4) Plan rules (mp3/bitrate)
        const planName = getUserPlan(userId);
        const plan = PLANS[planName] || PLANS.free;

        const audioUrlWav = `${PUBLIC_BASE}/files/${projectId}.wav`;
        let audioUrlMp3 = null;
        let audioUrl = audioUrlWav;

        if (plan.mp3) {
            const destMp3 = path.join(storageDir, `${projectId}.mp3`);
            execFileSync(
                "ffmpeg",
                ["-y", "-i", destWav, "-codec:a", "libmp3lame", "-b:a", plan.bitrate, destMp3],
                { stdio: "ignore" }
            );
            audioUrlMp3 = `${PUBLIC_BASE}/files/${projectId}.mp3`;
            audioUrl = audioUrlMp3;
        }

        // 5) Commit usage ONLY on success
        commitUsage(req, res);

        const isFree = planName === "free";

        return res.json({
            projectId,
            plan: planName,
            usage: res.locals._counts || null,

            audioUrl,      // free => wav, pro/studio => mp3
            audioUrlMp3,   // free => null
            audioUrlWav,

            upgradeRequiredForMp3: isFree,
            upgradeMessage: isFree ? "Upgrade to Pro to download MP3." : null,

            midiPath: data.midi_path || null,
            sections: data.sections || null,
        });
    } catch (err) {
        const code = err?.code;
        const status = err?.response?.status;
        const data = err?.response?.data;
        const message = err?.message || String(err);

        console.error("generate-beat error:", { code, status, data, message });

        return res.status(500).json({
            error: "Failed to generate beat",
            details: { code, status, data, message },
        });
    }
});

export default r;

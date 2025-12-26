import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { generateBeatFile } from "../services/beatGenerator.js";

const router = Router();

router.post("/generate-beat", requireAuth, async (req, res, next) => {
    try {
        const { bpm, genre, mood, complexity } = req.body || {};

        const result = await generateBeatFile({
            userId: req.user.id,
            bpm: Number(bpm || 95)
        });

        const fileUrl = `http://127.0.0.1:8091/public/beats/${result.filename}`;

        res.json({
            ok: true,
            fileUrl,
            beat: {
                id: result.id,
                bpm: Number(bpm || 95),
                genre: genre || "Reggaetón",
                mood: mood || "Fiesta",
                complexity: Number(complexity || 2)
            }
        });
    } catch (err) {
        next(err);
    }
});

export default router;

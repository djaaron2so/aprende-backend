import express from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/requireAuth.js";
import { getHistory, logHistory } from "../lib/history.js";

export const historyRouter = express.Router();

// GET /api/history?limit=50&type=download_mp3
historyRouter.get("/", requireAuth, (req, res) => {
    const schema = z.object({
        limit: z.string().regex(/^\d+$/).optional(),
        type: z.string().min(1).optional(),
    });

    const parsed = schema.safeParse(req.query);
    if (!parsed.success) {
        return res
            .status(400)
            .json({ error: "Invalid query", details: parsed.error.issues });
    }

    const limitNum = parsed.data.limit ? Number(parsed.data.limit) : 50;
    const limit = Math.min(Math.max(limitNum, 1), 200); // 1..200

    const type = parsed.data.type ?? null;

    const items = getHistory(req.userId, { limit, type });

    res.json({ items });
});

// (Opcional) POST /api/history (solo debug)
historyRouter.post("/", requireAuth, express.json(), (req, res) => {
    const schema = z.object({
        type: z.string().min(1),
        status: z.enum(["ok", "error"]),
        meta: z.any().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
        return res
            .status(400)
            .json({ error: "Invalid body", details: parsed.error.issues });
    }

    const { type, status, meta } = parsed.data;

    const out = logHistory(req.userId, type, status, meta ?? null);
    res.json({ ok: true, ...out });
});

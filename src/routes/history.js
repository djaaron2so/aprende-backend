import express from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/requireAuth.js";
import { getHistory, logHistory } from "../lib/history.js";

export const historyRouter = express.Router();

/**
 * GET /api/history?limit=50&type=download_mp3
 * - limit: 1..200 (default 50)
 * - type: string opcional (filtro)
 */
historyRouter.get("/", requireAuth, (req, res) => {
    try {
        // ✅ usa req.user?.id (consistente con el resto del backend)
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({
                ok: false,
                error: "Unauthorized",
                code: "UNAUTHORIZED",
            });
        }

        const schema = z.object({
            limit: z
                .string()
                .regex(/^\d+$/)
                .optional(),
            type: z.string().min(1).optional(),
        });

        const parsed = schema.safeParse(req.query);
        if (!parsed.success) {
            return res.status(400).json({
                ok: false,
                error: "Invalid query",
                code: "INVALID_QUERY",
                details: parsed.error.issues,
            });
        }

        const limitNum = parsed.data.limit ? Number(parsed.data.limit) : 50;
        const limit = Math.min(Math.max(limitNum, 1), 200); // 1..200

        const type = parsed.data.type ?? null;

        // ✅ getHistory debe filtrar por userId internamente
        const items = getHistory(userId, { limit, type });

        return res.json({
            ok: true,
            items: Array.isArray(items) ? items : [],
            meta: { limit, type },
        });
    } catch (e) {
        console.error("GET /api/history failed:", e);
        return res.status(500).json({
            ok: false,
            error: "Failed to load history",
            code: "HISTORY_FAILED",
        });
    }
});

/**
 * POST /api/history (debug / opcional)
 * Body:
 * - type: string
 * - status: "ok" | "error"
 * - meta: any (opcional)
 */
historyRouter.post("/", requireAuth, express.json(), (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({
                ok: false,
                error: "Unauthorized",
                code: "UNAUTHORIZED",
            });
        }

        const schema = z.object({
            type: z.string().min(1),
            status: z.enum(["ok", "error"]),
            meta: z.any().optional(),
        });

        const parsed = schema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                ok: false,
                error: "Invalid body",
                code: "INVALID_BODY",
                details: parsed.error.issues,
            });
        }

        const { type, status, meta } = parsed.data;

        const out = logHistory(userId, type, status, meta ?? null);

        return res.json({
            ok: true,
            ...out,
        });
    } catch (e) {
        console.error("POST /api/history failed:", e);
        return res.status(500).json({
            ok: false,
            error: "Failed to write history",
            code: "HISTORY_WRITE_FAILED",
        });
    }
});

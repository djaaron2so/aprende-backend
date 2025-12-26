import { db } from "../db.js";

/**
 * requireAuth
 * - Espera: Authorization: Bearer <userId>
 * - userId = token (simple para dev)
 * - setea req.user y req.userId
 */
export function requireAuth(req, res, next) {
    try {
        const h = req.headers.authorization || "";
        const token = h.startsWith("Bearer ") ? h.slice(7).trim() : null;

        if (!token) {
            return res.status(401).json({ error: "Missing bearer token" });
        }

        // ✅ compat con todo el proyecto
        req.user = { id: token };
        req.userId = token;

        return next();

    } catch (e) {
        return res.status(401).json({ error: "Unauthorized" });
    }
}

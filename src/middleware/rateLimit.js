// src/middleware/rateLimit.js
// Rate limit simple en memoria: OK para 1 instancia.
// Si escalas a varias instancias -> Redis.

const buckets = new Map();

/**
 * createRateLimiter({
 *   keyFn: (req) => "user:abc" || "ip:1.2.3.4",
 *   limit: 10,
 *   windowMs: 60_000,
 *   name: "generate-beat"
 * })
 */
export function createRateLimiter({ keyFn, limit, windowMs, name }) {
    if (!limit || !windowMs) throw new Error("limit/windowMs required");

    return function rateLimit(req, res, next) {
        const now = Date.now();
        const keyBase = keyFn?.(req) || req.ip || "unknown";
        const key = `${name}:${keyBase}`;

        let b = buckets.get(key);
        if (!b) {
            b = { count: 0, resetAt: now + windowMs };
            buckets.set(key, b);
        }

        // ventana expirada -> reset
        if (now >= b.resetAt) {
            b.count = 0;
            b.resetAt = now + windowMs;
        }

        b.count += 1;

        const remaining = Math.max(0, limit - b.count);
        const retryAfterMs = Math.max(0, b.resetAt - now);

        // Headers útiles (opcional)
        res.setHeader("X-RateLimit-Limit", String(limit));
        res.setHeader("X-RateLimit-Remaining", String(remaining));
        res.setHeader("X-RateLimit-ResetMs", String(retryAfterMs));

        if (b.count > limit) {
            return res.status(429).json({
                ok: false,
                error: "Too many requests",
                code: "RATE_LIMIT",
                meta: {
                    name,
                    limit,
                    window_ms: windowMs,
                    retry_after_ms: retryAfterMs,
                },
            });
        }

        return next();
    };
}

// Limpieza básica para que el Map no crezca infinito (cada 5 min)
setInterval(() => {
    const now = Date.now();
    for (const [k, b] of buckets.entries()) {
        if (!b || now >= b.resetAt + 60_000) buckets.delete(k);
    }
}, 5 * 60_000).unref?.();

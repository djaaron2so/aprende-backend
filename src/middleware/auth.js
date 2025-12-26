export function requireAuth(req, res, next) {
    const header = req.header("authorization") || "";
    const m = header.match(/^Bearer\s+(.+)$/i);

    if (!m) return res.status(401).json({ error: "Missing Authorization Bearer token" });

    // En tu demo el token ES el userId (ej: demo-user-1)
    req.userId = m[1].trim();
    next();
}

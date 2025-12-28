import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import path from "path";
import { fileURLToPath } from "url";

import { db } from "./db.js";

// ================================
// Routers
// ================================
import healthRouter from "./routes/health.js";
import meRouter from "./routes/me.js";
import beatsRouter from "./routes/beats.js";
import usageRouter from "./routes/usage.js";
import exportsRouter from "./routes/exports.js";
import paymentsRouter from "./routes/paymentsRoutes.js";
import receiptsRouter from "./routes/receipts.js";
import paypalRouter from "./routes/paypalRoutes.js";
import paypalWebhookRouter from "./routes/paypalWebhook.js";
import { historyRouter } from "./routes/history.js";

// ================================
// __dirname (ESM)
// ================================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ================================
// App
// ================================
const app = express();
// ===== DEBUG R2 ENV (TEMPORAL) =====
console.log("R2_ACCOUNT_ID?", !!process.env.R2_ACCOUNT_ID);
console.log("R2_ACCESS_KEY_ID?", !!process.env.R2_ACCESS_KEY_ID);
console.log("R2_SECRET_ACCESS_KEY?", !!process.env.R2_SECRET_ACCESS_KEY);
console.log("R2_BUCKET?", !!process.env.R2_BUCKET);
console.log("R2_PUBLIC_BASE?", !!process.env.R2_PUBLIC_BASE);
// ==================================

// ================================
// Version / deploy id
// ================================
const APP_VERSION =
    process.env.RENDER_GIT_COMMIT ||
    process.env.GIT_COMMIT ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    "unknown";

// ================================
// Helmet (no rompe audio / PayPal)
// ================================
app.use(
    helmet({
        crossOriginEmbedderPolicy: false,
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                baseUri: ["'self'"],
                frameAncestors: ["'self'"],
                objectSrc: ["'none'"],
                imgSrc: ["'self'", "data:"],
                styleSrc: ["'self'", "'unsafe-inline'"],
                scriptSrc: ["'self'"],
                mediaSrc: ["'self'"],
                connectSrc: [
                    "'self'",
                    process.env.FRONTEND_ORIGIN,
                    process.env.FRONTEND_ORIGIN_DEV,
                    "https://api.paypal.com",
                    "https://api-m.paypal.com",
                ].filter(Boolean),
            },
        },
    })
);

// ================================
// CORS (PROD + localhost cualquier puerto)
// ================================

// DEV: localhost / 127.0.0.1 con cualquier puerto
const isDevLocalOrigin = (origin) =>
    typeof origin === "string" &&
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

// PROD allowlist
const allowedOrigins = new Set(
    [process.env.FRONTEND_ORIGIN, process.env.FRONTEND_ORIGIN_DEV].filter(Boolean)
);
const corsOptions = {
    origin: (origin, cb) => {
        // Sin Origin → curl, PowerShell, apps móviles
        if (!origin) return cb(null, true);

        // DEV local
        if (isDevLocalOrigin(origin)) return cb(null, true);

        // PROD
        if (allowedOrigins.has(origin)) return cb(null, true);

        return cb(new Error(`CORS blocked: ${origin}`));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
    optionsSuccessStatus: 204,
    maxAge: 86400,
};

// ✅ aplicar UNA sola vez
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

// ================================
// CORS error handler (JSON limpio)
// ================================
app.use((err, req, res, next) => {
    if (err && String(err.message || "").includes("CORS")) {
        return res.status(403).json({
            ok: false,
            error: "CORS blocked",
            details: err.message,
            code: "CORS_BLOCKED",
        });
    }
    return next(err);
});
// ================================
// Morgan (seguro)
// ================================
morgan.token("auth", (req) =>
    req.headers.authorization ? "present" : "none"
);
app.use(
    morgan(":method :url :status :res[content-length] - :response-time ms auth=:auth")
);

// ================================
// Body parsers
// ================================
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// ================================
// Static (opcional)
// ================================
app.use("/public", express.static(path.join(__dirname, "..", "public")));

// ================================
// Root
// ================================
app.get("/", (req, res) => {
    res.json({
        ok: true,
        service: "aprende-backend",
        hint: "Use /health or /api",
    });
});

app.get("/favicon.ico", (_, res) => res.status(204).end());

// ================================
// Health
// ================================
app.get("/health", (req, res) => {
    try {
        db.prepare("SELECT 1").get();
        res.json({
            ok: true,
            service: "aprende-backend",
            time: new Date().toISOString(),
            tz: "America/Los_Angeles",
            version: APP_VERSION,
        });
    } catch {
        res.status(500).json({
            ok: false,
            error: "DB unhealthy",
            code: "HEALTH_DB_FAIL",
        });
    }
});

// ================================
// Version
// ================================
app.get("/__version", (req, res) => {
    res.json({
        ok: true,
        service: "aprende-backend",
        version: APP_VERSION,
        time: new Date().toISOString(),
    });
});

// ================================
// API index
// ================================
app.get("/api", (req, res) => {
    res.json({
        ok: true,
        version: APP_VERSION,
        routes: [
            "GET  /health",
            "GET  /__version",
            "GET  /api",
            "GET  /api/health",
            "GET  /api/me",
            "GET  /api/history",
            "POST /api/generate-beat",
            "GET  /api/beats/:id.wav",
            "GET  /api/beats/:id.mp3",
            "GET  /api/usage",
            "GET  /api/exports",
            "POST /api/paypal/create-order",
            "POST /api/paypal/capture-order",
            "POST /api/paypal/webhook",
        ],
    });
});

// ================================
// API routes
// ================================
app.use("/api", healthRouter);
app.use("/api", meRouter);
app.use("/api", beatsRouter);
app.use("/api", usageRouter);
app.use("/api", exportsRouter);
app.use("/api/history", historyRouter);
app.use("/api/payments", paymentsRouter);
app.use("/api", receiptsRouter);
app.use("/api/paypal", paypalRouter);
app.use("/api/paypal", paypalWebhookRouter);

// ================================
// 404
// ================================
app.use((req, res) => {
    res.status(404).json({ ok: false, error: "Not Found", code: "NOT_FOUND" });
});

// ================================
// Error handler
// ================================
app.use((err, req, res, next) => {
    console.error("❌ ERROR", err);
    res.status(err.statusCode || 500).json({
        ok: false,
        error: err.message || "Internal Server Error",
        code: err.code || "INTERNAL_ERROR",
    });
});

// ================================
// LISTEN (Render)
// ================================
const PORT = Number(process.env.PORT || 8091);

const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ Aprende backend listening on 0.0.0.0:${PORT}`);
});

server.on("error", (e) => {
    console.error("❌ LISTEN ERROR:", e);
    process.exit(1);
});

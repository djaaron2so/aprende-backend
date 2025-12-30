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

// ================================
// Version / deploy id
// ================================
const APP_VERSION =
    process.env.RENDER_GIT_COMMIT ||
    process.env.GIT_COMMIT ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    "unknown";

// ================================
// Helpers: origins
// ================================

// DEV: localhost / 127.0.0.1 con cualquier puerto
const isDevLocalOrigin = (origin) =>
    typeof origin === "string" &&
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

// PROD allowlist (exactos)
const allowedOrigins = new Set(
    [process.env.FRONTEND_ORIGIN, process.env.FRONTEND_ORIGIN_DEV].filter(Boolean)
);

// (Opcional) permitir previews de Vercel del mismo proyecto
const isVercelAprendeWeb = (origin) =>
    typeof origin === "string" &&
    /^https:\/\/aprende-web(-[a-z0-9-]+)?\.vercel\.app$/.test(origin);

// ================================
// Helmet (no rompe audio / PayPal / fetch desde frontend)
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

                // audio (tu API + signed urls https)
                mediaSrc: ["'self'", "https:"],

                // fetch / ws
                connectSrc: [
                    "'self'",
                    "https:",
                    "https://api.paypal.com",
                    "https://api-m.paypal.com",
                    process.env.FRONTEND_ORIGIN,
                    process.env.FRONTEND_ORIGIN_DEV,
                    "http://localhost:*",
                    "http://127.0.0.1:*",
                ].filter(Boolean),
            },
        },
    })
);

// ================================
// CORS (PROD + localhost cualquier puerto)
// ================================
const corsOptions = {
    origin: (origin, cb) => {
        // Sin Origin → curl, PowerShell, apps móviles
        if (!origin) return cb(null, true);

        // DEV local
        if (isDevLocalOrigin(origin)) return cb(null, true);

        // Vercel (previews + prod del proyecto)
        if (isVercelAprendeWeb(origin)) return cb(null, true);

        // PROD allowlist exacta (por env)
        if (allowedOrigins.has(origin)) return cb(null, true);

        // ✅ no lances Error (rompe preflight). Solo bloquea.
        return cb(null, false);
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
    optionsSuccessStatus: 204,
    maxAge: 86400,
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

// ================================
// Morgan (seguro)
// ================================
morgan.token("auth", (req) => (req.headers.authorization ? "present" : "none"));
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
// Debug CORS env (temporal)
// ================================
app.get("/__cors_debug", (req, res) => {
    res.json({
        ok: true,
        origin_received: req.headers.origin || null,
        FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN || null,
        FRONTEND_ORIGIN_DEV: process.env.FRONTEND_ORIGIN_DEV || null,
        NODE_ENV: process.env.NODE_ENV || null,
        version: APP_VERSION,
    });
});

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
            "GET  /__cors_debug",
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

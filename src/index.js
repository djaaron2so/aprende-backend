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
// Version / deploy id (para saber qué commit corre Render)
// ================================
const APP_VERSION =
    process.env.RENDER_GIT_COMMIT ||
    process.env.GIT_COMMIT ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    "unknown";

// ================================
// Helmet (producción, sin romper audio/PayPal)
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
// CORS (producción + dev localhost any port)
// ================================
const isDevLocalOrigin = (origin) =>
    typeof origin === "string" &&
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

const allowedOrigins = new Set(
    [process.env.FRONTEND_ORIGIN, process.env.FRONTEND_ORIGIN_DEV].filter(Boolean)
);

const corsOptions = {
    origin: (origin, cb) => {
        // Permite requests sin Origin (curl/PowerShell/apps móviles)
        if (!origin) return cb(null, true);

        // ✅ DEV local (cualquier puerto)
        if (isDevLocalOrigin(origin)) return cb(null, true);

        // ✅ PROD allowlist
        if (allowedOrigins.has(origin)) return cb(null, true);

        // Bloquear
        return cb(new Error(`CORS blocked: ${origin}`));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
    optionsSuccessStatus: 204,
    maxAge: 86400,
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));


app.use(
    cors({
        origin: (origin, cb) => {
            // Permite requests sin Origin (curl/PowerShell/apps móviles)
            if (!origin) return cb(null, true);

            // ✅ DEV: permite cualquier puerto en localhost
            if (isDevLocalOrigin(origin)) return cb(null, true);

            // ✅ PROD: solo los definidos
            if (allowedOrigins.has(origin)) return cb(null, true);

            return cb(new Error("CORS blocked"));
        },
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization"],
        credentials: true,
        optionsSuccessStatus: 204,
    })
);

// ✅ Preflight global (importante para fetch con Authorization)
app.options("*", cors());

// Si CORS bloquea, devuelve JSON limpio
app.use((err, req, res, next) => {
    if (err && String(err.message || "").includes("CORS")) {
        return res.status(403).json({
            ok: false,
            error: "CORS blocked",
            code: "CORS_BLOCKED",
        });
    }
    return next(err);
});

// ================================
// Morgan seguro (no imprime Bearer)
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
// Static files
// ================================
// Sirve archivos estáticos si los necesitas (tu API real va por /api)
app.use("/public", express.static(path.join(__dirname, "..", "public")));

// ================================
// Root (evita 404 en / y /favicon.ico)
// ================================
app.get("/", (req, res) => {
    return res.status(200).json({
        ok: true,
        service: "aprende-backend",
        hint: "Use /health or /api",
    });
});

app.get("/favicon.ico", (req, res) => res.status(204).end());

// ================================
// Healthcheck ROOT (producción)
// ================================
app.get("/health", (req, res) => {
    try {
        db.prepare("SELECT 1").get();

        return res.json({
            ok: true,
            service: "aprende-backend",
            time: new Date().toISOString(),
            tz: "America/Los_Angeles",
            version: APP_VERSION,
        });
    } catch {
        return res.status(500).json({
            ok: false,
            error: "DB unhealthy",
            code: "HEALTH_DB_FAIL",
        });
    }
});

// ================================
// Version endpoint (debug deploy)
// ================================
app.get("/__version", (req, res) => {
    return res.json({
        ok: true,
        service: "aprende-backend",
        version: APP_VERSION,
        time: new Date().toISOString(),
    });
});

// ================================
// API index (debug)
// ================================
app.get("/api", (req, res) => {
    res.json({
        ok: true,
        version: APP_VERSION,
        routes: [
            "GET  /",
            "GET  /health",
            "GET  /__version",
            "GET  /api",
            "GET  /api/health",
            "GET  /api/me",
            "GET  /api/history?limit=&type=",
            "POST /api/generate-beat",
            "GET  /api/beats/:id.wav",
            "GET  /api/beats/:id.mp3",
            "GET  /api/usage",
            "GET  /api/exports",
            "GET  /api/payments?limit=&offset=",
            "GET  /api/payments/:captureId/receipt.pdf",
            "POST /api/paypal/create-order",
            "POST /api/paypal/capture-order",
            "POST /api/paypal/webhook",
        ],
    });
});

// ================================
// API routes
// ================================
app.use("/api", healthRouter); // /api/health
app.use("/api", meRouter);

app.use("/api", beatsRouter);
app.use("/api", usageRouter);
app.use("/api", exportsRouter);

// ✅ History
app.use("/api/history", historyRouter);

// Payments
app.use("/api/payments", paymentsRouter);
app.use("/api", receiptsRouter);

// PayPal
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
// LISTEN (Render OK)
// ================================
const PORT = Number(process.env.PORT || 8091);

const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ Aprende backend listening on 0.0.0.0:${PORT}`);
});

server.on("error", (e) => {
    console.error("❌ LISTEN ERROR:", e);
    process.exit(1);
});

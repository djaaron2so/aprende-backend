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
// Helmet (producción, sin romper audio/PayPal)
// ================================
app.use(
    helmet({
        crossOriginEmbedderPolicy: false, // importante para media/audio en algunos contexts
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                baseUri: ["'self'"],
                frameAncestors: ["'self'"],
                objectSrc: ["'none'"],
                imgSrc: ["'self'", "data:"],
                styleSrc: ["'self'", "'unsafe-inline'"],
                scriptSrc: ["'self'"],
                mediaSrc: ["'self'"], // WAV/MP3 desde tu backend
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
// CORS estricto (producción)
// ================================
const allowedOrigins = new Set(
    [process.env.FRONTEND_ORIGIN, process.env.FRONTEND_ORIGIN_DEV].filter(Boolean)
);

app.use(
    cors({
        origin: (origin, cb) => {
            // Permite requests sin Origin (curl/PowerShell/apps móviles)
            if (!origin) return cb(null, true);

            // Si no configuraste ORIGINS aún, en DEV permite todo (para no bloquearte)
            if (allowedOrigins.size === 0) return cb(null, true);

            if (allowedOrigins.has(origin)) return cb(null, true);

            return cb(new Error("CORS blocked"));
        },
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization"],
        credentials: false,
    })
);

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
// Sirve /beats/<id>.wav y /beats/<id>.mp3 desde public
app.use(express.static(path.join(__dirname, "..", "public")));

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
        });
    } catch (e) {
        return res.status(500).json({
            ok: false,
            error: "DB unhealthy",
            code: "HEALTH_DB_FAIL",
        });
    }
});

// ================================
// API index (debug)
// ================================
app.get("/api", (req, res) => {
    res.json({
        ok: true,
        routes: [
            "GET  /health",
            "GET  /api/health",
            "GET  /api/me",
            "POST /api/generate-beat",
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

// Payments en su path real
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
// LISTEN
// ================================
const PORT = Number(process.env.PORT || 8091);

const server = app.listen(PORT, "127.0.0.1", () => {
    console.log(`✅ Aprende backend on http://127.0.0.1:${PORT}`);
});

server.on("error", (e) => {
    console.error("❌ LISTEN ERROR:", e);
    process.exit(1);
});

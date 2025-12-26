import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import path from "path";
import { fileURLToPath } from "url";

import { historyRouter } from "./routes/history.js";
import { db } from "./db.js";
import { logHistory } from "./lib/history.js";
import { execFile } from "child_process";
import { writeWavMonoSine } from "./lib/generateTone.js";

import { requireAuth } from "./middleware/requireAuth.js";
import paypalRouter from "./routes/paypalRoutes.js";
import paymentsRouter from "./routes/paymentsRoutes.js";
// ✅ Tu webhook router define: stripeWebhookRouter.post("/webhook", express.raw(...), ...)
// Por eso lo montamos en /api/billing para que la URL final sea /api/billing/webhook
import { stripeWebhookRouter } from "./routes/stripeWebhook.js";

// ✅ Tu billing router lo estás usando como default export (import billingRouter ...)
import billingRouter from "./routes/billing.js";
import paypalWebhook from "./routes/paypalWebhook.js";

app.use("/api/paypal", paypalWebhook);


// ✅ Definir __dirname en ESM (ANTES de usarlo)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Express app ---
const app = express();

// servir mp3
app.use("/media", express.static(path.join(__dirname, "../public/mp3")));

/**
 * ✅ 1) Stripe Webhook SIEMPRE antes de express.json()
 *    Porque Stripe necesita el body raw para validar firma.
 *    Tu router YA tiene express.raw(...) adentro, así que aquí NO ponemos raw.
 */
app.use("/api/billing", stripeWebhookRouter);

/**
 * ✅ 2) JSON normal para el resto de rutas
 */
app.use(express.json());

/**
 * ✅ 3) Middlewares generales
 */
app.use(cors());
app.use(helmet());
app.use(morgan("dev"));

// ✅ Auth para rutas privadas
app.use(requireAuth);

// ✅ Rutas privadas
app.use("/api/paypal", paypalRouter);
app.use("/api/payments", paymentsRouter);


/**
 * ✅ 4) Billing (checkout, etc.)
 *    Esto crea /api/billing/checkout (porque billingRouter define /checkout)
 */
app.use("/api/billing", billingRouter);

/**
 * ✅ 5) History
 */
app.use("/api/history", historyRouter);

// --- Helpers ---
//const __filename = fileURLToPath(import.meta.url);
//const __dirname = path.dirname(__filename);

function getMp3Path(beatId) {
    return path.join(__dirname, "..", "public", `${beatId}.mp3`);
}

// --- Dev / debug ---
app.get("/dev/whoami", requireAuth, (req, res) => {
    res.json({ userId: req.userId, plan: req.plan });
});

function setUserPlan(userId, plan) {
    db.prepare(`UPDATE users SET plan = ? WHERE id = ?`).run(plan, userId);
}

app.post("/dev/make-pro", requireAuth, (req, res) => {
    setUserPlan(req.userId, "pro");
    res.json({ ok: true, userId: req.userId, plan: "pro" });
});

app.post("/api/generate-mp3", async (req, res) => {
    try {
        const outDir = path.join(__dirname, "../public/mp3");
        const wavPath = path.join(outDir, "gen.wav");
        const mp3Path = path.join(outDir, "gen.mp3");

        // genera wav (tono 440hz, 3s)
        writeWavMonoSine({ outPath: wavPath, freq: 440, seconds: 3 });

        // convierte a mp3
        execFile("ffmpeg", ["-y", "-i", wavPath, mp3Path], (err) => {
            if (err) {
                return res.status(500).json({
                    error: "ffmpeg failed",
                    details: String(err?.message || err),
                });
            }
            res.json({ ok: true, url: "/media/gen.mp3" });
        });
    } catch (e) {
        res.status(500).json({ error: "generate failed", details: String(e?.message || e) });
    }
});


app.post("/dev/make-free", requireAuth, (req, res) => {
    setUserPlan(req.userId, "free");
    res.json({ ok: true, userId: req.userId, plan: "free" });
});

// --- API: MP3 gating ---
app.get("/api/beats/:id.mp3", requireAuth, (req, res) => {
    const userId = req.userId;
    const userPlan = req.plan;
    const beatId = req.params.id;

    if (userPlan !== "pro") {
        logHistory(userId, "download_mp3", "error", {
            beatId,
            reason: "upgrade_required",
        });
        return res.status(402).json({ error: "Upgrade required for MP3" });
    }

    logHistory(userId, "download_mp3", "ok", { beatId });

    const filePath = getMp3Path(beatId);
    return res.sendFile(filePath, (err) => {
        if (err) {
            logHistory(userId, "download_mp3", "error", {
                beatId,
                reason: "file_not_found",
            });
            res.status(err.statusCode || 404).json({ error: "MP3 not found" });
        }
    });
});
app.get("/health", (req, res) => res.json({ ok: true }));

app.get("/dev/routes", (req, res) => {
    const routes = [];

    function walk(layer, prefix = "") {
        if (!layer) return;

        // Router middleware
        if (layer.name === "router" && layer.handle?.stack) {
            layer.handle.stack.forEach((l) => walk(l, prefix));
            return;
        }

        // Regular route
        if (layer.route?.path) {
            const methods = Object.keys(layer.route.methods)
                .filter((m) => layer.route.methods[m])
                .map((m) => m.toUpperCase());

            routes.push({
                methods,
                path: prefix + layer.route.path,
            });
        }
    }

    // --- 404 ---
    app.use((req, res) => {
        res.status(404).json({ error: "Not found" });
    });

    app._router?.stack?.forEach((layer) => walk(layer, ""));
    res.json(routes);
});




// --- Listen ---
const PORT = process.env.PORT || 8091;
app.listen(PORT, "127.0.0.1", () => {
    console.log(`✅ Aprende backend on http://127.0.0.1:${PORT}`);
});

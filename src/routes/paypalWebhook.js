import express from "express";
import { db } from "../db.js";
import { paypalFetch } from "../lib/paypal.js";

const router = express.Router();

/**
 * POST /api/paypal/webhook
 * Webhook de PayPal (NO requiere auth)
 *
 * Requisitos:
 * - Esta ruta debe montarse ANTES de requireAuth en index.js
 * - Y debe tener express.json() activo para leer req.body (o ponerlo aquí)
 */

// ✅ Si tu app usa express.json() global, esto no es necesario.
// Pero ponerlo aquí hace el webhook más “a prueba de orden”.
router.use(express.json());

router.post("/webhook", async (req, res) => {
    try {
        // Headers que PayPal envía para verificar firma
        const transmissionId = req.headers["paypal-transmission-id"];
        const transmissionTime = req.headers["paypal-transmission-time"];
        const certUrl = req.headers["paypal-cert-url"];
        const authAlgo = req.headers["paypal-auth-algo"];
        const transmissionSig = req.headers["paypal-transmission-sig"];

        const webhookEvent = req.body;

        // ✅ Si falta webhook id, no podemos verificar
        if (!process.env.PAYPAL_WEBHOOK_ID) {
            return res.status(503).json({ error: "PayPal webhook disabled (missing PAYPAL_WEBHOOK_ID)" });
        }

        // ✅ Verificar firma
        const verify = await paypalFetch("/v1/notifications/verify-webhook-signature", {
            method: "POST",
            body: {
                auth_algo: authAlgo,
                cert_url: certUrl,
                transmission_id: transmissionId,
                transmission_sig: transmissionSig,
                transmission_time: transmissionTime,
                webhook_id: process.env.PAYPAL_WEBHOOK_ID,
                webhook_event: webhookEvent,
            },
        });

        if (verify?.verification_status !== "SUCCESS") {
            return res.status(400).json({ error: "Invalid PayPal webhook" });
        }

        // ✅ Solo manejamos pago completado
        if (webhookEvent?.event_type === "PAYMENT.CAPTURE.COMPLETED") {
            const capture = webhookEvent.resource;

            const orderId = capture?.supplementary_data?.related_ids?.order_id ?? null;
            const captureId = capture?.id ?? null;
            const status = capture?.status ?? "UNKNOWN";
            const amount = capture?.amount?.value ?? null;
            const currency = capture?.amount?.currency_code ?? null;

            const payerEmail =
                capture?.payer?.email_address ||
                webhookEvent?.resource?.payer?.email_address ||
                null;

            // ✅ 1) Resolver userId desde la ORDER (custom_id)
            let userId = null;

            if (orderId) {
                const order = await paypalFetch(`/v2/checkout/orders/${orderId}`, { method: "GET" });
                userId = order?.purchase_units?.[0]?.custom_id || null;
            }

            // Si no hay custom_id, mejor NO activar PRO
            if (!userId) {
                console.warn("PayPal webhook: missing custom_id on order", { orderId, captureId });
                return res.json({ ok: true, warning: "missing_custom_id" });
            }

            // ✅ Asegurar user en DB
            db.prepare(`INSERT OR IGNORE INTO users (id, plan) VALUES (?, 'free')`).run(userId);

            // ✅ 2) Guardar payment con user_id (idempotente por capture_id UNIQUE)
            if (captureId) {
                const exists = db.prepare("SELECT 1 FROM payments WHERE capture_id=?").get(captureId);
                if (!exists) {
                    db.prepare(`
            INSERT INTO payments
            (user_id, provider, provider_env, order_id, capture_id, status, amount, currency, payer_email)
            VALUES (?,?,?,?,?,?,?,?,?)
          `).run(
                        userId,
                        "paypal",
                        process.env.PAYPAL_ENV || "live",
                        orderId,
                        captureId,
                        status,
                        amount,
                        currency,
                        payerEmail
                    );
                }
            }

            // ✅ 3) Activar plan si status COMPLETED
            // Con tus planes nuevos, usamos plan_id = pro_monthly
            if (status === "COMPLETED") {
                db.prepare(`
          UPDATE users
          SET
            plan = 'pro',                 -- legacy (si todavía lo usas en partes viejas)
            plan_id = 'pro_monthly',      -- ✅ el plan real (nuevo)
            plan_status = 'active',
            plan_updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(userId);
            }

            return res.json({ ok: true });
        }

        // Otros eventos: por ahora ignoramos pero respondemos ok
        return res.json({ ok: true, ignored: webhookEvent?.event_type || "unknown" });
    } catch (e) {
        console.error("PayPal webhook error:", e);
        return res.status(500).json({
            error: "Webhook failure",
            details: String(e?.message || e),
        });
    }
});

export default router;

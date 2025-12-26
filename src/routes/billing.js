import express from "express";
import Stripe from "stripe";

const router = express.Router();

/**
 * ============================================================
 * 1) Stripe client
 * ============================================================
 */
const stripeKey = process.env.STRIPE_SECRET_KEY || "";
const stripe = stripeKey ? new Stripe(stripeKey) : null;

/**
 * ============================================================
 * 2) Configuración básica
 * ============================================================
 * FRONTEND_URL: donde vive tu frontend (para success/cancel)
 * Ej: http://localhost:3000
 * o en prod: https://tudominio.com
 */
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

/**
 * ============================================================
 * 3) Ruta: POST /api/billing/checkout
 * ============================================================
 * Crea una Checkout Session de Stripe.
 *
 * ✅ Lo importante (Opción A):
 * - ponemos metadata.userId en la session
 * - y también en la SUBSCRIPTION usando subscription_data.metadata
 *
 * Así luego en el webhook:
 * - sub.metadata.userId existe ✅
 */
router.post("/checkout", async (req, res) => {
    try {
        if (!stripe) {
            return res.status(503).json({ error: "Stripe disabled (missing key)" });
        }

        // ✅ tu middleware requireAuth debe poner esto:
        const userId = req.userId || req.user?.id || "demo-user-1";

        // (Opcional) define tu price_id en env:
        // STRIPE_PRICE_ID=price_123...
        const priceId = process.env.STRIPE_PRICE_ID;
        if (!priceId) {
            return res.status(500).json({ error: "Missing STRIPE_PRICE_ID" });
        }

        const session = await stripe.checkout.sessions.create({
            mode: "subscription",

            // ✅ lo que se cobra
            line_items: [{ price: priceId, quantity: 1 }],

            // ✅ URLs de retorno
            success_url: `${FRONTEND_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${FRONTEND_URL}/billing/cancel`,

            /**
             * ✅ AQUI ES LA CLAVE:
             * - metadata en la session (para checkout.session.completed)
             */
            metadata: {
                userId,
            },

            /**
             * ✅ Y AQUI TAMBIÉN:
             * subscription_data.metadata para que exista en:
             * - customer.subscription.updated
             * - customer.subscription.deleted
             */
            subscription_data: {
                metadata: {
                    userId,
                },
            },
        });

        return res.json({ ok: true, url: session.url });
    } catch (e) {
        console.error("checkout error", e);
        return res.status(500).json({
            error: "Failed to create checkout",
            details: String(e?.message || e),
        });
    }
});

export default router;

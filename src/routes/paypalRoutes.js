import express from "express";
import { paypalFetch } from "../lib/paypal.js";

const router = express.Router();

/**
 * Helpers
 */
function normalizeCurrency(input) {
    const c = String(input || "USD").toUpperCase().trim();
    // PayPal soporta muchas, pero nos quedamos con USD para no complicar.
    return c === "USD" ? "USD" : "USD";
}

function normalizeAmount(input) {
    // ⚠️ Recomendación: NO confiar en amount del cliente.
    // Aquí lo normalizamos por si lo sigues usando.
    const n = Number(input);
    if (!Number.isFinite(n) || n <= 0) return "9.99"; // fallback seguro
    // 2 decimales
    return n.toFixed(2);
}

/**
 * POST /api/paypal/create-order
 * Crea una orden PayPal y "amarra" el pago al usuario con custom_id
 *
 * Requiere auth porque se monta después de requireAuth
 */
router.post("/create-order", async (req, res) => {
    try {
        const userId = req.userId;

        // ✅ Si quieres precio fijo, fuerza aquí:
        // const amount = "9.99";
        // const currency = "USD";

        // ✅ Si por ahora lo dejas editable:
        const { amount: amountIn = "9.99", currency: currencyIn = "USD" } = req.body || {};
        const amount = normalizeAmount(amountIn);
        const currency = normalizeCurrency(currencyIn);

        const order = await paypalFetch("/v2/checkout/orders", {
            method: "POST",
            body: {
                intent: "CAPTURE",

                // ✅ Mejora UX / checkout
                application_context: {
                    brand_name: "Aprende",
                    user_action: "PAY_NOW",
                },

                purchase_units: [
                    {
                        amount: { currency_code: currency, value: amount },

                        // 🔐 CLAVE: este campo viaja hasta el webhook
                        // y nos permite saber qué usuario pagó.
                        custom_id: userId,
                    },
                ],
            },
        });

        return res.json(order);
    } catch (e) {
        return res.status(e.statusCode || 500).json({
            error: "Failed to create order",
            details: e.details || String(e?.message || e),
        });
    }
});

/**
 * POST /api/paypal/capture-order
 * Captura una orden PayPal
 *
 * Nota: aquí NO hacemos PRO definitivo.
 * Eso lo hace el webhook (fuente de verdad).
 */
router.post("/capture-order", async (req, res) => {
    try {
        const { orderID } = req.body || {};
        if (!orderID) return res.status(400).json({ error: "Missing orderID" });

        const capture = await paypalFetch(`/v2/checkout/orders/${orderID}/capture`, {
            method: "POST",
            body: {},
        });

        return res.json(capture);
    } catch (e) {
        return res.status(e.statusCode || 500).json({
            error: "Failed to capture order",
            details: e.details || String(e?.message || e),
        });
    }
});

export default router;

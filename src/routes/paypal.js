import express from "express";
import { paypalFetch } from "../payments/paypalClient.js";
import { db } from "../db.js";

// Si tu carpeta sigue siendo "Paiments", usa esta línea en lugar de la anterior:
// import { paypalFetch } from "../Paiments/paypalClient.js";

const router = express.Router();

// CREATE ORDER
router.post("/create-order", async (req, res) => {
    try {
        const { price = "19.99", currency = "USD" } = req.body || {};

        const order = await paypalFetch("/v2/checkout/orders", {
            method: "POST",
            body: {
                intent: "CAPTURE",
                purchase_units: [
                    {
                        amount: { currency_code: "USD", value: "19.99" },
                        description: "Aprende - Plan PRO",
                    },
                ],
            },
        });

        // Link para aprobar el pago (PayPal devuelve links HATEOAS)
        const approveUrl = order?.links?.find((link) => link.rel === "approve")?.href;

        res.json({
            id: order.id,
            status: order.status,
            approveUrl,
        });
    } catch (e) {
        res.status(e.statusCode || 500).json({
            error: "Failed to create PayPal order",
            details: e.details || e.message,
        });
    }
});

// CAPTURE ORDER
router.post("/capture-order", async (req, res) => {
    try {
        const { orderID } = req.body;
        if (!orderID) return res.status(400).json({ error: "Missing orderID" });

        const capture = await paypalFetch(`/v2/checkout/orders/${orderID}/capture`, {
            method: "POST",
            body: {},
        });

        const row = db.prepare("SELECT plan FROM users WHERE id=?").get(userId);
        if (row?.plan !== "pro" && capture.status === "COMPLETED") {
            db.prepare("UPDATE users SET plan='pro' WHERE id=?").run(userId);
        }

        // ✅ Upgrade automático a PRO si el pago fue completado
        if (capture?.status === "COMPLETED") {
            const userId = req.user?.id || "demo-user-1";
            db.prepare("UPDATE users SET plan = ? WHERE id = ?").run("pro", userId);
        }

        res.json(capture);
    } catch (e) {
        res.status(e.statusCode || 500).json({
            error: "Failed to capture PayPal order",
            details: e.details || e.message,
        });
    }
});

export default router;

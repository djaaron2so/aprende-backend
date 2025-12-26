import express from "express";
import PDFDocument from "pdfkit";
import { db } from "../db.js";

const router = express.Router();

/**
 * GET /api/payments/:captureId/receipt.pdf
 * Requiere auth (montar después de requireAuth en index.js)
 *
 * NOTA: Por ahora no ligamos payments -> userId (porque tu tabla payments no tiene user_id).
 * Más adelante lo mejor es agregar user_id a payments.
 */
router.get("/:captureId/receipt.pdf", (req, res) => {
    try {
        const { captureId } = req.params;

        // Busca pago por capture_id
        const payment = db
            .prepare(
                `SELECT provider, provider_env, order_id, capture_id, status, amount, currency, payer_email, created_at
         FROM payments
         WHERE capture_id = ?`
            )
            .get(captureId);

        if (!payment) {
            return res.status(404).json({ error: "Receipt not found" });
        }

        // ✅ Por privacidad: NO mostramos email por defecto
        const showEmail = req.query.show_email === "1";
        const payerEmailSafe = showEmail ? (payment.payer_email || "") : "Hidden";

        // Headers para PDF
        const filename = `receipt-${payment.capture_id}.pdf`;
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
        res.setHeader("Cache-Control", "no-store");

        // Crear PDF
        const doc = new PDFDocument({ size: "LETTER", margin: 50 });

        // Stream PDF → response
        doc.pipe(res);

        // --- Diseño simple y limpio ---
        doc.fontSize(20).text("Payment Receipt", { align: "center" });
        doc.moveDown(0.5);

        doc.fontSize(10).text("Saucedo / Aprende", { align: "center" });
        doc.moveDown(1);

        // Línea
        doc.moveTo(50, doc.y).lineTo(562, doc.y).stroke();
        doc.moveDown(1);

        const rows = [
            ["Provider", `${payment.provider} (${payment.provider_env})`],
            ["Status", String(payment.status || "")],
            ["Amount", `${payment.amount || ""} ${payment.currency || ""}`],
            ["Order ID", String(payment.order_id || "")],
            ["Capture ID", String(payment.capture_id || "")],
            ["Payer Email", payerEmailSafe],
            ["Created At", String(payment.created_at || "")],
        ];

        doc.fontSize(12);
        for (const [label, value] of rows) {
            doc.font("Helvetica-Bold").text(`${label}: `, { continued: true });
            doc.font("Helvetica").text(value);
            doc.moveDown(0.2);
        }

        doc.moveDown(1);
        doc.moveTo(50, doc.y).lineTo(562, doc.y).stroke();
        doc.moveDown(0.8);

        doc
            .fontSize(10)
            .text(
                "This receipt is generated automatically. Keep it for your records.",
                { align: "left" }
            );

        // Finalizar
        doc.end();
    } catch (e) {
        console.error("receipt error", e);
        return res.status(500).json({
            error: "Failed to generate receipt",
            details: String(e?.message || e),
        });
    }
});

export default router;

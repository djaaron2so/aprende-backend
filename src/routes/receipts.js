import express from "express";
import PDFDocument from "pdfkit";
import { db } from "../db.js";

const router = express.Router();

function pad(n, width = 6) {
    const s = String(n);
    return s.length >= width ? s : "0".repeat(width - s.length) + s;
}

function yyyymmdd(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}${m}${d}`;
}

function nextReceiptNumber() {
    const info = db.prepare(`INSERT INTO receipt_seq DEFAULT VALUES`).run();
    const seq = info.lastInsertRowid;
    return `R-${yyyymmdd()}-${pad(seq, 6)}`;
}

function sendReceiptPdf({ req, res, payment }) {
    const showEmail = req.query.show_email === "1";
    const payerEmail = showEmail ? (payment.payer_email || "") : "Hidden";
    const receiptNo = nextReceiptNumber();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="receipt-${payment.capture_id}.pdf"`);
    res.setHeader("Cache-Control", "no-store");

    const doc = new PDFDocument({ size: "LETTER", margin: 50 });
    doc.pipe(res);

    doc.fontSize(22).text("PAYMENT RECEIPT", { align: "center" });
    doc.moveDown(0.3);
    doc.fontSize(10).text("Aprende / Saucedo", { align: "center" });
    doc.moveDown(1);

    doc.moveTo(50, doc.y).lineTo(562, doc.y).stroke();
    doc.moveDown(1);

    doc.fontSize(12);
    doc.font("Helvetica-Bold").text("Receipt No: ", { continued: true });
    doc.font("Helvetica").text(receiptNo);

    doc.font("Helvetica-Bold").text("Date: ", { continued: true });
    doc.font("Helvetica").text(String(payment.created_at || ""));

    doc.moveDown(0.8);

    const providerLabel = payment.provider === "paypal" ? "PayPal" : String(payment.provider || "");
    const paidVia = `${providerLabel} (${payment.provider_env || ""})`;

    const rows = [
        ["Status", payment.status],
        ["Amount Paid", `${payment.amount} ${payment.currency}`],
        ["Paid Via", paidVia],
        ["Order ID", payment.order_id],
        ["Capture ID", payment.capture_id],
        ["Payer Email", payerEmail],
    ];

    for (const [label, value] of rows) {
        doc.font("Helvetica-Bold").text(`${label}: `, { continued: true });
        doc.font("Helvetica").text(String(value || ""));
        doc.moveDown(0.35);
    }

    doc.moveDown(0.8);
    doc.moveTo(50, doc.y).lineTo(562, doc.y).stroke();
    doc.moveDown(0.8);

    doc
        .fontSize(9)
        .text("This receipt was generated automatically. Keep it for your records.", {
            align: "left",
        });

    doc.end();
}

/**
 * ✅ IMPORTANTÍSIMO:
 * Esta ruta DEBE ir antes de la ruta dinámica /:captureId/receipt.pdf
 */
router.get("/latest/receipt.pdf", (req, res) => {
    try {
        const userId = req.userId;

        const payment = db
            .prepare(
                `SELECT user_id, provider, provider_env, order_id, capture_id,
                status, amount, currency, payer_email, created_at
         FROM payments
         WHERE user_id = ?
         ORDER BY id DESC
         LIMIT 1`
            )
            .get(userId);

        if (!payment) return res.status(404).json({ error: "No payments yet" });

        return sendReceiptPdf({ req, res, payment });
    } catch (e) {
        console.error("latest receipt error", e);
        return res.status(500).json({ error: "Failed to load latest receipt" });
    }
});

/**
 * GET /api/payments/:captureId/receipt.pdf
 * ✅ Solo dueño
 */
router.get("/:captureId/receipt.pdf", (req, res) => {
    try {
        const userId = req.userId;
        const { captureId } = req.params;

        const payment = db
            .prepare(
                `SELECT user_id, provider, provider_env, order_id, capture_id,
                status, amount, currency, payer_email, created_at
         FROM payments
         WHERE capture_id = ? AND user_id = ?`
            )
            .get(captureId, userId);

        if (!payment) return res.status(404).json({ error: "Receipt not found" });

        return sendReceiptPdf({ req, res, payment });
    } catch (e) {
        console.error("receipt error", e);
        return res.status(500).json({ error: "Failed to generate receipt" });
    }
});

export default router;

/**
 * lib/paypal.js
 * Helper para llamar la API de PayPal (Live o Sandbox)
 * Devuelve JSON y lanza error si PayPal responde con fallo.
 */

const baseUrl = () => {
    // Si usas PAYPAL_ENV=live o sandbox (opcional)
    const env = (process.env.PAYPAL_ENV || "live").toLowerCase();
    return env === "sandbox"
        ? "https://api-m.sandbox.paypal.com"
        : "https://api-m.paypal.com";
};

async function getAccessToken() {
    const clientId = process.env.PAYPAL_CLIENT_ID;
    const secret = process.env.PAYPAL_CLIENT_SECRET;

    if (!clientId || !secret) {
        throw new Error("Missing PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET");
    }

    const auth = Buffer.from(`${clientId}:${secret}`).toString("base64");

    const res = await fetch(`${baseUrl()}/v1/oauth2/token`, {
        method: "POST",
        headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
        throw new Error(`PayPal token error: ${res.status} ${JSON.stringify(data)}`);
    }

    return data.access_token;
}

export async function paypalFetch(endpoint, { method = "GET", body } = {}) {
    const token = await getAccessToken();

    const res = await fetch(`${baseUrl()}${endpoint}`, {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
        const msg = data?.message || data?.error_description || "PayPal API error";
        const err = new Error(msg);
        err.statusCode = res.status;
        err.details = data;
        throw err;
    }

    return data;
}

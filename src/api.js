const API_BASE = "http://127.0.0.1:8091";

export async function apiGetMe(token) {
    const r = await fetch(`${API_BASE}/api/me`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    return r.json();
}

export async function apiCreateOrder(token) {
    const r = await fetch(`${API_BASE}/api/paypal/create-order`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ amount: "9.99", currency: "USD" }),
    });
    return r.json();
}

export async function apiCaptureOrder(token, orderID) {
    const r = await fetch(`${API_BASE}/api/paypal/capture-order`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ orderID }),
    });
    return r.json();
}

export async function waitForPro(token, tries = 10, delayMs = 1000) {
    for (let i = 0; i < tries; i++) {
        const me = await apiGetMe(token);
        if (me?.features?.pro) return me;
        await new Promise((r) => setTimeout(r, delayMs));
    }
    return null;
}

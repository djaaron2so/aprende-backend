// src/lib/api.js

// ==============================
// API BASE
// ==============================
const DEFAULT_BASE =
    (typeof import.meta !== "undefined" &&
        import.meta.env &&
        import.meta.env.VITE_API_BASE) ||
    "https://aprende-backend.onrender.com";

export const API_BASE = String(DEFAULT_BASE).replace(/\/+$/, "");
// ==============================
// USAGE
// ==============================
export async function getUsage() {
    // tu backend responde en /api/usage
    return apiJson("/api/usage");
}

// ==============================
// AUTH TOKEN (temporal / demo)
// ==============================
export function getToken() {
    return localStorage.getItem("APRENDE_TOKEN") || "demo-user-1";
}

export function setToken(token) {
    if (!token) localStorage.removeItem("APRENDE_TOKEN");
    else localStorage.setItem("APRENDE_TOKEN", token);
}

// ==============================
// INTERNAL: ERROR FACTORY
// ==============================
function makeHttpError(message, status, data) {
    const err = new Error(message || `HTTP ${status}`);
    err.status = status;
    err.data = data ?? null;
    err.meta = data?.meta || null;
    return err;
}

// ==============================
// INTERNAL: SAFE JSON PARSE
// ==============================
function safeJsonParse(text) {
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch {
        return { raw: text };
    }
}

// ==============================
// CORE FETCH (AUTH / TIMEOUT / SAFE)
// ==============================
export async function apiFetch(path, options = {}) {
    const token = getToken();

    const url = String(path).startsWith("http")
        ? String(path)
        : `${API_BASE}${String(path).startsWith("/") ? "" : "/"}${path}`;

    const headers = new Headers(options.headers || {});

    // Auth
    if (token) headers.set("Authorization", `Bearer ${token}`);

    // JSON body helper
    const finalOptions = { ...options };
    if (finalOptions.json !== undefined) {
        headers.set("Content-Type", "application/json");
        finalOptions.body = JSON.stringify(finalOptions.json);
        delete finalOptions.json;
    }

    // Timeout / Abort
    const timeoutMs =
        typeof finalOptions.timeoutMs === "number" ? finalOptions.timeoutMs : 25_000;
    delete finalOptions.timeoutMs;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    // Allow passing a caller signal too (we’ll combine by prioritizing caller abort)
    const callerSignal = finalOptions.signal;
    delete finalOptions.signal;

    // If caller aborts, abort ours
    if (callerSignal) {
        if (callerSignal.aborted) controller.abort();
        else callerSignal.addEventListener("abort", () => controller.abort(), { once: true });
    }

    try {
        const res = await fetch(url, {
            ...finalOptions,
            headers,
            signal: controller.signal,
        });
        return res;
    } catch (e) {
        // Network/timeout style errors
        const msg =
            e?.name === "AbortError"
                ? "Request timeout"
                : e?.message || "Network error";
        throw new Error(msg);
    } finally {
        clearTimeout(timeout);
    }
}

// ==============================
// JSON HELPERS
// ==============================
export async function apiJson(path, options = {}) {
    const res = await apiFetch(path, options);
    const text = await res.text();
    const data = safeJsonParse(text);

    if (!res.ok) {
        const msg = data?.error || data?.message || `HTTP ${res.status}`;
        throw makeHttpError(msg, res.status, data);
    }

    return data;
}

export async function apiPostJson(path, json, options = {}) {
    return apiJson(path, {
        ...options,
        method: "POST",
        json,
    });
}

// ==============================
// SIGNED URL HELPERS (R2 WAV/MP3)
// ==============================

/**
 * GET signed url for WAV from backend.
 * Uses Authorization via apiJson internally.
 */
export async function getWavUrl(beatId) {
    if (!beatId) throw new Error("Missing beatId");
    const data = await apiJson(`/api/beats/${beatId}.wav-url`, { method: "GET" });
    if (!data?.url) throw new Error(data?.error || "Missing url in response");
    return data.url;
}

/**
 * (Opcional) si luego haces MP3:
 */
export async function getMp3Url(beatId) {
    if (!beatId) throw new Error("Missing beatId");
    const data = await apiJson(`/api/beats/${beatId}.mp3-url`, { method: "GET" });
    if (!data?.url) throw new Error(data?.error || "Missing url in response");
    return data.url;
}

// ==============================
// FILE DOWNLOAD (BLOB) WITH AUTH
// ==============================

/**
 * Para endpoints protegidos que regresan blob directo (si los usas).
 * En tu caso actual (signed URL) normalmente NO hace falta,
 * pero lo dejamos por si quieres bajar algo protegido.
 */
export async function fetchBlobWithAuth(path, options = {}) {
    const res = await apiFetch(path, { ...options, method: "GET" });

    if (!res.ok) {
        const text = await res.text();
        const data = safeJsonParse(text);
        const msg = data?.error || data?.message || `HTTP ${res.status}`;
        throw makeHttpError(msg, res.status, data);
    }

    return await res.blob();
}

export function openBlobInNewTab(blob, mimeType) {
    const finalBlob = mimeType ? new Blob([blob], { type: mimeType }) : blob;
    const url = URL.createObjectURL(finalBlob);
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function downloadBlob(blob, filename = "download") {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

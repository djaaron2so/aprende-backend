const PAYPAL_ENV = process.env.PAYPAL_ENV || "sandbox";

function getPayPalBaseUrl() {
  return PAYPAL_ENV === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}
console.log("PAYPAL_ENV raw:", process.env.PAYPAL_ENV);
console.log("PAYPAL_BASE:", PAYPAL_BASE);
console.log("PAYPAL_CLIENT_ID prefix:", (process.env.PAYPAL_CLIENT_ID || "").slice(0, 8));

async function getAccessToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    const err = new Error("PayPal disabled (missing keys)");
      err.statusCode = 503; "no encontrado";
    throw err;
  }

  const baseUrl = getPayPalBaseUrl();
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  const data = await res.json();
  if (!res.ok) {
    const err = new Error("Failed to get PayPal access token");
    err.statusCode = 500;
    err.details = data;
    throw err;
  }

  return data.access_token;
}

export async function paypalFetch(path, { method = "GET", headers = {}, body } = {}) {
  const baseUrl = getPayPalBaseUrl();
  const token = await getAccessToken();

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`PayPal API error: ${res.status}`);
    err.statusCode = res.status;
    err.details = data;
    throw err;
  }
  return data;
}

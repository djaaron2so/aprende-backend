import { useEffect, useMemo, useState } from "react";
import { PayPalScriptProvider, PayPalButtons } from "@paypal/react-paypal-js";
import { apiGetMe, apiCreateOrder, apiCaptureOrder, waitForPro } from "./api";
import UsagePanel from "./components/UsagePanel";

export default function App() {
    return (
        <div style={{ maxWidth: 900, margin: "0 auto", padding: 16 }}>
            <UsagePanel />
            {/* aquí abajo va tu lista de beats */}
        </div>
    );
    // ✅ Usuario de prueba FREE para que salga el botón
    const token = useMemo(() => "user-test-1", []);

    const [me, setMe] = useState(null);
    const [msg, setMsg] = useState("");

    // ✅ Pega aquí tu PAYPAL_CLIENT_ID (LIVE)
    const PAYPAL_CLIENT_ID = AbvPPGNtUvZa5mUWSov84lFK6DBIGpRUV7nSjvOjm - IK7hjSJWzu2q - jOOY - 2R1XXlFCsW3LjYeeVTEP

    useEffect(() => {
        apiGetMe(token).then(setMe);
    }, [token]);

    if (!me) return <div style={{ padding: 20 }}>Cargando…</div>;

    const isPro = !!me?.features?.pro;

    return (
        <div style={{ padding: 20, fontFamily: "system-ui" }}>
            <h2>Aprende</h2>

            <div style={{ marginBottom: 12 }}>
                <div><b>User:</b> {me.user.id}</div>
                <div><b>Plan:</b> {me.user.plan}</div>
                <div><b>PRO:</b> {isPro ? "✅" : "❌"}</div>
            </div>

            {isPro ? (
                <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 12 }}>
                    ✅ Ya eres PRO.
                    <div style={{ marginTop: 10 }}>
                        <button onClick={async () => setMe(await apiGetMe(token))}>Refrescar</button>
                    </div>
                </div>
            ) : (
                <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 12 }}>
                    <h3>Upgrade a PRO</h3>

                    <PayPalScriptProvider options={{ clientId: PAYPAL_CLIENT_ID, currency: "USD" }}>
                        <PayPalButtons
                            style={{ layout: "vertical" }}
                            createOrder={async () => {
                                setMsg("Creando orden…");
                                const order = await apiCreateOrder(token);
                                if (!order?.id) throw new Error("No order id");
                                setMsg("");
                                return order.id;
                            }}
                            onApprove={async (data) => {
                                setMsg("Capturando pago…");
                                await apiCaptureOrder(token, data.orderID);

                                setMsg("Confirmando PRO (webhook)…");
                                const updated = await waitForPro(token);
                                if (updated) {
                                    setMe(updated);
                                    setMsg("✅ Listo, ya eres PRO");
                                } else {
                                    setMsg("Pago capturado, espera unos segundos y refresca.");
                                }
                            }}
                            onCancel={() => setMsg("Pago cancelado")}
                            onError={() => setMsg("Error PayPal")}
                        />
                    </PayPalScriptProvider>

                    {msg ? <p style={{ marginTop: 10 }}>{msg}</p> : null}
                </div>
            )}
        </div>
    );
}

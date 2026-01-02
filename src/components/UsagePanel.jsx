import { useEffect, useState } from "react";
import { getUsage } from "../lib/api";

function fmt(n) {
    if (n === null || n === undefined) return "∞";
    const x = Number(n);
    return Number.isFinite(x) ? String(x) : "∞";
}

function pillStyle(bg) {
    return {
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 10px",
        borderRadius: 999,
        background: bg,
        fontSize: 12,
        fontWeight: 600,
    };
}

export default function UsagePanel() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState("");

    async function load() {
        setLoading(true);
        setErr("");
        try {
            const js = await getUsage();
            setData(js);
        } catch (e) {
            setErr(e?.message || "Failed to load usage");
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        load();
    }, []);

    if (loading) {
        return (
            <div style={{ padding: 12, border: "1px solid #eee", borderRadius: 12 }}>
                Cargando usage...
            </div>
        );
    }

    if (err) {
        return (
            <div style={{ padding: 12, border: "1px solid #f3c", borderRadius: 12 }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>Error</div>
                <div style={{ marginBottom: 10 }}>{err}</div>
                <button onClick={load}>Reintentar</button>
            </div>
        );
    }

    const plan = data?.plan || "free";
    const isPro = String(plan).toLowerCase().startsWith("pro");

    const beats = data?.beats || {};
    const mp3 = data?.mp3_exports || {};

    return (
        <div style={{ padding: 12, border: "1px solid #eee", borderRadius: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                <div>
                    <div style={{ fontSize: 14, fontWeight: 800 }}>Plan & Límites</div>
                    <div style={{ fontSize: 12, opacity: 0.75 }}>
                        {data?.day} · {data?.month} · {data?.tz}
                    </div>
                </div>

                <div style={pillStyle(isPro ? "#eaffea" : "#fff2e8")}>
                    <span>{isPro ? "✅ PRO" : "🆓 FREE"}</span>
                    <span style={{ opacity: 0.8 }}>{plan}</span>
                </div>
            </div>

            <hr style={{ margin: "12px 0", border: 0, borderTop: "1px solid #eee" }} />

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {/* Beats */}
                <div style={{ padding: 12, border: "1px solid #eee", borderRadius: 12 }}>
                    <div style={{ fontWeight: 800, marginBottom: 8 }}>🎛️ Beats</div>

                    <div style={{ fontSize: 12, opacity: 0.8 }}>Hoy</div>
                    <div style={{ fontSize: 13 }}>
                        Usados: <b>{fmt(beats.usedToday)}</b> / Max: <b>{fmt(beats.maxDaily)}</b> · Restan:{" "}
                        <b>{fmt(beats.remainingToday)}</b>
                    </div>

                    <div style={{ height: 10 }} />

                    <div style={{ fontSize: 12, opacity: 0.8 }}>Mes</div>
                    <div style={{ fontSize: 13 }}>
                        Usados: <b>{fmt(beats.usedThisMonth)}</b> / Max: <b>{fmt(beats.maxMonthly)}</b> · Restan:{" "}
                        <b>{fmt(beats.remainingThisMonth)}</b>
                    </div>
                </div>

                {/* MP3 Exports */}
                <div style={{ padding: 12, border: "1px solid #eee", borderRadius: 12 }}>
                    <div style={{ fontWeight: 800, marginBottom: 8 }}>⬇️ MP3 Exports</div>

                    {!isPro ? (
                        <div style={{ fontSize: 13, opacity: 0.85 }}>
                            MP3 exports requieren <b>PRO</b>.
                        </div>
                    ) : (
                        <>
                            <div style={{ fontSize: 12, opacity: 0.8 }}>Mes</div>
                            <div style={{ fontSize: 13 }}>
                                Usados: <b>{fmt(mp3.usedThisMonth)}</b> / Max: <b>{fmt(mp3.max)}</b> · Restan:{" "}
                                <b>{fmt(mp3.remainingThisMonth)}</b>
                            </div>
                            <div style={{ marginTop: 10 }}>
                                <button onClick={load}>🔄 Refrescar</button>
                            </div>
                        </>
                    )}
                </div>
            </div>

            <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                <button onClick={load}>🔄 Refrescar</button>
            </div>
        </div>
    );
}

import { useEffect, useMemo, useState } from "react";
import { getUsage } from "../lib/api";

function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}
function fmt(v) {
    if (v === null || v === undefined) return "∞";
    const n = Number(v);
    return Number.isFinite(n) ? String(n) : "∞";
}
function clamp01(x) {
    return Math.max(0, Math.min(1, x));
}
function pctUsed(used, max) {
    const u = num(used);
    const m = num(max);
    if (u === null || m === null || m <= 0) return null;
    return clamp01(u / m);
}
function statusColor(p) {
    if (p === null) return { bg: "#f5f5f5", fg: "#444", label: "∞" };
    if (p < 0.6) return { bg: "#eaffea", fg: "#0b6b2b", label: "OK" };
    if (p < 0.85) return { bg: "#fff6db", fg: "#7a5a00", label: "Cuidado" };
    return { bg: "#ffe3e3", fg: "#8a1212", label: "Casi lleno" };
}

function Pill({ text, bg, fg }) {
    return (
        <span
            style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "6px 10px",
                borderRadius: 999,
                background: bg,
                color: fg,
                fontSize: 12,
                fontWeight: 800,
                whiteSpace: "nowrap",
            }}
        >
            {text}
        </span>
    );
}

function Bar({ used, max }) {
    const p = pctUsed(used, max);
    const st = statusColor(p);
    const width = p === null ? 0 : Math.round(p * 100);

    return (
        <div style={{ marginTop: 8 }}>
            <div
                style={{
                    height: 10,
                    background: "#eee",
                    borderRadius: 999,
                    overflow: "hidden",
                    border: "1px solid #e6e6e6",
                }}
            >
                <div
                    style={{
                        height: "100%",
                        width: `${width}%`,
                        background: st.fg,
                        borderRadius: 999,
                        transition: "width 160ms ease",
                    }}
                />
            </div>
            <div style={{ marginTop: 6, fontSize: 12, color: "#666" }}>
                {p === null ? "Ilimitado" : `${width}% usado`}
            </div>
        </div>
    );
}

function Card({ title, right, children }) {
    return (
        <div
            style={{
                padding: 14,
                border: "1px solid #eee",
                borderRadius: 16,
                background: "#fff",
            }}
        >
            <div
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    alignItems: "baseline",
                    flexWrap: "wrap",
                }}
            >
                <div style={{ fontWeight: 1000, fontSize: 14 }}>{title}</div>
                {right}
            </div>
            <div style={{ marginTop: 10 }}>{children}</div>
        </div>
    );
}

export default function UsagePanel() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState("");

    const [isMobile, setIsMobile] = useState(() => {
        if (typeof window === "undefined") return false;
        return window.innerWidth < 720;
    });

    useEffect(() => {
        const onResize = () => setIsMobile(window.innerWidth < 720);
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, []);

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

    const plan = data?.plan || "free";
    const isPro = String(plan).toLowerCase().startsWith("pro");

    const beats = data?.beats || {};
    const mp3 = data?.mp3_exports || {};

    const beatsTodayP = useMemo(() => pctUsed(beats.usedToday, beats.maxDaily), [beats.usedToday, beats.maxDaily]);
    const beatsMonthP = useMemo(
        () => pctUsed(beats.usedThisMonth, beats.maxMonthly),
        [beats.usedThisMonth, beats.maxMonthly]
    );
    const mp3MonthP = useMemo(() => pctUsed(mp3.usedThisMonth, mp3.max), [mp3.usedThisMonth, mp3.max]);

    const planPill = isPro ? (
        <Pill text={`✅ PRO · ${plan}`} bg="#eaffea" fg="#0b6b2b" />
    ) : (
        <Pill text={`🆓 FREE · ${plan}`} bg="#fff2e8" fg="#7a3300" />
    );

    if (loading) {
        return (
            <div style={{ padding: 14, border: "1px solid #eee", borderRadius: 16, background: "#fff" }}>
                Cargando usage...
            </div>
        );
    }

    if (err) {
        return (
            <div style={{ padding: 14, border: "1px solid #ffd1d1", borderRadius: 16, background: "#fff" }}>
                <div style={{ fontWeight: 900, marginBottom: 8 }}>Error</div>
                <div style={{ marginBottom: 10 }}>{err}</div>
                <button onClick={load} style={{ padding: "10px 12px" }}>
                    Reintentar
                </button>
            </div>
        );
    }

    return (
        <div
            style={{
                padding: 14,
                border: "1px solid #eee",
                borderRadius: 16,
                background: "#fff",
            }}
        >
            {/* Header (móvil: apila) */}
            <div
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    alignItems: "center",
                    flexWrap: "wrap",
                }}
            >
                <div style={{ minWidth: isMobile ? "100%" : "auto" }}>
                    <div style={{ fontSize: 16, fontWeight: 1000 }}>Plan & Límites</div>
                    <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>
                        {data?.day} · {data?.month} · {data?.tz}
                    </div>
                </div>

                <div
                    style={{
                        display: "flex",
                        gap: 8,
                        alignItems: "center",
                        width: isMobile ? "100%" : "auto",
                        justifyContent: isMobile ? "space-between" : "flex-end",
                    }}
                >
                    {planPill}
                    <button
                        onClick={load}
                        style={{
                            padding: isMobile ? "10px 12px" : "8px 10px",
                            borderRadius: 12,
                            border: "1px solid #e6e6e6",
                            background: "#fafafa",
                            fontWeight: 800,
                            cursor: "pointer",
                        }}
                        title="Actualizar"
                    >
                        🔄
                    </button>
                </div>
            </div>

            <div style={{ height: 12 }} />

            {/* Grid responsive */}
            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
                    gap: 12,
                }}
            >
                <Card
                    title="🎛️ Beats"
                    right={
                        <Pill
                            text={statusColor(beatsMonthP).label}
                            bg={statusColor(beatsMonthP).bg}
                            fg={statusColor(beatsMonthP).fg}
                        />
                    }
                >
                    <div style={{ display: "grid", gap: 14 }}>
                        <div>
                            <div style={{ fontSize: 12, color: "#666" }}>Hoy</div>
                            <div style={{ fontSize: 13, marginTop: 4, lineHeight: 1.35 }}>
                                Usados: <b>{fmt(beats.usedToday)}</b> / Max: <b>{fmt(beats.maxDaily)}</b> · Restan:{" "}
                                <b>{fmt(beats.remainingToday)}</b>
                            </div>
                            <Bar used={beats.usedToday} max={beats.maxDaily} />
                            <div style={{ marginTop: 8 }}>
                                <Pill
                                    text={statusColor(beatsTodayP).label}
                                    bg={statusColor(beatsTodayP).bg}
                                    fg={statusColor(beatsTodayP).fg}
                                />
                            </div>
                        </div>

                        <div>
                            <div style={{ fontSize: 12, color: "#666" }}>Mes</div>
                            <div style={{ fontSize: 13, marginTop: 4, lineHeight: 1.35 }}>
                                Usados: <b>{fmt(beats.usedThisMonth)}</b> / Max: <b>{fmt(beats.maxMonthly)}</b> · Restan:{" "}
                                <b>{fmt(beats.remainingThisMonth)}</b>
                            </div>
                            <Bar used={beats.usedThisMonth} max={beats.maxMonthly} />
                        </div>
                    </div>
                </Card>

                <Card
                    title="⬇️ MP3 Exports"
                    right={
                        isPro ? (
                            <Pill
                                text={statusColor(mp3MonthP).label}
                                bg={statusColor(mp3MonthP).bg}
                                fg={statusColor(mp3MonthP).fg}
                            />
                        ) : (
                            <Pill text="PRO requerido" bg="#fff2e8" fg="#7a3300" />
                        )
                    }
                >
                    {!isPro ? (
                        <div style={{ fontSize: 13, color: "#666", lineHeight: 1.35 }}>
                            Para exportar MP3 necesitas <b>PRO</b>.
                        </div>
                    ) : (
                        <>
                            <div style={{ fontSize: 12, color: "#666" }}>Mes</div>
                            <div style={{ fontSize: 13, marginTop: 4, lineHeight: 1.35 }}>
                                Usados: <b>{fmt(mp3.usedThisMonth)}</b> / Max: <b>{fmt(mp3.max)}</b> · Restan:{" "}
                                <b>{fmt(mp3.remainingThisMonth)}</b>
                            </div>
                            <Bar used={mp3.usedThisMonth} max={mp3.max} />

                            {Number(mp3.remainingThisMonth) === 0 ? (
                                <div
                                    style={{
                                        marginTop: 10,
                                        padding: 10,
                                        borderRadius: 12,
                                        background: "#ffe3e3",
                                        color: "#8a1212",
                                        fontWeight: 800,
                                    }}
                                >
                                    Llegaste al límite mensual de MP3 exports.
                                </div>
                            ) : null}
                        </>
                    )}
                </Card>
            </div>

            {/* Nota compacta móvil */}
            {isMobile ? (
                <div style={{ marginTop: 12, fontSize: 12, color: "#666", lineHeight: 1.35 }}>
                    Tip: toca 🔄 para actualizar tus límites después de generar o exportar.
                </div>
            ) : null}
        </div>
    );
}

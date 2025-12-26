export const LA_TZ = "America/Los_Angeles";

function fmtLA(date = new Date()) {
    try {
        const parts = new Intl.DateTimeFormat("en-CA", {
            timeZone: LA_TZ,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        }).formatToParts(date);

        const y = parts.find(p => p.type === "year")?.value;
        const m = parts.find(p => p.type === "month")?.value;
        const d = parts.find(p => p.type === "day")?.value;

        if (!y || !m || !d) throw new Error("Invalid LA date parts");

        return { y, m, d };
    } catch {
        // fallback ultra seguro (no debería pasar nunca)
        const iso = new Date(
            date.toLocaleString("en-US", { timeZone: LA_TZ })
        ).toISOString();

        return {
            y: iso.slice(0, 4),
            m: iso.slice(5, 7),
            d: iso.slice(8, 10),
        };
    }
}

export function laDayISO(date = new Date()) {
    const { y, m, d } = fmtLA(date);
    return `${y}-${m}-${d}`; // YYYY-MM-DD
}

export function laMonthISO(date = new Date()) {
    const { y, m } = fmtLA(date);
    return `${y}-${m}`; // YYYY-MM
}

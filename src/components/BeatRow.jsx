import { useRef, useState } from "react";
import { getWavUrl, getMp3Url } from "../lib/api";

export default function BeatRow({ beat, isPro }) {
    const audioRef = useRef(null);
    const [wavUrl, setWavUrl] = useState(null);
    const [loading, setLoading] = useState(false);

    async function ensureWavUrl() {
        if (wavUrl) return wavUrl;
        const u = await getWavUrl(beat.id);
        setWavUrl(u);
        return u;
    }

    async function onPlay() {
        const audio = audioRef.current;
        if (!audio) return;

        setLoading(true);
        try {
            const u = await ensureWavUrl();
            audio.src = u;
            await audio.play();
        } catch (e) {
            // Si la URL expiró o falló, pide una nueva y reintenta 1 vez
            try {
                const fresh = await getWavUrl(beat.id);
                setWavUrl(fresh);
                audio.src = fresh;
                await audio.play();
            } catch {
                alert("No se pudo reproducir el WAV.");
            }
        } finally {
            setLoading(false);
        }
    }

    async function onDownloadWav() {
        setLoading(true);
        try {
            const u = await ensureWavUrl();
            window.open(u, "_blank", "noopener,noreferrer");
        } catch {
            try {
                const fresh = await getWavUrl(beat.id);
                setWavUrl(fresh);
                window.open(fresh, "_blank", "noopener,noreferrer");
            } catch {
                alert("No se pudo descargar el WAV.");
            }
        } finally {
            setLoading(false);
        }
    }

    async function onDownloadMp3() {
        if (!isPro) return alert("MP3 es solo para PRO.");
        setLoading(true);
        try {
            const u = await getMp3Url(beat.id);
            window.open(u, "_blank", "noopener,noreferrer");
        } catch (e) {
            alert(e?.message || "No se pudo descargar MP3.");
        } finally {
            setLoading(false);
        }
    }

    return (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button disabled={loading} onClick={onPlay}>
                ▶️ {loading ? "..." : "Play WAV"}
            </button>

            <button disabled={loading} onClick={onDownloadWav}>
                ⬇️ WAV
            </button>

            <button disabled={loading || !isPro} onClick={onDownloadMp3}>
                ⬇️ MP3 {isPro ? "" : "(PRO)"}
            </button>

            <audio ref={audioRef} controls preload="none" />
        </div>
    );
}

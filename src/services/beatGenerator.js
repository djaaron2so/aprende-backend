import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import { fileURLToPath } from "url";
import { normalizePeak, softLimiter } from "./audioDsp.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// === WAV utils (PCM 16-bit LE) ===
function readWavPCM16(filePath) {
    const buf = fs.readFileSync(filePath);

    if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
        throw new Error(`Invalid WAV (RIFF/WAVE) in ${filePath}`);
    }

    let offset = 12;
    let fmt = null;
    let dataOffset = -1;
    let dataSize = -1;

    while (offset + 8 <= buf.length) {
        const chunkId = buf.toString("ascii", offset, offset + 4);
        const chunkSize = buf.readUInt32LE(offset + 4);
        const chunkDataStart = offset + 8;

        if (chunkId === "fmt ") {
            const audioFormat = buf.readUInt16LE(chunkDataStart + 0);
            const numChannels = buf.readUInt16LE(chunkDataStart + 2);
            const sampleRate = buf.readUInt32LE(chunkDataStart + 4);
            const bitsPerSample = buf.readUInt16LE(chunkDataStart + 14);
            fmt = { audioFormat, numChannels, sampleRate, bitsPerSample };
        } else if (chunkId === "data") {
            dataOffset = chunkDataStart;
            dataSize = chunkSize;
            break;
        }

        offset = chunkDataStart + chunkSize + (chunkSize % 2);
    }

    if (!fmt) throw new Error(`Missing fmt chunk in ${filePath}`);
    if (dataOffset < 0) throw new Error(`Missing data chunk in ${filePath}`);
    if (fmt.audioFormat !== 1) throw new Error(`Only PCM supported (format=1). File: ${filePath}`);
    if (fmt.bitsPerSample !== 16) throw new Error(`Only 16-bit supported. File: ${filePath}`);

    // Convert to mono Int16Array (if stereo, average L+R)
    const bytesPerSample = 2;
    const frameSize = fmt.numChannels * bytesPerSample;
    const numFrames = Math.floor(dataSize / frameSize);

    const mono = new Int16Array(numFrames);

    let ptr = dataOffset;
    for (let i = 0; i < numFrames; i++) {
        if (fmt.numChannels === 1) {
            mono[i] = buf.readInt16LE(ptr);
        } else {
            let sum = 0;
            for (let ch = 0; ch < fmt.numChannels; ch++) {
                sum += buf.readInt16LE(ptr + ch * 2);
            }
            mono[i] = (sum / fmt.numChannels) | 0;
        }
        ptr += frameSize;
    }

    return { sampleRate: fmt.sampleRate, pcm: mono };
}

function writeWavPCM16(filePath, pcmMono, sampleRate = 44100) {
    const numChannels = 1;
    const bitsPerSample = 16;
    const bytesPerSample = bitsPerSample / 8;
    const dataSize = pcmMono.length * bytesPerSample;
    const byteRate = sampleRate * numChannels * bytesPerSample;
    const blockAlign = numChannels * bytesPerSample;

    const header = Buffer.alloc(44);
    header.write("RIFF", 0);
    header.writeUInt32LE(36 + dataSize, 4);
    header.write("WAVE", 8);
    header.write("fmt ", 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20); // PCM
    header.writeUInt16LE(numChannels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write("data", 36);
    header.writeUInt32LE(dataSize, 40);

    const data = Buffer.alloc(dataSize);
    for (let i = 0; i < pcmMono.length; i++) {
        data.writeInt16LE(pcmMono[i], i * 2);
    }

    fs.writeFileSync(filePath, Buffer.concat([header, data]));
}

function ensureDir(p) {
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function clamp16(x) {
    if (x > 32767) return 32767;
    if (x < -32768) return -32768;
    return x | 0;
}

// Add sample into buffer at startIndex with gain
function mixIn(out, sample, startIndex, gain = 1.0) {
    const n = sample.length;
    for (let i = 0; i < n; i++) {
        const j = startIndex + i;
        if (j < 0 || j >= out.length) break;
        out[j] = clamp16(out[j] + sample[i] * gain);
    }
}

// 16-step patterns
function buildPattern16(style = "dembow") {
    if (style === "club") {
        return {
            kick: [0, 6, 8, 10, 14],
            snare: [4, 12],
            hat: [0, 2, 4, 6, 8, 10, 12, 14, 15],
        };
    }

    if (style === "slow") {
        return {
            kick: [0, 8, 11],
            snare: [4, 12],
            hat: [0, 4, 8, 12],
        };
    }

    return {
        kick: [0, 7, 10],
        snare: [4, 12],
        hat: [0, 2, 4, 6, 8, 10, 12, 14],
    };
}

// Sección musical por barra
function sectionForBar(bar, totalBars) {
    if (totalBars < 8) return "verse";
    if (bar < 2) return "intro";

    if (totalBars >= 16) {
        if (bar < 6) return "verse";
        if (bar < 10) return "chorus";
        if (bar < 14) return "verse";
        if (bar < 16) return "outro";
        return "outro";
    }

    const mid = Math.floor(totalBars * 0.6);
    if (bar < mid) return "verse";
    return "chorus";
}

export async function generateBeatWav({
    bpm = 95,
    bars = 16,
    swing = 0,
    style = "dembow",
    energy = 2,
    density = 2,
    humanize = 0,
} = {}) {
    // ================================
    // Samples (LOCAL + RENDER SAFE)
    // ================================
    // Prioridad:
    // 1) ENV SAMPLES_DIR
    // 2) <project_root>/worker/samples  (Render y local)
    // ================================
    const sampleDir =
        process.env.SAMPLES_DIR ||
        path.resolve(process.cwd(), "worker", "samples");

    const kickPath = path.join(sampleDir, "dum.wav");
    const snarePath = path.join(sampleDir, "snare.wav");
    const hatPath = path.join(sampleDir, "hat.wav");

    function mustExist(p) {
        if (!fs.existsSync(p)) {
            throw new Error(`Missing sample: ${p}`);
        }
        return p;
    }

    mustExist(kickPath);
    mustExist(snarePath);
    mustExist(hatPath);


    if (!fs.existsSync(kickPath)) throw new Error(`Missing sample: ${kickPath}`);
    if (!fs.existsSync(snarePath)) throw new Error(`Missing sample: ${snarePath}`);
    if (!fs.existsSync(hatPath)) throw new Error(`Missing sample: ${hatPath}`);

    const kick = readWavPCM16(kickPath);
    const snare = readWavPCM16(snarePath);
    const hat = readWavPCM16(hatPath);

    const sr = kick.sampleRate;
    if (snare.sampleRate !== sr || hat.sampleRate !== sr) {
        throw new Error(
            `Sample rates differ. kick=${sr}, snare=${snare.sampleRate}, hat=${hat.sampleRate}. (Need resample)`
        );
    }

    // Timing
    const beatsPerBar = 4;
    const secondsPerBeat = 60 / bpm;
    const secondsPerBar = beatsPerBar * secondsPerBeat;
    const totalSeconds = bars * secondsPerBar;

    const outLen = Math.ceil(totalSeconds * sr);
    const out = new Int16Array(outLen);

    const stepsPerBar = 16;
    const stepSeconds = secondsPerBar / stepsPerBar;
    const stepSamples = Math.round(stepSeconds * sr);

    // Swing
    const swingAmt = Math.max(0, Math.min(0.35, Number(swing) || 0));
    function stepOffset(step) {
        return step % 2 === 1 ? Math.round(stepSamples * swingAmt) : 0;
    }

    // Humanize (ms)
    const humanMs = Math.max(0, Math.min(20, Number(humanize) || 0));
    function humanOffsetSamples() {
        if (!humanMs) return 0;
        const maxS = Math.round((humanMs / 1000) * sr);
        return Math.floor((Math.random() * 2 - 1) * maxS);
    }

    // Energy & density
    const e = Math.max(0, Math.min(3, Number(energy) || 2));
    const d = Math.max(0, Math.min(3, Number(density) || 2));

    const energyKick = [0.70, 0.85, 1.0, 1.10][e];
    const energySnare = [0.70, 0.85, 0.95, 1.05][e];
    const energyHat = [0.20, 0.35, 0.55, 0.70][e];

    function filterHats(hatSteps) {
        if (d === 3) return hatSteps;
        if (d === 2) return hatSteps;
        if (d === 1) return hatSteps.filter((s) => s % 4 === 0);
        return hatSteps.filter((s) => s === 0 || s === 8);
    }

    // Patterns
    const patVerse = buildPattern16(style);
    const patChorus = buildPattern16("club");
    const patIntro = buildPattern16("slow");
    const patFill = buildPattern16("club");

    // Mix sections
    for (let bar = 0; bar < bars; bar++) {
        const barStart = bar * stepsPerBar * stepSamples;
        const section = sectionForBar(bar, bars);

        const nextSection = bar + 1 < bars ? sectionForBar(bar + 1, bars) : "outro";
        const doFill = section !== "chorus" && nextSection === "chorus";

        let p = patVerse;
        let gKick = 0.95, gSnare = 0.9, gHat = 0.45;

        if (section === "intro") {
            p = patIntro;
            gKick = 0.65;
            gSnare = 0.75;
            gHat = 0.25;
        } else if (section === "chorus") {
            p = patChorus;
            gKick = 1.0;
            gSnare = 0.95;
            gHat = 0.55;
        } else if (section === "outro") {
            p = patIntro;
            gKick = 0.55;
            gSnare = 0.65;
            gHat = 0.20;
        }

        if (doFill) {
            p = patFill;
            gHat = Math.max(gHat, 0.55);
        }

        const hats = filterHats(p.hat);

        for (const s of p.kick) {
            mixIn(
                out,
                kick.pcm,
                barStart + s * stepSamples + stepOffset(s) + humanOffsetSamples(),
                gKick * energyKick
            );
        }

        for (const s of p.snare) {
            mixIn(
                out,
                snare.pcm,
                barStart + s * stepSamples + stepOffset(s) + humanOffsetSamples(),
                gSnare * energySnare
            );
        }

        for (const s of hats) {
            mixIn(
                out,
                hat.pcm,
                barStart + s * stepSamples + stepOffset(s) + humanOffsetSamples(),
                gHat * energyHat
            );
        }

        // Fill extra: 3 hats al final de la barra
        if (doFill) {
            const end = barStart + 15 * stepSamples;
            mixIn(out, hat.pcm, end + Math.round(stepSamples * 0.25), 0.40);
            mixIn(out, hat.pcm, end + Math.round(stepSamples * 0.50), 0.40);
            mixIn(out, hat.pcm, end + Math.round(stepSamples * 0.75), 0.40);
        }
    }

    // Save to public/beats (FUERA del loop)
    const outDir = path.join(__dirname, "..", "..", "public", "beats");
    ensureDir(outDir);

    const id = uuid();
    const filename = `${id}.wav`;
    const filePath = path.join(outDir, filename);

    // ✅ Sonido pro: limiter suave + normalización
    let mastered = softLimiter(out, 1.2);
    mastered = normalizePeak(mastered, 0.92);

    writeWavPCM16(filePath, mastered, sr);

    return { id, filename, filePath, bpm, bars, sampleRate: sr };
}

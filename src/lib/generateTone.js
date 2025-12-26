import fs from "fs";
import path from "path";

export function writeWavMonoSine({ outPath, freq = 440, seconds = 3, sampleRate = 44100 }) {
    const numSamples = Math.floor(sampleRate * seconds);
    const dataSize = numSamples * 2; // 16-bit mono
    const buffer = Buffer.alloc(44 + dataSize);

    // WAV header
    buffer.write("RIFF", 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write("WAVE", 8);

    buffer.write("fmt ", 12);
    buffer.writeUInt32LE(16, 16);        // PCM chunk size
    buffer.writeUInt16LE(1, 20);         // audio format = PCM
    buffer.writeUInt16LE(1, 22);         // channels = 1
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate = sampleRate * channels * bytesPerSample
    buffer.writeUInt16LE(2, 32);         // block align
    buffer.writeUInt16LE(16, 34);        // bits per sample

    buffer.write("data", 36);
    buffer.writeUInt32LE(dataSize, 40);

    // samples
    let offset = 44;
    for (let i = 0; i < numSamples; i++) {
        const t = i / sampleRate;
        const s = Math.sin(2 * Math.PI * freq * t);
        const int16 = Math.max(-1, Math.min(1, s)) * 32767;
        buffer.writeInt16LE(int16, offset);
        offset += 2;
    }

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, buffer);
}


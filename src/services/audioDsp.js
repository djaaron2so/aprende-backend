// DSP simple para Int16Array mono

function clamp16(x) {
  if (x > 32767) return 32767;
  if (x < -32768) return -32768;
  return x | 0;
}

// Normaliza a un pico objetivo (ej. 0.92)
export function normalizePeak(pcm, targetPeak = 0.92) {
  let peak = 0;
  for (let i = 0; i < pcm.length; i++) {
    const v = Math.abs(pcm[i]);
    if (v > peak) peak = v;
  }
  if (peak === 0) return pcm;

  const target = 32767 * targetPeak;
  const gain = target / peak;

  const out = new Int16Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = clamp16(pcm[i] * gain);
  return out;
}

// Soft limiter/clip (suave) para evitar distorsión dura
export function softLimiter(pcm, drive = 1.15) {
  const out = new Int16Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    // [-1..1]
    const x = (pcm[i] / 32768) * drive;
    // tanh-like soft clip (aprox)
    const y = x / (1 + Math.abs(x));
    out[i] = clamp16(y * 32767);
  }
  return out;
}

// Recorta silencio inicial simple (threshold)
export function trimLeadingSilence(pcm, threshold = 400) {
  let start = 0;
  while (start < pcm.length && Math.abs(pcm[start]) < threshold) start++;
  // deja un poquito de aire
  start = Math.max(0, start - 50);
  return pcm.slice(start);
}

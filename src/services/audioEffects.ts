/**
 * Engine-independent audio effects: speed (pitch-preserving), pitch (duration-preserving) and level.
 * Works on plain Float32Array samples so it can be tested without a browser.
 *
 * Time stretching uses WSOLA (waveform-similarity overlap-add): short windows are cut from the input at a different
 * rate than they are written, and each window is shifted a few milliseconds to the place where it best continues
 * the previous one, which avoids the "robot" echo of plain overlap-add.
 */
export function resample(x: Float32Array, factor: number): Float32Array {
  // factor > 1 reads faster: shorter output, higher pitch
  const n = Math.max(1, Math.floor(x.length / factor));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const pos = i * factor;
    const i0 = Math.floor(pos);
    const i1 = Math.min(x.length - 1, i0 + 1);
    out[i] = x[Math.min(i0, x.length - 1)] + (x[i1] - x[Math.min(i0, x.length - 1)]) * (pos - i0);
  }
  return out;
}

/** rate 1.25 = 25 % faster (shorter) with the same pitch; 0.8 = slower. */
export function timeStretch(x: Float32Array, rate: number, sr: number): Float32Array {
  if (Math.abs(rate - 1) < 0.005 || x.length < 64) return x;
  const N = Math.max(256, Math.round(sr * 0.03)) & ~1; // window
  const Hs = N / 2; // synthesis hop
  const Ha = Hs * rate; // nominal analysis hop
  const tol = Math.round(sr * 0.008);
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const outLen = Math.ceil(x.length / rate) + N * 2;
  const out = new Float32Array(outLen);
  const norm = new Float32Array(outLen);
  let prevPos = 0; // where the previous window was cut from
  let outPos = 0;
  let k = 0;
  while (true) {
    let pos: number;
    if (k === 0) {
      pos = 0;
    } else {
      const nominal = Math.round(k * Ha);
      const natural = prevPos + Hs; // where the previous window would continue
      pos = nominal;
      if (natural + N < x.length && nominal - tol >= 0) {
        let best = -Infinity;
        const lo = Math.max(0, nominal - tol);
        const hi = Math.min(x.length - N, nominal + tol);
        for (let c = lo; c <= hi; c += 2) {
          let dot = 0;
          for (let i = 0; i < Hs; i += 2) dot += x[c + i] * x[natural + i];
          if (dot > best) { best = dot; pos = c; }
        }
      }
    }
    if (pos + N > x.length + Hs) break;
    for (let i = 0; i < N; i++) {
      const v = pos + i < x.length ? x[pos + i] : 0;
      out[outPos + i] += v * win[i];
      norm[outPos + i] += win[i];
    }
    prevPos = pos;
    outPos += Hs;
    k++;
    if (outPos + N >= outLen) break;
  }
  const finalLen = Math.max(1, Math.round(x.length / rate));
  const res = new Float32Array(finalLen);
  for (let i = 0; i < finalLen; i++) res[i] = norm[i] > 1e-3 ? out[i] / norm[i] : 0;
  return res;
}

/** Shifts the pitch by `semitones` without changing the duration. Best within +-6 semitones. */
export function pitchShift(x: Float32Array, semitones: number, sr: number): Float32Array {
  if (Math.abs(semitones) < 0.05) return x;
  const r = Math.pow(2, semitones / 12);
  const resampled = resample(x, r); // pitch x r, duration / r
  return timeStretch(resampled, 1 / r, sr); // back to the original duration
}

/** Scales so the loudest sample sits at `peak` (0..1). Silence stays silence. */
export function normalizePeak(x: Float32Array, peak: number): Float32Array {
  let m = 0;
  for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > m) m = a; }
  if (m < 1e-6) return x;
  const g = peak / m;
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x[i] * g;
  return out;
}

export interface EffectOptions {
  /** extra speed to apply here (1 = none); engines that handle speed themselves pass 1 */
  speed?: number;
  /** semitones, -12..12 */
  pitch?: number;
  /** 0..100: the loudest sample is brought to this percentage of 0.95 full scale */
  volume?: number;
}

export function applyEffects(x: Float32Array, sr: number, o: EffectOptions): Float32Array {
  let y = x;
  if (o.pitch && Math.abs(o.pitch) >= 0.05) y = pitchShift(y, o.pitch, sr);
  if (o.speed && Math.abs(o.speed - 1) >= 0.005) y = timeStretch(y, o.speed, sr);
  if (o.volume !== undefined && o.volume >= 0) y = normalizePeak(y, 0.95 * Math.min(100, o.volume) / 100);
  return y;
}

import { timeStretch, pitchShift, applyEffects, normalizePeak } from '../src/services/audioEffects';
let ok = true;
const check = (l: string, c: boolean, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${x ? '  - ' + x : ''}`); if (!c) ok = false; };
const sr = 24000;
const sine = (f: number, sec: number, amp = 0.5) => Float32Array.from({ length: Math.round(sr * sec) }, (_, i) => amp * Math.sin((2 * Math.PI * f * i) / sr));
// dominant frequency by autocorrelation-free zero-crossing count in the middle part
const freq = (x: Float32Array) => {
  const a = Math.floor(x.length * 0.2), b = Math.floor(x.length * 0.8);
  let z = 0;
  for (let i = a + 1; i < b; i++) if (x[i - 1] <= 0 && x[i] > 0) z++;
  return z / ((b - a) / sr);
};
const speech = (sec: number) => Float32Array.from({ length: Math.round(sr * sec) }, (_, i) => { const t = i / sr; return 0.4 * Math.sin(2 * Math.PI * (180 + 30 * Math.sin(2 * Math.PI * 3 * t)) * t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 4 * t)); });

for (const rate of [1.25, 1.5, 0.8]) {
  const y = timeStretch(sine(440, 2), rate, sr);
  check(`speed x${rate}: duration changes by the rate`, Math.abs(y.length / sr - 2 / rate) < 0.03, `${(y.length / sr).toFixed(3)} s`);
  check(`speed x${rate}: pitch stays 440 Hz`, Math.abs(freq(y) - 440) < 12, `${freq(y).toFixed(1)} Hz`);
}
for (const st of [3, -4, 12, -12]) {
  const y = pitchShift(sine(300, 2), st, sr);
  const want = 300 * Math.pow(2, st / 12);
  check(`pitch ${st > 0 ? '+' : ''}${st} st: frequency ${want.toFixed(0)} Hz`, Math.abs(freq(y) - want) / want < 0.04, `${freq(y).toFixed(1)} Hz`);
  check(`pitch ${st} st: duration preserved`, Math.abs(y.length / sr - 2) < 0.04, `${(y.length / sr).toFixed(3)} s`);
}
const s = speech(3);
const y = timeStretch(s, 1.3, sr);
let peak = 0; for (const v of y) peak = Math.max(peak, Math.abs(v));
check('speech-like signal: no clipping or blow-up after stretching', peak <= 0.5, peak.toFixed(3));
let energyIn = 0, energyOut = 0; for (const v of s) energyIn += v * v; for (const v of y) energyOut += v * v;
check('loudness is kept (RMS within 15 %)', Math.abs(Math.sqrt(energyOut / y.length) / Math.sqrt(energyIn / s.length) - 1) < 0.15);
check('no NaN anywhere', !y.some(v => Number.isNaN(v)));
check('rate 1 returns the input untouched', timeStretch(s, 1.0, sr) === s);
check('very short input does not crash', timeStretch(new Float32Array(10), 1.5, sr).length === 10);

const n = normalizePeak(sine(200, 0.5, 0.2), 0.95 * 0.8);
let np = 0; for (const v of n) np = Math.max(np, Math.abs(v));
check('volume 80 -> peak 0.76', Math.abs(np - 0.76) < 0.001, np.toFixed(3));
check('silence stays silence', normalizePeak(new Float32Array(100), 0.9).every(v => v === 0));
const all = applyEffects(sine(220, 1.5), sr, { speed: 1.2, pitch: 2, volume: 50 });
check('combined effects: shorter, quieter', Math.abs(all.length / sr - 1.25) < 0.04 && Math.max(...all.slice(0, 20000).map(Math.abs)) < 0.5);
console.log(ok ? '\nALL AUDIO EFFECT CHECKS PASSED' : '\nSOME CHECKS FAILED');
process.exit(ok ? 0 : 1);

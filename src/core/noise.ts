/**
 * 阶次谱（Varterasian 法）：节距长度序列去均值 → 零填充 → DFT → 阶次谱。
 * 阶次 = 每转周期数；频率 = 阶次 × 转动频率。
 */
import type { PitchSequence, NoiseSpectrum, OrderLine } from './types';

/** 基 2 FFT（原地，迭代版），返回复系数实部/虚部 */
function fft(real: Float64Array, im: Float64Array): void {
  const n = real.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j]!, real[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = real[i + k]!;
        const ui = im[i + k]!;
        const vr = real[i + k + len / 2]! * cr - im[i + k + len / 2]! * ci;
        const vi = real[i + k + len / 2]! * ci + im[i + k + len / 2]! * cr;
        real[i + k] = ur + vr;
        im[i + k] = ui + vi;
        real[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

function nextPow2(n: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(n, 2)));
}

/** 节距长度序列（mm） */
export function pitchLengths(seq: PitchSequence): number[] {
  const m = new Map(seq.pitchTypes.map((p) => [p.id, p.length]));
  return seq.pitchIds.map((id) => m.get(id) ?? 0);
}

export const SPECTRUM_SAMPLES = 1024;

/**
 * 阶次谱。序列长度 n 对应一转，谱线 k 的阶次 = k·(n/N_padded)·(N_padded/n)=k
 * （零填充仅做频谱插值，阶次轴仍为每转周期数）。
 */
export function orderSpectrum(seq: PitchSequence, samples = SPECTRUM_SAMPLES): OrderLine[] {
  const lens = pitchLengths(seq);
  const n = lens.length;
  if (n < 2) return [];
  const mean = lens.reduce((a, b) => a + b, 0) / n;
  const N = Math.max(nextPow2(n), nextPow2(samples));
  const real = new Float64Array(N);
  const im = new Float64Array(N);
  for (let i = 0; i < n; i++) real[i] = lens[i]! - mean;
  fft(real, im);
  const lines: OrderLine[] = [];
  const norm = Math.max(n, 1);
  for (let k = 1; k < N / 2; k++) {
    lines.push({ order: (k * n) / N, magnitude: (Math.hypot(real[k]!, im[k]!) * 2) / norm });
  }
  return lines;
}

/** 环形归一化自相关（lag 1..N/2 的最大绝对值）；等节距（零方差）定义为 1=完全相关 */
export function maxAutocorrelation(seq: PitchSequence): number {
  const lens = pitchLengths(seq);
  const n = lens.length;
  if (n < 4) return 1;
  const mean = lens.reduce((a, b) => a + b, 0) / n;
  const v = lens.map((l) => l - mean);
  const denom = v.reduce((s, x) => s + x * x, 0);
  if (denom < 1e-12) return 1;
  let maxAc = 0;
  for (let lag = 1; lag <= Math.floor(n / 2); lag++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += v[i]! * v[(i + lag) % n]!;
    maxAc = Math.max(maxAc, Math.abs(s / denom));
  }
  return maxAc;
}

export function noiseSpectrum(seq: PitchSequence, speedKmh: number, rollingRadiusMm: number): NoiseSpectrum {
  const lines = orderSpectrum(seq);
  const vMmS = (speedKmh * 1_000_000) / 3600;
  const fRot = vMmS / (2 * Math.PI * Math.max(rollingRadiusMm, 1));
  let dominant = lines[0];
  for (const l of lines) if (l.magnitude > (dominant?.magnitude ?? 0)) dominant = l;
  const dominantOrder = dominant?.order ?? 0;
  return {
    lines,
    fundamentalHz: fRot,
    dominantOrder,
    dominantHz: dominantOrder * fRot,
    speedKmh,
  };
}

/**
 * 谱峰能量占比（主峰/总能量）。
 * 等节距序列去均值后无交流能量，定义为 1（能量完全集中、最响）。
 */
export function spectralPeakFraction(seq: PitchSequence): number {
  const lines = orderSpectrum(seq);
  let peak = 0;
  let sum = 0;
  for (const l of lines) {
    const e = l.magnitude * l.magnitude;
    sum += e;
    if (e > peak) peak = e;
  }
  return sum > 1e-18 ? peak / sum : 1;
}

/** 仅供测试/兼容：均匀信号 FFT 直流幅值守恒检查 */
export function fftMagnitude(realInput: Float64Array): Float64Array {
  const real = new Float64Array(realInput);
  const im = new Float64Array(real.length);
  fft(real, im);
  const mag = new Float64Array(real.length / 2);
  for (let i = 0; i < mag.length; i++) mag[i] = Math.hypot(real[i]!, im[i]!) / real.length;
  return mag;
}

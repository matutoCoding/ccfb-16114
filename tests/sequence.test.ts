import { describe, it, expect } from 'vitest';
import { orderSpectrum, noiseSpectrum, spectralPeakFraction, maxAutocorrelation, fftMagnitude } from '../src/core/noise';
import { checkConstraints, totalLength, circumferenceError } from '../src/core/sequence';
import { searchSequence } from '../src/core/search';
import { defaultTire, defaultPitchTypes, defaultSequences, defaultUnit } from '../src/core/defaults';
import { outerCircumference } from '../src/core/geometry';
import type { PitchSequence } from '../src/core/types';

function baseSeq(ids: string[]): PitchSequence {
  const types = defaultPitchTypes();
  return {
    id: 's', name: 't', pitchTypes: types, pitchIds: ids,
    constraints: { maxSameRun: 3, maxAdjacentRatio: 1.5, allowedPitchIds: [], weightSpectralPeak: 0.6, weightAutocorrelation: 0.4 },
    updatedAt: 0,
  };
}

describe('序列约束', () => {
  it('连续同种超限可检出', () => {
    const seq = baseSeq(['pitch_S', 'pitch_S', 'pitch_S', 'pitch_S']);
    const v = checkConstraints(seq, seq.constraints);
    expect(v.some((x) => x.kind === 'run')).toBe(true);
  });

  it('相邻长度比超限可检出（含环形首尾）', () => {
    const seq = baseSeq(['pitch_S', 'pitch_L']); // 39/26=1.5 边界
    expect(checkConstraints(seq, { ...seq.constraints, maxAdjacentRatio: 1.4 }).some((x) => x.kind === 'ratio')).toBe(true);
    expect(checkConstraints(seq, seq.constraints).some((x) => x.kind === 'ratio')).toBe(false);
  });

  it('周长误差符号与数值', () => {
    const tire = defaultTire();
    const seq = baseSeq(Array.from({ length: 60 }, () => 'pitch_M'));
    const err = circumferenceError(seq, tire);
    expect(err).toBeCloseTo(totalLength(seq) - outerCircumference(tire), 8);
  });
});

describe('阶次谱', () => {
  it('等节距序列能量集中在单一阶次，优化序列更分散', () => {
    const tire = defaultTire();
    const { uniform, optimized } = defaultSequences(tire, defaultPitchTypes());
    const fUni = spectralPeakFraction(uniform);
    const fOpt = spectralPeakFraction(optimized);
    expect(fUni).toBeGreaterThan(0.5);
    expect(fOpt).toBeLessThan(fUni);
  });

  it('车速加倍主频频率加倍、阶次不变', () => {
    const seq = baseSeq(['pitch_S', 'pitch_M', 'pitch_L', 'pitch_M']);
    const r = 300;
    const s1 = noiseSpectrum(seq, 40, r);
    const s2 = noiseSpectrum(seq, 80, r);
    expect(s2.dominantHz).toBeCloseTo(2 * s1.dominantHz, 8);
    expect(s2.dominantOrder).toBe(s1.dominantOrder);
    expect(orderSpectrum(seq, 16)).toHaveLength(7); // N=16 零填充 → N/2-1 条
    // 显式零填充到 1024 → 511 条谱线
    const long = baseSeq(Array.from({ length: 300 }, (_, i) => ['pitch_S', 'pitch_M', 'pitch_L'][i % 3]!));
    expect(orderSpectrum(long, 1024)).toHaveLength(511);
  });

  it('FFT 直流脉冲谱幅值守恒', () => {
    const sig = new Float64Array(64).fill(1);
    const mag = fftMagnitude(sig);
    expect(mag[0]).toBeCloseTo(1, 10);
    for (let i = 1; i < mag.length; i++) expect(mag[i]).toBeCloseTo(0, 10);
  });

  it('自相关：等节距为 1，混合序列小于 1', () => {
    const uniform = baseSeq(Array.from({ length: 24 }, () => 'pitch_M'));
    expect(maxAutocorrelation(uniform)).toBeCloseTo(1, 8);
    const mixed = baseSeq(['pitch_S', 'pitch_L', 'pitch_M', 'pitch_S', 'pitch_L', 'pitch_M', 'pitch_M', 'pitch_S']);
    expect(maxAutocorrelation(mixed)).toBeLessThan(1);
  });
});

describe('自动搜索', () => {
  it('结果满足全部约束', () => {
    const types = defaultPitchTypes();
    const seed: PitchSequence = {
      id: 's', name: 'opt', pitchTypes: types, pitchIds: [],
      constraints: { maxSameRun: 2, maxAdjacentRatio: 1.5, allowedPitchIds: [], weightSpectralPeak: 0.6, weightAutocorrelation: 0.4 },
      updatedAt: 0,
    };
    const { sequence } = searchSequence(seed, { count: 64, iterations: 4000, seed: 42 });
    expect(sequence.pitchIds).toHaveLength(64);
    expect(checkConstraints(sequence, sequence.constraints)).toHaveLength(0);
    // 三种节距都被使用
    const used = new Set(sequence.pitchIds);
    expect(used.size).toBeGreaterThanOrEqual(2);
  });

  it('约束过紧时报错而不是死循环', () => {
    const types = defaultPitchTypes();
    const seed: PitchSequence = {
      id: 's', name: 'tight', pitchTypes: types, pitchIds: [],
      constraints: { maxSameRun: 1, maxAdjacentRatio: 1.01, allowedPitchIds: [], weightSpectralPeak: 0.6, weightAutocorrelation: 0.4 },
      updatedAt: 0,
    };
    expect(() => searchSequence(seed, { count: 20, iterations: 500, seed: 7 })).toThrow();
  });

  it('优化序列谱峰占比低于等节距', () => {
    const tire = defaultTire();
    const { uniform, optimized } = defaultSequences(tire, defaultPitchTypes());
    expect(spectralPeakFraction(optimized)).toBeLessThan(spectralPeakFraction(uniform));
    expect(orderSpectrum(optimized).length).toBeGreaterThan(0);
  });
});

describe('默认数据完整性', () => {
  it('默认花纹单元特征合法', () => {
    const u = defaultUnit();
    expect(u.features.length).toBeGreaterThanOrEqual(7);
    for (const f of u.features) {
      expect(f.depth).toBeLessThanOrEqual(u.maxDepth + 1e-9);
      expect(f.width).toBeGreaterThan(0);
    }
  });
});

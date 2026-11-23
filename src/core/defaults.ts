/**
 * 默认数据：205/55R16 轿车胎，一套花纹单元配两套序列（等节距 / 三节距优化）。
 * 首次打开应用时写入 IndexedDB，直接进入对比视图。
 */
import type { PatternUnit, PitchSequence, PitchType, TireSpec, ProjectRecord } from './types';
import { uid } from './types';
import { searchSequence } from './search';
import { suggestPitchCount, uniformSequence } from './sequence';

export function defaultTire(): TireSpec {
  return {
    sectionWidth: 205,
    treadWidth: 170,
    aspectRatio: 55,
    rimDiameterIn: 16,
    crownDrop: 8.5,
    shoulderRadius: 12,
    load: 4900,
    inflationPressure: 220,
  };
}

export function defaultUnit(): PatternUnit {
  return {
    id: uid('unit'),
    name: '默认五沟花纹单元',
    baseLength: 32,
    treadWidth: 205,
    maxDepth: 8,
    updatedAt: Date.now(),
    features: [
      // 四条纵沟（205 胎面常用 4 沟布置）
      { id: uid('f'), kind: 'circumferential', position: -60, width: 8, depth: 8, wallAngle: 7, span: 1, skew: 0, yStart: 0, chamfer: 0.8 },
      { id: uid('f'), kind: 'circumferential', position: -20, width: 7, depth: 8, wallAngle: 7, span: 1, skew: 0, yStart: 0, chamfer: 0.8 },
      { id: uid('f'), kind: 'circumferential', position: 20, width: 7, depth: 8, wallAngle: 7, span: 1, skew: 0, yStart: 0, chamfer: 0.8 },
      { id: uid('f'), kind: 'circumferential', position: 60, width: 8, depth: 8, wallAngle: 7, span: 1, skew: 0, yStart: 0, chamfer: 0.8 },
      // 胎肩横沟（两侧，带倾角）
      { id: uid('f'), kind: 'lateral', position: 8, width: 5, depth: 7.5, wallAngle: 8, span: 36, skew: 22, yStart: 66, chamfer: 1 },
      { id: uid('f'), kind: 'lateral', position: 24, width: 5, depth: 7.5, wallAngle: 8, span: 36, skew: 22, yStart: -102, chamfer: 1 },
      // 中部横沟
      { id: uid('f'), kind: 'lateral', position: 16, width: 4, depth: 6, wallAngle: 6, span: 30, skew: 14, yStart: -15, chamfer: 0.6 },
      // 刀槽（细缝）
      { id: uid('f'), kind: 'sipe', position: 4, width: 0.8, depth: 4, wallAngle: 0, span: 26, skew: 10, yStart: -45, chamfer: 0 },
      { id: uid('f'), kind: 'sipe', position: 28, width: 0.8, depth: 4, wallAngle: 0, span: 26, skew: 10, yStart: 19, chamfer: 0 },
    ],
  };
}

export function defaultPitchTypes(): PitchType[] {
  return [
    { id: 'pitch_S', length: 26, label: 'S' },
    { id: 'pitch_M', length: 32, label: 'M' },
    { id: 'pitch_L', length: 39, label: 'L' },
  ];
}

function baseConstraints(allowed: string[]) {
  return {
    maxSameRun: 3,
    maxAdjacentRatio: 1.5,
    allowedPitchIds: allowed,
    weightSpectralPeak: 0.6,
    weightAutocorrelation: 0.4,
  };
}

export function defaultSequences(tire: TireSpec, types: PitchType[]): { uniform: PitchSequence; optimized: PitchSequence } {
  const count = suggestPitchCount(types, tire);
  const m = types.find((t) => t.label === 'M') ?? types[1]!;

  const uniform: PitchSequence = {
    id: uid('seq'),
    name: '等节距基准（全 M）',
    pitchTypes: types,
    pitchIds: uniformSequence(m, count),
    constraints: baseConstraints(types.map((t) => t.id)),
    updatedAt: Date.now(),
  };

  const seed: PitchSequence = {
    id: uid('seq'),
    name: '三节距优化序列',
    pitchTypes: types,
    pitchIds: [],
    constraints: baseConstraints(types.map((t) => t.id)),
    updatedAt: Date.now(),
  };
  const optimized = searchSequence(seed, { count, iterations: 20000, seed: 20260924 }).sequence;
  optimized.name = '三节距优化序列';

  return { uniform, optimized };
}

/** 规则矩形花纹块：仅矩形纵沟、无倒角无斜壁，专供精度校验 */
export function rectangularUnit(grooveWidths: number[], ys: number[], treadWidth = 200): PatternUnit {
  return {
    id: uid('unit'),
    name: '规则矩形校验单元',
    baseLength: 40,
    treadWidth,
    maxDepth: 8,
    updatedAt: Date.now(),
    features: grooveWidths.map((w, i) => ({
      id: uid('f'),
      kind: 'circumferential' as const,
      position: ys[i]!,
      width: w,
      depth: 8,
      wallAngle: 0,
      span: 1,
      skew: 0,
      yStart: 0,
      chamfer: 0,
    })),
  };
}

export function buildDefaultProject(): ProjectRecord {
  const tire = defaultTire();
  const unit = defaultUnit();
  const types = defaultPitchTypes();
  const { optimized } = defaultSequences(tire, types);
  return {
    id: uid('proj'),
    name: '205/55R16 降噪项目',
    tire,
    unit,
    sequence: optimized,
    updatedAt: Date.now(),
  };
}

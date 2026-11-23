/**
 * 节距序列：总长/周长匹配、约束校验、常用编辑操作。
 */
import type { PitchSequence, PitchType, PitchConstraints } from './types';
import { outerCircumference } from './geometry';
import type { TireSpec } from './types';

export function pitchLengthMap(seq: PitchSequence): Map<string, number> {
  return new Map(seq.pitchTypes.map((p) => [p.id, p.length]));
}

export function totalLength(seq: PitchSequence): number {
  const m = pitchLengthMap(seq);
  return seq.pitchIds.reduce((s, id) => s + (m.get(id) ?? 0), 0);
}

export function meanPitchLength(seq: PitchSequence): number {
  return seq.pitchIds.length ? totalLength(seq) / seq.pitchIds.length : 0;
}

/** 周长匹配误差 mm（>0 节距总长超出周长） */
export function circumferenceError(seq: PitchSequence, tire: TireSpec): number {
  return totalLength(seq) - outerCircumference(tire);
}

export interface ConstraintViolation {
  kind: 'run' | 'ratio' | 'allowed' | 'empty';
  message: string;
  at: number;
}

export function checkConstraints(seq: PitchSequence, c: PitchConstraints): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];
  const len = (id: string): number => seq.pitchTypes.find((p) => p.id === id)?.length ?? 0;
  if (seq.pitchIds.length === 0) {
    violations.push({ kind: 'empty', message: '序列为空', at: 0 });
    return violations;
  }
  if (c.allowedPitchIds.length > 0) {
    seq.pitchIds.forEach((id, i) => {
      if (!c.allowedPitchIds.includes(id)) {
        violations.push({ kind: 'allowed', message: `位置 ${i + 1} 使用了未允许的节距类型`, at: i });
      }
    });
  }
  // 连续同种节距
  let run = 1;
  for (let i = 1; i <= seq.pitchIds.length; i++) {
    if (i < seq.pitchIds.length && seq.pitchIds[i] === seq.pitchIds[i - 1]) {
      run++;
    } else {
      if (run > c.maxSameRun) {
        violations.push({ kind: 'run', message: `位置 ${i - run + 1}..${i} 同种节距连续 ${run} 次，超过上限 ${c.maxSameRun}`, at: i - 1 });
      }
      run = 1;
    }
  }
  // 相邻长度比（环形，首尾也检查）
  const n = seq.pitchIds.length;
  for (let i = 0; i < n; i++) {
    const l1 = len(seq.pitchIds[i]!);
    const l2 = len(seq.pitchIds[(i + 1) % n]!);
    const ratio = Math.max(l1, l2) / Math.min(l1, l2);
    if (ratio > c.maxAdjacentRatio + 1e-9) {
      violations.push({ kind: 'ratio', message: `位置 ${i + 1}→${(i + 1) % n + 1} 长度比 ${ratio.toFixed(2)} 超过 ${c.maxAdjacentRatio}`, at: i });
    }
  }
  return violations;
}

/** 交换两个位置（手排） */
export function swapPositions(seq: PitchSequence, i: number, j: number): PitchSequence {
  const ids = seq.pitchIds.slice();
  const tmp = ids[i]!;
  ids[i] = ids[j]!;
  ids[j] = tmp;
  return { ...seq, pitchIds: ids, updatedAt: Date.now() };
}

/** 替换某个位置的节距类型 */
export function setPitchAt(seq: PitchSequence, index: number, pitchId: string): PitchSequence {
  const ids = seq.pitchIds.slice();
  ids[index] = pitchId;
  return { ...seq, pitchIds: ids, updatedAt: Date.now() };
}

export function removePitchAt(seq: PitchSequence, index: number): PitchSequence {
  const ids = seq.pitchIds.slice();
  ids.splice(index, 1);
  return { ...seq, pitchIds: ids, updatedAt: Date.now() };
}

export function insertPitchAt(seq: PitchSequence, index: number, pitchId: string): PitchSequence {
  const ids = seq.pitchIds.slice();
  ids.splice(index, 0, pitchId);
  return { ...seq, pitchIds: ids, updatedAt: Date.now() };
}

/** 按周长估算建议节距数 */
export function suggestPitchCount(pitchTypes: PitchType[], tire: TireSpec): number {
  const mean = pitchTypes.reduce((s, p) => s + p.length, 0) / Math.max(pitchTypes.length, 1);
  return Math.round(outerCircumference(tire) / Math.max(mean, 1));
}

/** 构造等节距序列（对比基准用） */
export function uniformSequence(pitchType: PitchType, count: number): string[] {
  return Array.from({ length: count }, () => pitchType.id);
}

/**
 * 约束下节距序列自动搜索：
 * 随机可行构造（回溯）+ 模拟退火，目标=谱峰占比与自相关加权最小。
 */
import type { PitchConstraints, PitchSequence, PitchType } from './types';
import { maxAutocorrelation, spectralPeakFraction } from './noise';
import { checkConstraints, totalLength } from './sequence';

export interface SearchOptions {
  /** 目标节距个数 */
  count: number;
  /** 退火迭代步数 */
  iterations?: number;
  /** 随机种子（可复现） */
  seed?: number;
  /** 进度回调（每 1000 步） */
  onProgress?: (done: number, total: number, cost: number) => void;
}

/** 可复现的 mulberry32 随机源 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function isFeasible(ids: string[], i: number, candidate: string, types: PitchType[], c: PitchConstraints): boolean {
  if (c.allowedPitchIds.length > 0 && !c.allowedPitchIds.includes(candidate)) return false;
  const lenOf = (id: string) => types.find((p) => p.id === id)?.length ?? 0;
  // 连续同种
  if (c.maxSameRun > 0) {
    let run = 1;
    for (let k = i - 1; k >= 0 && ids[k] === candidate; k--) run++;
    if (run > c.maxSameRun) return false;
  }
  // 与前一个的长度比
  if (i > 0) {
    const r = Math.max(lenOf(candidate), lenOf(ids[i - 1]!)) / Math.min(lenOf(candidate), lenOf(ids[i - 1]!));
    if (r > c.maxAdjacentRatio + 1e-9) return false;
  }
  return true;
}

/** 回溯构造一条可行序列（环形首尾约束在收尾时检查，失败则重试） */
function randomFeasible(types: PitchType[], c: PitchConstraints, count: number, rnd: () => number): string[] | null {
  const pool = types.filter((t) => c.allowedPitchIds.length === 0 || c.allowedPitchIds.includes(t.id));
  if (pool.length === 0) return null;
  const ids: string[] = [];
  const lenOf = (id: string) => types.find((p) => p.id === id)?.length ?? 0;

  const backtrack = (): boolean => {
    if (ids.length === count) {
      // 环形闭合：首尾长度比 + 首尾同种连段
      const first = ids[0]!;
      const last = ids[count - 1]!;
      const ratio = Math.max(lenOf(first), lenOf(last)) / Math.min(lenOf(first), lenOf(last));
      if (ratio > c.maxAdjacentRatio + 1e-9) return false;
      if (first === last) {
        let run = 1;
        for (let k = count - 2; k >= 0 && ids[k] === last; k--) run++;
        for (let k = 1; k < count && ids[k] === first; k++) run++;
        if (run - 1 > c.maxSameRun) return false;
      }
      return true;
    }
    const order = pool.map((t) => ({ t, key: rnd() })).sort((a, b) => a.key - b.key).map((x) => x.t);
    for (const t of order) {
      if (isFeasible(ids, ids.length, t.id, types, c)) {
        ids.push(t.id);
        if (backtrack()) return true;
        ids.pop();
      }
    }
    return false;
  };

  return backtrack() ? ids : null;
}

function costOf(seq: PitchSequence, c: PitchConstraints): number {
  return c.weightSpectralPeak * spectralPeakFraction(seq) + c.weightAutocorrelation * maxAutocorrelation(seq);
}

export interface SearchResult {
  sequence: PitchSequence;
  cost: number;
  attempts: number;
}

export function searchSequence(base: PitchSequence, opts: SearchOptions): SearchResult {
  const iters = opts.iterations ?? 20000;
  const rnd = mulberry32(opts.seed ?? 1);
  const types = base.pitchTypes;
  const c = base.constraints;

  let ids: string[] | null = null;
  let attempts = 0;
  for (let tries = 0; tries < 200 && !ids; tries++) {
    attempts++;
    ids = randomFeasible(types, c, opts.count, rnd);
  }
  if (!ids) throw new Error('约束过紧，找不到可行排列，请放宽连续个数或相邻长度比限制');

  let current: PitchSequence = { ...base, pitchIds: ids, updatedAt: Date.now() };
  let best = current;
  let curCost = costOf(current, c);
  let bestCost = curCost;
  const pool = types.filter((t) => c.allowedPitchIds.length === 0 || c.allowedPitchIds.includes(t.id));

  /** 全量约束校验（含环形首尾、连续同种），杜绝局部检查漏网 */
  const fullyFeasible = (arr: string[]): boolean => {
    const probe: PitchSequence = { ...current, pitchIds: arr };
    return checkConstraints(probe, c).length === 0;
  };

  for (let step = 0; step < iters; step++) {
    const i = Math.floor(rnd() * ids.length);
    const next = current.pitchIds.slice();
    const j = Math.floor(rnd() * ids.length);
    if (i === j || current.pitchIds[i] === current.pitchIds[j]) {
      // 单点替换
      const candidate = pool[Math.floor(rnd() * pool.length)]!;
      if (next[i] === candidate.id) continue;
      next[i] = candidate.id;
    } else {
      // 换位
      const tmp = next[i]!;
      next[i] = next[j]!;
      next[j] = tmp;
    }
    if (!fullyFeasible(next)) continue;
    const candidateSeq = { ...current, pitchIds: next };
    const newCost = costOf(candidateSeq, c);
    const t = Math.max(1e-4, 1 - step / iters) * 0.05;
    if (newCost <= curCost || rnd() < Math.exp((curCost - newCost) / t)) {
      current = candidateSeq;
      curCost = newCost;
      if (newCost < bestCost) {
        best = current;
        bestCost = newCost;
      }
    }
    if (opts.onProgress && step % 1000 === 0) opts.onProgress(step, iters, bestCost);
  }
  opts.onProgress?.(iters, iters, bestCost);
  return { sequence: { ...best, updatedAt: Date.now() }, cost: bestCost, attempts };
}

/** 统计序列里各节距类型用量 */
export function pitchUsage(seq: PitchSequence): Record<string, number> {
  const usage: Record<string, number> = {};
  for (const id of seq.pitchIds) usage[id] = (usage[id] ?? 0) + 1;
  return usage;
}

export { totalLength };

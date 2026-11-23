/**
 * 花纹单元与整胎花纹带：周期化的花纹深度场求值。
 * 坐标：x 周向（mm，沿节距拼接方向），y 横向（胎面中线=0）。
 */
import type { PatternUnit, TreadFeature, PitchSequence } from './types';

const DEG = Math.PI / 180;

/** 沟在水平距离 d 处的剩余深度，mm；d 为到沟中心线的垂直距离 */
export function profileDepth(f: TreadFeature, d: number): number {
  const wallTan = Math.tan(f.wallAngle * DEG);
  // 沟口含倒角的总半宽；沟底半宽按沟壁角收窄
  const halfTop = f.width / 2 + f.chamfer;
  const halfBottom = Math.max(f.width / 2 - f.depth * wallTan, 0);
  if (d >= halfTop) return 0;
  if (d <= halfBottom) return f.depth;
  // 沟壁/倒角斜面：深度线性衰减到 0
  return f.depth * (halfTop - d) / Math.max(halfTop - halfBottom, 1e-9);
}

function wrapDelta(dx: number, period: number): number {
  return dx - period * Math.round(dx / period);
}

/** 点到线段的距离（二维） */
function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax;
  const vy = by - ay;
  const len2 = vx * vx + vy * vy || 1e-12;
  let t = ((px - ax) * vx + (py - ay) * vy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * vx;
  const cy = ay + t * vy;
  return Math.hypot(px - cx, py - cy);
}

export interface BandEvaluator {
  /** 整胎花纹带上全局坐标 (x,y) 处的花纹沟深度，mm（陆地=0） */
  depthAt(x: number, y: number): number;
  /** 全局 x 落在哪个节距（序号）及其局部坐标 */
  locatePitch(x: number): { index: number; localX: number; length: number };
  totalLength: number;
  pitchCount: number;
  unit: PatternUnit;
  sequence: PitchSequence;
}

export function buildBand(unit: PatternUnit, seq: PitchSequence): BandEvaluator {
  const lengthById = new Map(seq.pitchTypes.map((p) => [p.id, p.length]));
  const lengths = seq.pitchIds.map((id) => lengthById.get(id) ?? unit.baseLength);
  const starts: number[] = [];
  let total = 0;
  for (const L of lengths) {
    starts.push(total);
    total += L;
  }
  const L0 = unit.baseLength;

  const featureDepth = (f: TreadFeature, u: number, y: number): number => {
    if (f.kind === 'circumferential') {
      // 纵沟：y 向条带，span 为节距周向占比（1=贯通，接缝自动相连）
      if (f.span < 1) {
        const dx = wrapDelta(u - L0 / 2, L0);
        if (Math.abs(dx) > (f.span * L0) / 2) return 0;
      }
      return profileDepth(f, Math.abs(y - f.position));
    }
    // 横沟/刀槽：倾斜线段，周向周期延拓保证接缝连通
    const a = f.skew * DEG;
    const ax = f.position;
    const ay = f.yStart;
    const bx = f.position + f.span * Math.sin(a);
    const by = f.yStart + f.span * Math.cos(a);
    let best = Infinity;
    for (const shift of [-L0, 0, L0]) {
      best = Math.min(best, distToSegment(u + shift, y, ax, ay, bx, by));
    }
    return profileDepth(f, best);
  };

  const depthAt = (x: number, y: number): number => {
    if (total <= 0) return 0;
    const xw = ((x % total) + total) % total;
    // 二分定位节距
    let lo = 0;
    let hi = lengths.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (starts[mid + 1]! <= xw) lo = mid + 1;
      else hi = mid;
    }
    const idx = lo;
    const L = lengths[idx]!;
    const u = ((xw - starts[idx]!) / L) * L0; // 拉伸映射回设计坐标
    let d = 0;
    for (const f of unit.features) {
      const fd = featureDepth(f, u, y);
      if (fd > d) d = fd;
    }
    return Math.min(d, unit.maxDepth);
  };

  return {
    depthAt,
    locatePitch: (x: number) => {
      const xw = ((x % total) + total) % total;
      let lo = 0;
      let hi = lengths.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (starts[mid + 1]! <= xw) lo = mid + 1;
        else hi = mid;
      }
      return { index: lo, localX: xw - starts[lo]!, length: lengths[lo]! };
    },
    totalLength: total,
    pitchCount: lengths.length,
    unit,
    sequence: seq,
  };
}

/** 纵沟在局部设计坐标下的 y 位置列表（排水分析用） */
export function circumferentialGrooves(unit: PatternUnit): TreadFeature[] {
  return unit.features.filter((f) => f.kind === 'circumferential').sort((a, b) => a.position - b.position);
}

/** 几何手算辅助：矩形纵沟在宽度方向的开口占比（规则矩形块校验用） */
export function rectangularGrooveWidthFraction(unit: PatternUnit): number {
  const grooves = circumferentialGrooves(unit).filter((g) => g.chamfer === 0 && g.wallAngle === 0 && g.span >= 1);
  const gw = grooves.reduce((s, g) => s + g.width, 0);
  return gw / unit.treadWidth;
}

/**
 * 接地印痕 CPU 参考实现（同时是 WebGPU 结果的核对基准）。
 *
 * 面积统计采用 y 向条带积分：
 *  - 每条带的接地半长 a(y)=sqrt(2R(δ-c(y))) 由压扁模型解析给出；
 *  - 纵沟在条带内做区间精确求交（矩形花纹块下海 陆比误差仅来自二阶中点积分，
 *    比值中常值沟槽占比误差对消，满足 0.5% 红线）；
 *  - 横沟/刀槽沿 x 采样计入。
 * 深度场/掩膜按规则网格输出，供渲染与体积积分。
 */
import type { FootprintInput, FootprintResult, DrainageChannel, RollingFrame } from './types';
import { solveFootprint, crownDropAt, outerRadius, outerCircumference } from './geometry';
import { buildBand, circumferentialGrooves, type BandEvaluator } from './pattern';
import { totalLength } from './sequence';

/** 陆地判定深度阈值，mm（浅于此深度视为花纹块顶面） */
export const LAND_DEPTH_EPS = 0.25;

export interface FootprintOptions {
  phase?: number;
  /** 横沟 x 向每条纹带采样数（默认 256） */
  xSamplesPerRow?: number;
  backend?: 'webgpu' | 'cpu';
}

interface Interval {
  lo: number;
  hi: number;
}

function unionLength(intervals: Interval[], lo: number, hi: number): number {
  let total = 0;
  let curLo = -Infinity;
  let curHi = -Infinity;
  const sorted = intervals.filter((iv) => iv.hi > lo && iv.lo < hi).sort((a, b) => a.lo - b.lo);
  for (const iv of sorted) {
    const a = Math.max(iv.lo, lo);
    const b = Math.min(iv.hi, hi);
    if (a > curHi) {
      if (curHi > -Infinity) total += curHi - curLo;
      curLo = a;
      curHi = b;
    } else {
      curHi = Math.max(curHi, b);
    }
  }
  if (curHi > -Infinity) total += curHi - curLo;
  return Math.max(0, Math.min(total, hi - lo));
}

export function computeFootprint(input: FootprintInput, opts: FootprintOptions = {}): FootprintResult {
  const { tire, unit, sequence } = input;
  const geo = solveFootprint(tire);
  const band = buildBand(unit, sequence);
  const phase = opts.phase ?? 0;
  const R = geo.rollingRadius;
  const k = tire.crownDrop / ((tire.sectionWidth / 2) * (tire.sectionWidth / 2));

  const margin = 1.04;
  const xMax = geo.halfLengthCenter * margin;
  const yMax = geo.halfWidth * margin;
  const gx = input.gridX;
  const gy = input.gridY;
  const dx = (2 * xMax) / gx;
  const dy = (2 * yMax) / gy;

  const depthField = new Float32Array(gx * gy).fill(-1);
  const contactMask = new Uint8Array(gx * gy);

  // ---- 网格深度场（可视化 + 体积） ----
  let contactCells = 0;
  let grooveVolume = 0;
  for (let j = 0; j < gy; j++) {
    const y = -yMax + (j + 0.5) * dy;
    const drop = crownDropAt(tire, y);
    for (let i = 0; i < gx; i++) {
      const x = -xMax + (i + 0.5) * dx;
      const remain = geo.deflection - drop - (x * x) / (2 * R);
      if (remain <= 0) continue;
      const d = band.depthAt(x + phase, y);
      const idx = j * gx + i;
      contactMask[idx] = 1;
      contactCells++;
      depthField[idx] = d;
      grooveVolume += d * dx * dy;
    }
  }

  // ---- y 条带精确面积积分 ----
  const xSamples = opts.xSamplesPerRow ?? 256;
  const circs = circumferentialGrooves(unit);
  const laterals = unit.features.filter((f) => f.kind !== 'circumferential');
  let contactArea = 0;
  let grooveArea = 0;

  for (let j = 0; j < gy; j++) {
    const y0 = -yMax + j * dy;
    const y1 = y0 + dy;
    const yc = (y0 + y1) / 2;
    const remainC = geo.deflection - crownDropAt(tire, yc);
    if (remainC <= 0) continue;
    const a = Math.sqrt(2 * R * remainC); // 该行接地半长
    const rowArea = 2 * a * dy;
    contactArea += rowArea;

    // 纵沟：开口区间在条带内的精确并集长度，再换算到整条行面积
    const circIntervals: Interval[] = [];
    for (const g of circs) {
      if (g.span < 1) {
        // 非贯通纵沟：退化为采样判定
        let covered = 0;
        for (let s = 0; s < xSamples; s++) {
          const x = -a + (2 * a * s) / xSamples;
          if (band.depthAt(x + phase, yc) > LAND_DEPTH_EPS) covered++;
        }
        grooveArea += rowArea * (covered / xSamples);
        continue;
      }
      const halfTop = g.width / 2 + g.chamfer;
      // 陆/沟阈值处的实际半宽：剖面线性，反解 d=eps 对应距离
      const wallTan = Math.tan((g.wallAngle * Math.PI) / 180);
      const halfBottom = Math.max(g.width / 2 - g.depth * wallTan, 0);
      let halfAtEps: number;
      if (halfTop - halfBottom < 1e-9) {
        halfAtEps = halfTop;
      } else {
        halfAtEps = halfTop - ((LAND_DEPTH_EPS / g.depth) * (halfTop - halfBottom));
      }
      circIntervals.push({ lo: g.position - halfAtEps, hi: g.position + halfAtEps });
    }
    if (circIntervals.length > 0) {
      const coveredY = unionLength(circIntervals, y0, y1);
      grooveArea += (coveredY / dy) * rowArea;
    }

    // 横沟/刀槽：x 向采样（避开已计入纵沟的 y 部分）
    if (laterals.length > 0) {
      let lateralGroove = 0;
      const inCirc = circs.some((g) => g.span >= 1 && Math.abs(yc - g.position) <= g.width / 2 + g.chamfer);
      if (!inCirc) {
        for (let s = 0; s < xSamples; s++) {
          const x = -a + (2 * a * (s + 0.5)) / xSamples;
          // band.depthAt 取所有特征的最大深度；该 y 不在任何纵沟带内，故即横沟/刀槽贡献
          if (band.depthAt(x + phase, yc) > LAND_DEPTH_EPS) lateralGroove++;
        }
      }
      grooveArea += rowArea * (lateralGroove / xSamples);
    }
  }

  grooveArea = Math.min(grooveArea, contactArea);
  const landArea = contactArea - grooveArea;

  // ---- 排水：纵沟贯通性 ----
  const channels: DrainageChannel[] = circs.map((g) => {
    let landRuns = 0;
    let grooveCells = 0;
    let prevWasLand = false;
    let seenGroove = false;
    const n = Math.max(64, Math.ceil((2 * geo.halfLengthCenter) / Math.max(dx, 1)));
    for (let s = 0; s < n; s++) {
      const x = -geo.halfLengthCenter + (2 * geo.halfLengthCenter * (s + 0.5)) / n;
      const remain = geo.deflection - crownDropAt(tire, g.position) - (x * x) / (2 * R);
      if (remain <= 0) continue;
      const isGroove = band.depthAt(x + phase, g.position) > LAND_DEPTH_EPS;
      if (isGroove) {
        grooveCells++;
        seenGroove = true;
        prevWasLand = false;
      } else if (seenGroove) {
        // 只统计两段沟槽之间的陆地截断（入口前的陆地不算）
        if (!prevWasLand) landRuns++;
        prevWasLand = true;
      }
    }
    return {
      featureId: g.id,
      y: g.position,
      connected: landRuns === 0 && grooveCells > 0,
      cutCount: landRuns,
      grooveCells,
    };
  });

  const totalPitch = totalLength(sequence);
  const circumference = outerCircumference(tire);
  const gridContactArea = contactCells * dx * dy;

  return {
    contactLength: geo.contactLength,
    contactHalfWidth: geo.halfWidth,
    deflection: geo.deflection,
    contactArea,
    gridContactArea,
    nominalArea: geo.nominalArea,
    landArea,
    grooveArea,
    seaLandRatio: contactArea > 0 ? grooveArea / contactArea : 0,
    landRatio: contactArea > 0 ? landArea / contactArea : 1,
    grooveVolume,
    channels,
    depthField,
    contactMask,
    dx,
    dy,
    gridX: gx,
    gridY: gy,
    phase,
    totalPitchLength: totalPitch,
    circumference,
    circumferenceError: totalPitch - circumference,
    blockCount: sequence.pitchIds.length,
    backend: opts.backend ?? 'cpu',
  };
}

/**
 * 滚动一周期：相位扫过一个最短节距，统计每帧接地面积与边缘通量。
 * 帧数默认 96；edgeFlux = 进/出边缘单位角度的陆地面积变化率（mm²/deg）。
 */
export function computeRolling(input: FootprintInput, frames = 96, onFrame?: (i: number, n: number) => void): RollingFrame[] {
  const { tire, sequence } = input;
  const geo = solveFootprint(tire);
  const R = geo.rollingRadius;
  const minPitch = Math.min(...sequence.pitchTypes.map((p) => p.length));
  const period = minPitch || totalLength(sequence) / Math.max(sequence.pitchIds.length, 1);
  const out: RollingFrame[] = [];
  let prevLand: Uint8Array | null = null;
  const cellArea = ((2 * geo.halfLengthCenter * 1.04) / input.gridX) * ((2 * geo.halfWidth * 1.04) / input.gridY);

  for (let f = 0; f < frames; f++) {
    const phase = (f / frames) * period;
    const r = computeFootprint(input, { phase });
    const angleDeg = ((phase / R) * 180) / Math.PI;
    let edgeFlux = 0;
    if (prevLand) {
      let xor = 0;
      for (let i = 0; i < r.contactMask.length; i++) {
        const land = r.contactMask[i]! && r.depthField[i]! <= LAND_DEPTH_EPS ? 1 : 0;
        const prev = prevLand[i]!;
        if (land !== prev) xor++;
      }
      const dAngle = period / frames / R * (180 / Math.PI);
      edgeFlux = (xor * cellArea) / Math.max(dAngle, 1e-9);
    }
    const landNow = new Uint8Array(r.contactMask.length);
    for (let i = 0; i < r.contactMask.length; i++) {
      landNow[i] = r.contactMask[i]! && r.depthField[i]! <= LAND_DEPTH_EPS ? 1 : 0;
    }
    prevLand = landNow;
    out.push({ angleDeg, phase, contactArea: r.contactArea, landArea: r.landArea, edgeFlux });
    onFrame?.(f, frames);
  }
  return out;
}

export { outerRadius };

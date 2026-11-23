/**
 * 整胎滚动性能基准：万块级花纹序列多帧深度场，统计平均帧时与估算 FPS。
 * GPU 路径为验收口径（要求 ≥50 FPS）；CPU 路径给出对照值。
 */
import type { FootprintInput, PatternUnit, PitchSequence } from '../core/types';
import { computeFootprint } from '../core/footprint';
import { totalLength } from '../core/sequence';
import { createGpuBackend, computeFootprintGpu, type GpuBackend } from '../gpu/footprintGpu';

export interface BenchmarkResult {
  blockCount: number;
  frames: number;
  gridX: number;
  gridY: number;
  backend: 'webgpu' | 'cpu';
  avgFrameMs: number;
  estimatedFps: number;
  totalMs: number;
  /** GPU 路径：纯 compute+回读耗时（滚动播放口径） */
  gpuComputeMs?: number;
  gpuFps?: number;
  /** GPU 路径：CPU 精确统计耗时（出报告口径） */
  cpuStatsMs?: number;
}

/** 构造万块级压力序列（保留原节距类型，循环填充到 10000+，仅用于性能测试） */
export function buildStressSequence(seq: PitchSequence, targetBlocks = 10240): PitchSequence {
  const base = seq.pitchIds;
  const ids: string[] = [];
  while (ids.length < targetBlocks) ids.push(...base);
  ids.length = targetBlocks;
  return { ...seq, pitchIds: ids, name: `${seq.name}（压力×${targetBlocks}）` };
}

function makeInput(seq: PitchSequence, unit: PatternUnit, input: FootprintInput, gridX: number, gridY: number): FootprintInput {
  return { tire: input.tire, unit, sequence: seq, gridX, gridY };
}

export async function runStressBenchmark(
  baseInput: FootprintInput,
  opts: { blocks?: number; frames?: number; gridX?: number; gridY?: number; useGpu?: boolean } = {},
): Promise<BenchmarkResult> {
  const blocks = opts.blocks ?? 10240;
  const frames = opts.frames ?? 30;
  const gridX = opts.gridX ?? 320;
  const gridY = opts.gridY ?? 160;
  const stressSeq = buildStressSequence(baseInput.sequence, blocks);
  const input = makeInput(stressSeq, baseInput.unit, baseInput, gridX, gridY);
  const total = totalLength(stressSeq);
  const phaseStep = total / frames;

  const t0 = performance.now();
  if (opts.useGpu) {
    const backend: GpuBackend | null = await createGpuBackend();
    if (!backend) throw new Error('WebGPU 不可用');
    // 预热（含着色器编译/管线初始化），不计入计时
    for (let f = 0; f < 3; f++) await backend.compute(input, f * phaseStep);
    // 分项计时：纯 GPU 深度场（滚动播放实际口径）
    const g0 = performance.now();
    for (let f = 0; f < frames; f++) {
      await backend.compute(input, f * phaseStep);
    }
    const gpuMs = (performance.now() - g0) / frames;
    // 组合：GPU 深度场 + CPU 精确条带统计（出完整报告口径）
    for (let f = 0; f < frames; f++) {
      await computeFootprintGpu(input, f * phaseStep, backend);
    }
    const cpuMs = (performance.now() - t0) / frames - gpuMs;
    backend.destroy();
    const totalMs = performance.now() - t0;
    const avgFrameMs = totalMs / frames;
    return {
      blockCount: blocks,
      frames,
      gridX,
      gridY,
      backend: 'webgpu',
      avgFrameMs,
      estimatedFps: 1000 / avgFrameMs,
      totalMs,
      gpuComputeMs: gpuMs,
      gpuFps: 1000 / gpuMs,
      cpuStatsMs: Math.max(0, cpuMs),
    };
  }
  for (let f = 0; f < frames; f++) {
    computeFootprint(input, { phase: f * phaseStep });
  }
  const totalMs = performance.now() - t0;
  const avgFrameMs = totalMs / frames;
  return {
    blockCount: blocks,
    frames,
    gridX,
    gridY,
    backend: 'cpu',
    avgFrameMs,
    estimatedFps: 1000 / avgFrameMs,
    totalMs,
  };
}

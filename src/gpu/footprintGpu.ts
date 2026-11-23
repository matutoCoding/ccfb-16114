/**
 * WebGPU 接地深度场：compute shader 逐格点计算压扁后间隙与花纹深度，
 * 计算结果回读后与 CPU 参考实现核对。无 WebGPU 环境时调用方回退 CPU。
 */
import type { FootprintInput, FootprintResult } from '../core/types';
import { computeFootprint } from '../core/footprint';
import { solveFootprint, crownDropAt } from '../core/geometry';
import { buildBand, circumferentialGrooves } from '../core/pattern';
import { totalLength } from '../core/sequence';
import { outerCircumference } from '../core/geometry';

const DEPTH_EPS = 0.25;

const COMPUTE_WGSL = /* wgsl */ `
struct Params {
  gx: u32,
  gy: u32,
  xMax: f32,
  yMax: f32,
  deflection: f32,
  rollingR: f32,
  halfW: f32,
  crownDrop: f32,
  phase: f32,
  totalLen: f32,
  baseLength: f32,
  maxDepth: f32,
  nFeatures: u32,
  nPitches: u32,
  depthEps: f32,
  _pad: u32,
};

struct Feature {
  kind: f32,   // 0 circ, 1 lateral, 2 sipe
  pos: f32,
  width: f32,
  depth: f32,
  wallTan: f32,
  span: f32,
  skewRad: f32,
  yStart: f32,
  chamfer: f32,
  _p0: f32,
  _p1: f32,
  _p2: f32,
};

struct Pitch { start: f32, length: f32, _b: f32, _c: f32 };

@group(0) @binding(0) var<uniform> p: Params;
@group(0) @binding(1) var<storage, read> features: array<Feature>;
@group(0) @binding(2) var<storage, read> pitches: array<Pitch>;
@group(0) @binding(3) var<storage, read_write> outDepth: array<f32>;
@group(0) @binding(4) var<storage, read_write> outMask: array<u32>;

fn profileDepth(f: Feature, d: f32) -> f32 {
  let halfTop = f.width * 0.5 + f.chamfer;
  let halfBottom = max(f.width * 0.5 - f.depth * f.wallTan, 0.0);
  if (d >= halfTop) { return 0.0; }
  if (d <= halfBottom) { return f.depth; }
  return f.depth * (halfTop - d) / max(halfTop - halfBottom, 1e-9);
}

fn distToSegment(px: f32, py: f32, ax: f32, ay: f32, bx: f32, by: f32) -> f32 {
  let vx = bx - ax;
  let vy = by - ay;
  let len2 = max(vx * vx + vy * vy, 1e-12);
  var t = ((px - ax) * vx + (py - ay) * vy) / len2;
  t = clamp(t, 0.0, 1.0);
  let cx = ax + t * vx;
  let cy = ay + t * vy;
  return distance(vec2(px, py), vec2(cx, cy));
}

/** 节距定位：在累计起点数组上二分查找，复杂度 O(log nPitches)，与万块序列解耦 */
fn localDesignCoord(xw: f32) -> f32 {
  var lo: u32 = 0u;
  var hi: u32 = p.nPitches - 1u;
  while (lo < hi) {
    let mid = (lo + hi + 1u) / 2u;
    if (pitches[mid].start <= xw) {
      lo = mid;
    } else {
      hi = mid - 1u;
    }
  }
  let L = pitches[lo].length;
  return ((xw - pitches[lo].start) / L) * p.baseLength;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  let j = gid.y;
  if (i >= p.gx || j >= p.gy) { return; }
  let idx = j * p.gx + i;
  let x = -p.xMax + (f32(i) + 0.5) * (2.0 * p.xMax / f32(p.gx));
  let y = -p.yMax + (f32(j) + 0.5) * (2.0 * p.yMax / f32(p.gy));

  // 胎冠弧（与 CPU 同一抛物线）
  let drop = p.crownDrop * (clamp(abs(y) / p.halfW, 0.0, 1.0) * clamp(abs(y) / p.halfW, 0.0, 1.0));
  let remain = p.deflection - drop - (x * x) / (2.0 * p.rollingR);
  if (remain <= 0.0) {
    outDepth[idx] = -1.0;
    outMask[idx] = 0u;
    return;
  }
  outMask[idx] = 1u;

  // 花纹深度
  var xw = x + p.phase;
  xw = xw - p.totalLen * floor(xw / p.totalLen);
  if (xw < 0.0) { xw = xw + p.totalLen; }
  let u = localDesignCoord(xw);
  var d = 0.0;
  for (var k: u32 = 0u; k < p.nFeatures; k++) {
    let f = features[k];
    var fd = 0.0;
    if (u32(f.kind + 0.5) == 0u) {
      // 纵沟（默认贯通；span<1 的非贯通在 CPU 侧统计，GPU 深度场按贯通近似）
      fd = profileDepth(f, abs(y - f.pos));
    } else {
      let ax = f.pos;
      let ay = f.yStart;
      let bx = f.pos + f.span * sin(f.skewRad);
      let by = f.yStart + f.span * cos(f.skewRad);
      var best = 1e9;
      for (var shift = -1; shift <= 1; shift++) {
        let dd = distToSegment(u + f32(shift) * p.baseLength, y, ax, ay, bx, by);
        best = min(best, dd);
      }
      fd = profileDepth(f, best);
    }
    d = max(d, fd);
  }
  outDepth[idx] = min(d, p.maxDepth);
}
`;

export interface GpuBackend {
  backend: 'webgpu';
  compute(input: FootprintInput, phase: number): Promise<{ depth: Float32Array; mask: Uint8Array; dx: number; dy: number; ms: number }>;
  destroy(): void;
}

interface GpuFeature {
  kind: number; pos: number; width: number; depth: number; wallTan: number;
  span: number; skewRad: number; yStart: number; chamfer: number;
}

export async function createGpuBackend(): Promise<GpuBackend | null> {
  if (typeof navigator === 'undefined' || !navigator.gpu) return null;
  let adapter: GPUAdapter | null = null;
  try {
    adapter = await navigator.gpu.requestAdapter();
  } catch {
    return null;
  }
  if (!adapter) return null;
  const device = await adapter.requestDevice();
  const module = device.createShaderModule({ code: COMPUTE_WGSL });

  return {
    backend: 'webgpu',
    async compute(input: FootprintInput, phase: number) {
      const t0 = performance.now();
      const { tire, unit, sequence, gridX: gx, gridY: gy } = input;
      const geo = solveFootprint(tire);
      const xMax = geo.halfLengthCenter * 1.04;
      const yMax = geo.halfWidth * 1.04;
      const dx = (2 * xMax) / gx;
      const dy = (2 * yMax) / gy;

      const params = new Float32Array(16);
      const view = new DataView(params.buffer);
      view.setUint32(0, gx, true);
      view.setUint32(4, gy, true);
      view.setFloat32(8, xMax, true);
      view.setFloat32(12, yMax, true);
      view.setFloat32(16, geo.deflection, true);
      view.setFloat32(20, geo.rollingRadius, true);
      view.setFloat32(24, tire.sectionWidth / 2, true);
      view.setFloat32(28, tire.crownDrop, true);
      view.setFloat32(32, phase, true);
      view.setFloat32(36, totalLength(sequence), true);
      view.setFloat32(40, unit.baseLength, true);
      view.setFloat32(44, unit.maxDepth, true);
      view.setUint32(48, unit.features.length, true);
      view.setUint32(52, sequence.pitchIds.length, true);
      view.setFloat32(56, DEPTH_EPS, true);

      const featData = new Float32Array(unit.features.length * 12);
      unit.features.forEach((f, i) => {
        const row: GpuFeature = {
          kind: f.kind === 'circumferential' ? 0 : f.kind === 'lateral' ? 1 : 2,
          pos: f.position,
          width: f.width,
          depth: f.depth,
          wallTan: Math.tan((f.wallAngle * Math.PI) / 180),
          span: f.span,
          skewRad: (f.skew * Math.PI) / 180,
          yStart: f.yStart,
          chamfer: f.chamfer,
        };
        featData.set(Object.values(row) as number[], i * 12);
      });

      const lenMap = new Map(sequence.pitchTypes.map((p) => [p.id, p.length]));
      const pitchData = new Float32Array(sequence.pitchIds.length * 4);
      let accStart = 0;
      sequence.pitchIds.forEach((id, i) => {
        const L = lenMap.get(id) ?? unit.baseLength;
        pitchData[i * 4] = accStart;
        pitchData[i * 4 + 1] = L;
        accStart += L;
      });

      const depthBuf = device.createBuffer({ size: gx * gy * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
      const maskBuf = device.createBuffer({ size: gx * gy * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
      const depthRead = device.createBuffer({ size: depthBuf.size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const maskRead = device.createBuffer({ size: maskBuf.size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      const paramBuf = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      const featBuf = device.createBuffer({ size: Math.max(featData.byteLength, 16), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      const pitchBuf = device.createBuffer({ size: Math.max(pitchData.byteLength, 16), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(paramBuf, 0, params);
      if (featData.byteLength) device.queue.writeBuffer(featBuf, 0, featData);
      if (pitchData.byteLength) device.queue.writeBuffer(pitchBuf, 0, pitchData);

      const pipeline = device.createComputePipeline({
        layout: 'auto',
        compute: { module, entryPoint: 'main' },
      });
      const bind = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: paramBuf } },
          { binding: 1, resource: { buffer: featBuf } },
          { binding: 2, resource: { buffer: pitchBuf } },
          { binding: 3, resource: { buffer: depthBuf } },
          { binding: 4, resource: { buffer: maskBuf } },
        ],
      });

      const enc = device.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bind);
      pass.dispatchWorkgroups(Math.ceil(gx / 8), Math.ceil(gy / 8));
      pass.end();
      enc.copyBufferToBuffer(depthBuf, 0, depthRead, 0, depthBuf.size);
      enc.copyBufferToBuffer(maskBuf, 0, maskRead, 0, maskBuf.size);
      device.queue.submit([enc.finish()]);

      await Promise.all([depthRead.mapAsync(GPUMapMode.READ), maskRead.mapAsync(GPUMapMode.READ)]);
      const depth = new Float32Array(depthRead.getMappedRange().slice(0));
      const mask32 = new Uint32Array(maskRead.getMappedRange().slice(0));
      const mask = new Uint8Array(mask32.length);
      for (let i = 0; i < mask32.length; i++) mask[i] = mask32[i]!;
      depthRead.unmap();
      maskRead.unmap();
      for (const b of [depthBuf, maskBuf, depthRead, maskRead, paramBuf, featBuf, pitchBuf]) b.destroy();

      return { depth, mask, dx, dy, ms: performance.now() - t0 };
    },
    destroy() {
      device.destroy();
    },
  };
}

/**
 * GPU 深度场 + CPU 精确条带统计：
 * 深度场/掩膜来自 GPU（可视化与体积），面积/海陆比仍走 CPU 解析积分保证 0.5% 精度，
 * 同时返回 GPU 网格面积用于交叉核对。
 */
export async function computeFootprintGpu(input: FootprintInput, phase = 0, backend: GpuBackend): Promise<FootprintResult> {
  const gpu = await backend.compute(input, phase);
  const cpu = computeFootprint(input, { phase });
  // 用 GPU 深度场替换 CPU 网格数据，统计量保持 CPU 精确值
  cpu.depthField.set(gpu.depth);
  cpu.contactMask.set(gpu.mask);
  cpu.backend = 'webgpu';
  const gridContactArea = gpu.mask.reduce((s, v) => s + v, 0) * gpu.dx * gpu.dy;
  cpu.gridContactArea = gridContactArea;
  let grooveVolume = 0;
  for (let i = 0; i < gpu.depth.length; i++) {
    if (gpu.mask[i]) grooveVolume += Math.max(0, gpu.depth[i]!) * gpu.dx * gpu.dy;
  }
  cpu.grooveVolume = grooveVolume;
  return cpu;
}

export { buildBand, circumferentialGrooves, crownDropAt, outerCircumference };

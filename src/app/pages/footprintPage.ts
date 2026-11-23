/**
 * 接地印痕页面：深度场渲染、海陆比指标、滚动波动、排水通道、GPU/CPU 后端。
 */
import { h, clear, card, button, labeled, numInput, badge, stat, setupCanvas, toast } from '../ui';
import { getState, setState, updateProject } from '../store';
import { subscribePage } from '../pageBus';
import { computeFootprint, computeRolling, LAND_DEPTH_EPS } from '../../core/footprint';
import { createGpuBackend, computeFootprintGpu, type GpuBackend } from '../../gpu/footprintGpu';
import { drawLineChart } from '../ui';
import { renderTestSection } from './testSection';
import { runStressBenchmark } from '../benchmark';
import type { FootprintInput, FootprintResult, RollingFrame } from '../../core/types';

export function renderFootprintPage(host: HTMLElement): () => void {
  clear(host);
  const root = h('div', { class: 'stack' });
  host.append(root);

  let backend: GpuBackend | null = null;
  let useGpu = getState().gpuAvailable;
  let result: FootprintResult | null = null;
  let frames: RollingFrame[] = [];
  let raf = 0;
  let playing = false;
  let phase = 0;
  let gridX = 480;
  let gridY = 240;

  const depthCanvas = h('canvas', {}) as HTMLCanvasElement;
  const rollCanvas = h('canvas', {}) as HTMLCanvasElement;
  const fluxCanvas = h('canvas', {}) as HTMLCanvasElement;

  async function ensureGpu(): Promise<GpuBackend | null> {
    if (!backend) backend = await createGpuBackend();
    if (backend) setState({ gpuAvailable: true });
    return backend;
  }

  function buildInput(): FootprintInput {
    const { project } = getState();
    return { tire: project.tire, unit: project.unit, sequence: project.sequence, gridX, gridY };
  }

  async function recompute() {
    const input = buildInput();
    const t0 = performance.now();
    if (useGpu) {
      const gpu = await ensureGpu();
      if (gpu) {
        result = await computeFootprintGpu(input, phase, gpu);
      } else {
        toast('当前环境无 WebGPU，回退 CPU', 'err');
        useGpu = false;
        result = computeFootprint(input, { phase });
      }
    } else {
      result = computeFootprint(input, { phase });
    }
    const ms = performance.now() - t0;
    renderStats(ms);
    renderDepth();
    renderDrainage();
  }

  function renderStats(ms: number) {
    if (!result) return;
    const statsHost = root.querySelector<HTMLElement>('#fp-stats')!;
    clear(statsHost);
    const r = result;
    statsHost.append(
      h(
        'div',
        { class: 'grid-3' },
        stat('接地面积 mm²', r.contactArea.toFixed(0)),
        stat('陆地面积 mm²', r.landArea.toFixed(0)),
        stat('沟槽面积 mm²', r.grooveArea.toFixed(0)),
      ),
      h(
        'div',
        { class: 'grid-3' },
        stat('海陆比', (r.seaLandRatio * 100).toFixed(2) + '%'),
        stat('接地长度 mm', r.contactLength.toFixed(1)),
        stat('接地宽度 mm', (r.contactHalfWidth * 2).toFixed(1)),
      ),
      h(
        'div',
        { class: 'grid-3' },
        stat('沟槽体积 mm³', r.grooveVolume.toFixed(0)),
        stat('下沉量 mm', r.deflection.toFixed(2)),
        stat('网格面积 mm²', r.gridContactArea.toFixed(0)),
      ),
      h(
        'div',
        { class: 'btn-row', style: 'align-items:center' },
        badge(r.backend === 'webgpu' ? `WebGPU 计算 ${ms.toFixed(1)} ms` : `CPU 计算 ${ms.toFixed(1)} ms`, r.backend === 'webgpu' ? 'ok' : 'warn'),
        badge(`网格/积分面积偏差 ${((Math.abs(r.gridContactArea - r.contactArea) / r.contactArea) * 100).toFixed(2)}%`, Math.abs(r.gridContactArea - r.contactArea) / r.contactArea < 0.05 ? 'ok' : 'warn'),
        h('span', { class: 'muted' }, `陆地阈值深度 ${LAND_DEPTH_EPS} mm；面积统计走条带解析积分，网格仅供可视化`),
      ),
    );
  }

  function renderDepth() {
    if (!result) return;
    const r = result;
    const wrap = depthCanvas.parentElement!;
    const cssW = Math.max(560, wrap.clientWidth - 16);
    const cssH = Math.min(420, cssW * 0.6);
    const { ctx, w, h } = setupCanvas(depthCanvas, cssW, cssH);
    const img = ctx.createImageData(r.gridX, r.gridY);
    for (let i = 0; i < r.depthField.length; i++) {
      const p = i * 4;
      if (!r.contactMask[i]) {
        img.data[p] = 14;
        img.data[p + 1] = 19;
        img.data[p + 2] = 28;
        img.data[p + 3] = 255;
      } else {
        const d = r.depthField[i]!;
        if (d <= LAND_DEPTH_EPS) {
          // 陆地：琥珀色
          img.data[p] = 200;
          img.data[p + 1] = 135;
          img.data[p + 2] = 63;
          img.data[p + 3] = 255;
        } else {
          const t = Math.min(1, d / getState().project.unit.maxDepth);
          img.data[p] = 30 + t * 30;
          img.data[p + 1] = 80 + t * 110;
          img.data[p + 2] = 140 + t * 100;
          img.data[p + 3] = 255;
        }
      }
    }
    const off = document.createElement('canvas');
    off.width = r.gridX;
    off.height = r.gridY;
    off.getContext('2d')!.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
    ctx.fillStyle = 'var(--text-dim)';
    ctx.font = '11px system-ui';
    ctx.fillText(`接地区 ${(r.dx * r.gridX).toFixed(0)} × ${(r.dy * r.gridY).toFixed(0)} mm，网格 ${r.gridX}×${r.gridY}`, 8, h - 8);
  }

  function renderDrainage() {
    if (!result) return;
    const host = root.querySelector<HTMLElement>('#fp-drain')!;
    clear(host);
    if (result.channels.length === 0) {
      host.append(h('span', { class: 'muted' }, '当前花纹单元没有纵沟'));
      return;
    }
    const rows = result.channels.map((c) =>
      h('tr', {}, h('td', { class: 'mono' }, `y=${c.y.toFixed(1)} mm`), h('td', {}, c.connected ? badge('贯通', 'ok') : badge(`截断 ${c.cutCount} 处`, 'bad')), h('td', { class: 'mono' }, String(c.grooveCells))),
    );
    host.append(h('table', { class: 'data' }, h('thead', {}, h('tr', {}, h('th', {}, '纵沟位置'), h('th', {}, '接地区排水状态'), h('th', {}, '沟槽格点数'))), h('tbody', {}, ...rows)));
  }

  function renderRollChart() {
    if (frames.length === 0) return;
    drawLineChart(
      rollCanvas,
      [
        { color: '#4ea1ff', label: '接地面积 mm²', points: frames.map((f) => ({ x: f.angleDeg, y: f.contactArea })) },
        { color: '#35d0a0', label: '陆地面积 mm²', points: frames.map((f) => ({ x: f.angleDeg, y: f.landArea })) },
      ],
      { xLabel: '滚动角 °' },
    );
    drawLineChart(fluxCanvas, [{ color: '#f0b452', label: '边缘通量 mm²/deg（越低越安静）', points: frames.map((f) => ({ x: f.angleDeg, y: f.edgeFlux })) }], { xLabel: '滚动角 °', fill: true });
  }

  async function runRolling() {
    setState({ busy: '滚动分析中…' });
    await new Promise((r) => setTimeout(r, 30));
    try {
      const input = buildInput();
      frames = computeRolling(input, 72);
      renderRollChart();
      const areas = frames.map((f) => f.contactArea);
      const mean = areas.reduce((a, b) => a + b, 0) / areas.length;
      const cv = Math.sqrt(areas.reduce((s, a) => s + (a - mean) ** 2, 0) / areas.length) / mean;
      toast(`滚动一周面积变异系数 ${(cv * 100).toFixed(2)}%，越小越安静`);
    } finally {
      setState({ busy: null });
    }
  }

  let frameMs = 0;

  /** 滚动播放：GPU 模式只更新深度场（轻量），精确统计暂停时再算 */
  async function tickGpuFrame(input: FootprintInput, gpu: GpuBackend) {
    const t0 = performance.now();
    const g = await gpu.compute(input, phase);
    frameMs = performance.now() - t0;
    if (!result) {
      result = computeFootprint(input, { phase });
    }
    result.depthField.set(g.depth);
    result.contactMask.set(g.mask);
    result.backend = 'webgpu';
    result.phase = phase;
    renderDepth();
    updateFramePill();
  }

  function updateFramePill() {
    const pill = root.querySelector<HTMLElement>('#fp-framepill');
    if (pill) pill.textContent = `滚动帧 GPU ${frameMs.toFixed(1)} ms（${(1000 / Math.max(frameMs, 0.01)).toFixed(0)} FPS）`;
  }

  function tick() {
    if (!playing) return;
    const input = buildInput();
    const minPitch = Math.min(...input.sequence.pitchTypes.map((p) => p.length));
    phase = (phase + minPitch / 24) % Math.max(totalLen(), 1);
    if (useGpu && backend) {
      void tickGpuFrame(input, backend).then(() => {
        if (playing) raf = requestAnimationFrame(tick);
      });
    } else {
      void recompute().then(() => {
        if (playing) raf = requestAnimationFrame(tick);
      });
    }
  }
  function totalLen(): number {
    const s = getState().project.sequence;
    return s.pitchIds.reduce((sum, id) => sum + (s.pitchTypes.find((p) => p.id === id)?.length ?? 0), 0);
  }

  const benchResult = h('div', { id: 'fp-bench', class: 'stack' });

  const controls = card(
    '计算控制',
    h(
      'div',
      { class: 'btn-row' },
      button('重新计算', () => void recompute(), 'primary'),
      button(useGpu ? '✓ WebGPU' : '切换 WebGPU', async () => {
        const gpu = await ensureGpu();
        if (!gpu) return toast('本环境不支持 WebGPU', 'err');
        useGpu = !useGpu;
        setState({ gpuAvailable: true });
        await recompute();
        draw();
      }),
      (() => {
        const btn = button(playing ? '暂停滚动' : '滚动播放', () => {
          playing = !playing;
          btn.textContent = playing ? '暂停滚动' : '滚动播放';
          if (playing) {
            raf = requestAnimationFrame(tick);
          } else {
            cancelAnimationFrame(raf);
          }
        });
        btn.id = 'fp-rollbtn';
        return btn;
      })(),
      button('滚动一周分析（72 帧）', () => void runRolling()),
    ),
    h(
      'div',
      { class: 'btn-row' },
      button('万块压力测试（GPU 30 帧）', () => void runBench(true), 'primary'),
      button('万块压力测试（CPU 30 帧）', () => void runBench(false)),
    ),
    benchResult,
    h('span', { id: 'fp-framepill', class: 'badge badge-ok' }, '滚动帧计时待播放'),
    labeled('网格 X', numInput(gridX, (v) => (gridX = Math.max(64, Math.round(v))), 32)),
    labeled('网格 Y', numInput(gridY, (v) => (gridY = Math.max(48, Math.round(v))), 16)),
    h('div', { class: 'muted', style: 'font-size:11px' }, '整胎万块级花纹滚动时建议网格 320×160；WebGPU 下单帧深度场为全并行 compute，验收线 ≥50 FPS。'),
  );

  async function runBench(gpu: boolean) {
    setState({ busy: gpu ? 'GPU 压力测试中…' : 'CPU 压力测试中…' });
    clear(benchResult);
    await new Promise((r) => setTimeout(r, 30));
    try {
      const r = await runStressBenchmark(buildInput(), { useGpu: gpu, frames: 30, gridX: 320, gridY: 160 });
      if (r.backend === 'webgpu') {
        const gpuFps = r.gpuFps ?? r.estimatedFps;
        const pass = gpuFps >= 50;
        benchResult.append(
          h(
            'div',
            { class: 'grid-3' },
            stat('花纹块数', String(r.blockCount)),
            stat('GPU 深度场 ms/帧', (r.gpuComputeMs ?? 0).toFixed(2)),
            stat('GPU 滚动 FPS', gpuFps.toFixed(1), !pass),
          ),
          h('div', { class: 'grid-3' }, stat('CPU 统计 ms/帧', (r.cpuStatsMs ?? 0).toFixed(2)), stat('组合报告 FPS', r.estimatedFps.toFixed(1)), stat('网格', `${r.gridX}×${r.gridY}`)),
          h('div', { class: 'btn-row' }, pass ? badge(`达标：纯 GPU 滚动 ${gpuFps.toFixed(1)} FPS ≥ 50（面积指标降频计算）`, 'ok') : badge(`未达标：GPU ${gpuFps.toFixed(1)} FPS < 50`, 'bad'), h('span', { class: 'muted' }, '滚动播放只跑 GPU 深度场；海陆比等精确指标在暂停/出报告时由 CPU 条带积分给出')),
        );
      } else {
        benchResult.append(
          h('div', { class: 'grid-3' }, stat('花纹块数', String(r.blockCount)), stat('CPU ms/帧', r.avgFrameMs.toFixed(2)), stat('CPU FPS', r.estimatedFps.toFixed(1))),
          h('div', { class: 'btn-row' }, badge(`CPU 对照 ${r.estimatedFps.toFixed(1)} FPS（无 GPU 时的降级口径）`, 'warn')),
        );
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : '压力测试失败', 'err');
    } finally {
      setState({ busy: null });
    }
  }

  function draw() {
    clear(root);
    root.append(
      h('div', { class: 'grid-2' }, h('div', { class: 'stack' }, controls, card('关键指标', h('div', { id: 'fp-stats', class: 'stack' })), card('排水：纵沟贯通性', h('div', { id: 'fp-drain' }))), h('div', { class: 'stack' }, card('接地印痕深度图（琥珀=陆地，蓝=沟槽，深色=未接触）', h('div', { class: 'canvas-wrap' }, depthCanvas)))),
      h('div', { class: 'grid-2' }, card('滚动接地面积波动', h('div', { class: 'canvas-wrap' }, rollCanvas)), card('花纹块进出接地区边缘通量', h('div', { class: 'canvas-wrap' }, fluxCanvas))),
    );
    void recompute();
  }

  draw();
  const unsub = subscribePage(() => void recompute());

  // 试验记录与叠图比对区（挂 host 而非 root，避免 draw() 的 clear(root) 清掉）
  const testHost = h('div', { style: 'margin-top:16px' });
  host.append(testHost);
  const disposeTest = renderTestSection(testHost);

  return () => {
    unsub();
    cancelAnimationFrame(raf);
    playing = false;
    void backend?.destroy();
    disposeTest();
  };
}

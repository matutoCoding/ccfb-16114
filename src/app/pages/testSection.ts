/**
 * 转鼓试验记录与压力纸扫描图：导入、频谱叠图、印痕半透明叠加比对。
 */
import { h, clear, card, button, labeled, numInput, badge, toast, setupCanvas, drawLineChart } from '../ui';
import { getState, addTest, removeTest, newTestId, newBlobId } from '../store';
import { storage } from '../../db/storage';
import { noiseSpectrum } from '../../core/noise';
import { solveFootprint } from '../../core/geometry';
import type { DrumTestRecord } from '../../core/types';

/** 解析两列文本（Hz dB，逗号/空格/Tab 分隔） */
export function parseSpectrumText(text: string): { hz: number; db: number }[] {
  const out: { hz: number; db: number }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const parts = line.trim().split(/[\s,;]+/).map(Number);
    if (parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
      out.push({ hz: parts[0]!, db: parts[1]! });
    }
  }
  return out.sort((a, b) => a.hz - b.hz);
}

/** 紧凑竖向字段（标签在上、输入框在下），用于多列表单 */
function compactField(label: string, control: HTMLElement): HTMLElement {
  return h('label', { class: 'compact-field' }, h('span', { class: 'field-label' }, label), control);
}

export function renderTestSection(host: HTMLElement): () => void {
  clear(host);
  const root = h('div', { class: 'stack' });
  host.append(root);

  const specCanvas = h('canvas', {}) as HTMLCanvasElement;
  const overlayCanvas = h('canvas', {}) as HTMLCanvasElement;
  let pickedTestId: string | null = null;
  let paperUrl: string | null = null;

  async function draw() {
    clear(root);
    const { project, tests } = getState();

    // ---- 导入表单 ----
    const nameInput = h('input', { type: 'text', placeholder: '试验名称，如 9月24日转鼓-60kmh' }) as HTMLInputElement;
    const speedInput = numInput(60, () => undefined, 5);
    speedInput.value = '60';
    let speed = 60;
    speedInput.addEventListener('input', () => (speed = Number(speedInput.value)));
    const loadInput = numInput(project.tire.load, () => undefined, 50);
    loadInput.value = String(project.tire.load);
    let load = project.tire.load;
    loadInput.addEventListener('input', () => (load = Number(loadInput.value)));
    const pressureInput = numInput(project.tire.inflationPressure, () => undefined, 5);
    pressureInput.value = String(project.tire.inflationPressure);
    let pressure = project.tire.inflationPressure;
    pressureInput.addEventListener('input', () => (pressure = Number(pressureInput.value)));

    const fileInput = h('input', { type: 'file', accept: 'image/png,image/jpeg' }) as HTMLInputElement;
    const spectrumInput = h('input', { type: 'file', accept: '.csv,.txt' }) as HTMLInputElement;
    let spectrum: { hz: number; db: number }[] = [];
    spectrumInput.addEventListener('change', () => {
      const f = spectrumInput.files?.[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        spectrum = parseSpectrumText(String(reader.result));
        toast(`已解析 ${spectrum.length} 个频谱点`);
      };
      reader.readAsText(f);
    });

    const importCard = card(
      '导入转鼓试验 / 压力纸扫描',
      labeled('名称', nameInput),
      h('div', { class: 'compact-3' }, compactField('车速 km/h', speedInput), compactField('载荷 N', loadInput), compactField('气压 kPa', pressureInput)),
      labeled('频谱 CSV/TXT', spectrumInput, '两列：Hz 与 dB，空格/逗号分隔'),
      labeled('压力纸图片', fileInput, 'PNG/JPG，将与仿真印痕半透明叠加'),
      button(
        '保存记录',
        async () => {
          if (!nameInput.value) return toast('先填试验名称', 'err');
          const blobId = fileInput.files?.[0] ? newBlobId() : undefined;
          const rec: DrumTestRecord = {
            id: newTestId(),
            name: nameInput.value,
            createdAt: Date.now(),
            speedKmh: speed,
            loadN: load,
            pressureKpa: pressure,
            spectrum,
            pressurePaperBlobId: blobId,
            sequenceId: project.sequence.id,
          };
          await addTest(rec, fileInput.files?.[0]);
          pickedTestId = rec.id;
          toast('试验记录已存入 IndexedDB');
          await draw();
        },
        'primary',
      ),
    );

    // ---- 记录列表 ----
    const listCard = card(
      `试验记录（${tests.length}）`,
      tests.length === 0
        ? h('span', { class: 'muted' }, '暂无记录，导入后可与仿真叠图')
        : h(
            'div',
            { class: 'scroll-list' },
            ...tests.map((t) =>
              h(
                'div',
                { class: `feat-row ${pickedTestId === t.id ? 'selected' : ''}`, style: pickedTestId === t.id ? 'outline:2px solid var(--accent)' : '' },
                h('div', {}, h('div', { style: 'font-weight:600' }, t.name), h('div', { class: 'muted' }, `${t.speedKmh}km/h · ${t.loadN}N · ${t.pressureKpa}kPa · ${t.spectrum.length} 频谱点`)),
                badge(new Date(t.createdAt).toLocaleDateString()),
                button('对比', () => {
                  pickedTestId = t.id;
                  void draw();
                }, 'primary'),
                button('删', () => void removeTest(t.id), 'danger'),
              ),
            ),
          ),
    );

    root.append(h('div', { class: 'grid-2' }, h('div', { class: 'stack' }, importCard, listCard), h('div', { class: 'stack' }, card('频谱叠图（仿真阶次谱 vs 转鼓实测）', h('div', { class: 'canvas-wrap' }, specCanvas)), card('压力纸印痕叠加（红=仿真陆地，绿=实测纸）', h('div', { class: 'canvas-wrap' }, overlayCanvas)))));

    const picked = tests.find((t) => t.id === pickedTestId);
    requestAnimationFrame(() => {
      drawSpecCompare(specCanvas, picked);
      void drawOverlay(overlayCanvas, picked);
    });
  }

  async function drawOverlay(canvas: HTMLCanvasElement, picked?: DrumTestRecord) {
    const wrap = canvas.parentElement!;
    const cssW = Math.max(420, wrap.clientWidth - 16);
    const cssH = 300;
    const { ctx, w, h } = setupCanvas(canvas, cssW, cssH);
    ctx.fillStyle = '#0f141c';
    ctx.fillRect(0, 0, w, h);
    if (!picked?.pressurePaperBlobId) {
      ctx.fillStyle = 'var(--text-dim)';
      ctx.font = '12px system-ui';
      ctx.fillText('该记录没有压力纸扫描图', 16, h / 2);
      return;
    }
    if (paperUrl) URL.revokeObjectURL(paperUrl);
    const blob = await storage.getBlob(picked.pressurePaperBlobId);
    if (!blob) return;
    paperUrl = URL.createObjectURL(blob);
    const img = new Image();
    await new Promise((r) => {
      img.onload = r;
      img.src = paperUrl!;
    });
    // 实测纸：绿色半透明
    ctx.globalAlpha = 0.55;
    ctx.drawImage(img, 0, 0, w, h);
    ctx.globalAlpha = 1;
    // 仿真印痕轮廓：红色描边椭圆（用当前压扁几何）
    const geo = solveFootprint(getState().project.tire);
    ctx.strokeStyle = '#f2695c';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(w / 2, h / 2, (geo.halfLengthCenter / (geo.halfLengthCenter * 2.08)) * w, (geo.halfWidth / (geo.halfWidth * 2.08)) * h, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#f2695c';
    ctx.font = '11px system-ui';
    ctx.fillText(`仿真接地 ${geo.contactLength.toFixed(0)}×${(geo.halfWidth * 2).toFixed(0)} mm`, 10, 16);
  }

  function drawSpecCompare(canvas: HTMLCanvasElement, picked?: DrumTestRecord) {
    const { project } = getState();
    const geo = solveFootprint(project.tire);
    const speed = picked?.speedKmh ?? 60;
    const sim = noiseSpectrum(project.sequence, speed, geo.rollingRadius);
    const simPoints = sim.lines.filter((l) => l.order <= 80).map((l) => ({ x: l.order * sim.fundamentalHz, y: l.magnitude }));
    // 仿真幅值归一化到实测 dB 区间
    const series: { color: string; points: { x: number; y: number }[]; label: string }[] = [];
    if (picked && picked.spectrum.length > 1) {
      const dbMin = Math.min(...picked.spectrum.map((p) => p.db));
      const dbMax = Math.max(...picked.spectrum.map((p) => p.db));
      const simMax = Math.max(...simPoints.map((p) => p.y), 1e-9);
      series.push(
        { color: '#35d0a0', label: `实测 ${picked.name} (dB)`, points: picked.spectrum.map((p) => ({ x: p.hz, y: p.db })) },
        { color: '#4ea1ff', label: '仿真阶次谱（归一化映射到 dB 区间）', points: simPoints.map((p) => ({ x: p.x, y: dbMin + (p.y / simMax) * (dbMax - dbMin) })) },
      );
    } else {
      series.push({ color: '#4ea1ff', label: '仿真阶次谱（车速 60km/h 当量）', points: simPoints });
    }
    drawLineChart(canvas, series, { xLabel: '频率 Hz' });
  }

  void draw;
  void drawSpecCompare;
  void drawOverlay;
  void setupCanvas;
  void labeled;
  void numInput;
  void badge;

  void draw();
  return () => {
    if (paperUrl) URL.revokeObjectURL(paperUrl);
  };
}

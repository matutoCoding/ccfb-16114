/**
 * 整胎预览页面：规格参数、外径/周长、胎冠弧与整胎花纹带展开。
 * 骨架只挂载一次，数据变化只刷新内容，避免重入式 clear 递归。
 */
import { h, clear, card, labeled, numInput, textInput, badge, stat, setupCanvas, toast } from '../ui';
import { getState, updateProject } from '../store';
import { subscribePage } from '../pageBus';
import { parseTireSpec, formatTireSpec, outerDiameter, outerCircumference, outerRadius, crownDropAt, solveFootprint } from '../../core/geometry';
import { totalLength } from '../../core/sequence';
import { buildBand } from '../../core/pattern';

export function renderTirePage(host: HTMLElement): () => void {
  clear(host);
  const root = h('div', { class: 'grid-2' });
  host.append(root);
  const left = h('div', { class: 'stack' });
  const canvas = h('canvas', {}) as HTMLCanvasElement;
  const crownCanvas = h('canvas', {}) as HTMLCanvasElement;
  const bandCard = card('整胎花纹带展开（周向 × 横向，沿胎冠弧包络）', h('div', { class: 'canvas-wrap' }, canvas));
  root.append(left, bandCard);

  function refresh() {
    clear(left);
    const { project } = getState();
    const tire = project.tire;
    const seq = project.sequence;
    const geo = solveFootprint(tire);
    const total = totalLength(seq);
    const circ = outerCircumference(tire);
    const err = total - circ;

    const specInput = textInput(formatTireSpec(tire), (v) => {
      const parsed = parseTireSpec(v);
      if (parsed) updateProject((p) => ({ ...p, tire: { ...p.tire, ...parsed } }));
    });

    left.append(
      card(
        '轮胎规格',
        labeled('规格串', specInput, '如 205/55R16，自动解析'),
        labeled('断面宽 mm', numInput(tire.sectionWidth, (v) => updateProject((p) => ({ ...p, tire: { ...p.tire, sectionWidth: v, treadWidth: Math.min(p.tire.treadWidth, v * 0.9) } })), 1)),
        labeled('胎面宽 mm', numInput(tire.treadWidth, (v) => updateProject((p) => ({ ...p, tire: { ...p.tire, treadWidth: v } })), 1)),
        labeled('高宽比', numInput(tire.aspectRatio, (v) => updateProject((p) => ({ ...p, tire: { ...p.tire, aspectRatio: v } })), 1)),
        labeled('轮辋 in', numInput(tire.rimDiameterIn, (v) => updateProject((p) => ({ ...p, tire: { ...p.tire, rimDiameterIn: v } })), 0.5)),
      ),
      card(
        '胎冠弧与载荷',
        labeled('冠弧下沉 mm', numInput(tire.crownDrop, (v) => updateProject((p) => ({ ...p, tire: { ...p.tire, crownDrop: Math.max(0.5, v) } })), 0.1)),
        labeled('肩弧半径 mm', numInput(tire.shoulderRadius, (v) => updateProject((p) => ({ ...p, tire: { ...p.tire, shoulderRadius: Math.max(1, v) } })), 0.5)),
        labeled('载荷 N', numInput(tire.load, (v) => updateProject((p) => ({ ...p, tire: { ...p.tire, load: Math.max(100, v) } })), 50)),
        labeled('气压 kPa', numInput(tire.inflationPressure, (v) => updateProject((p) => ({ ...p, tire: { ...p.tire, inflationPressure: Math.max(50, v) } })), 5)),
      ),
      h(
        'div',
        { class: 'grid-3' },
        stat('外径 mm', outerDiameter(tire).toFixed(1)),
        stat('外周长 mm', circ.toFixed(1)),
        stat('滚动半径 mm', geo.rollingRadius.toFixed(1)),
      ),
      h(
        'div',
        { class: 'grid-3' },
        stat('花纹块总数', String(seq.pitchIds.length)),
        stat('节距总长 mm', total.toFixed(1)),
        stat('周长误差 mm', `${err >= 0 ? '+' : ''}${err.toFixed(1)}`, Math.abs(err) > 5),
      ),
      h('div', { class: 'btn-row' }, Math.abs(err) <= 5 ? badge('节距总长与周长匹配', 'ok') : badge(`节距总长${err > 0 ? '超出' : '不足'}周长 ${Math.abs(err).toFixed(1)} mm，请回序列页调节`, 'warn')),
      card('胎冠弧剖面（横向）', h('div', { class: 'canvas-wrap' }, crownCanvas)),
    );

    drawBand(canvas, project.unit, seq);
    drawCrown(crownCanvas, tire);
  }

  const onResize = () => refresh();
  window.addEventListener('resize', onResize);
  refresh();
  const unsub = subscribePage(refresh);
  return () => {
    unsub();
    window.removeEventListener('resize', onResize);
  };
}

function drawCrown(canvas: HTMLCanvasElement, tire: ReturnType<typeof getState>['project']['tire']): void {
  const wrap = canvas.parentElement!;
  const cssW = Math.max(360, wrap.clientWidth - 16);
  const cssH = 170;
  const { ctx, w, h } = setupCanvas(canvas, cssW, cssH);
  const pad = 30;
  const halfW = tire.sectionWidth / 2;
  const sy = (drop: number) => pad + (drop / Math.max(tire.crownDrop * 1.6, 1)) * (h - 2 * pad);
  const sx = (y: number) => w / 2 + (y / halfW) * (w / 2 - pad);

  ctx.strokeStyle = '#4ea1ff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i <= 200; i++) {
    const y = -halfW + (i / 200) * tire.sectionWidth;
    const d = crownDropAt(tire, y);
    if (i === 0) ctx.moveTo(sx(y), sy(d));
    else ctx.lineTo(sx(y), sy(d));
  }
  ctx.stroke();

  ctx.strokeStyle = 'rgba(53,208,160,0.6)';
  ctx.setLineDash([4, 4]);
  for (const y of [-tire.treadWidth / 2, tire.treadWidth / 2]) {
    ctx.beginPath();
    ctx.moveTo(sx(y), pad - 6);
    ctx.lineTo(sx(y), h - pad);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.fillStyle = 'var(--text-dim)';
  ctx.font = '10px system-ui';
  ctx.fillText(`胎面宽 ${tire.treadWidth}`, sx(-tire.treadWidth / 2), h - 8);
  ctx.fillText(`冠弧下沉 ${tire.crownDrop} mm`, pad, pad - 8);
  void outerRadius;
}

function drawBand(canvas: HTMLCanvasElement, unit: ReturnType<typeof getState>['project']['unit'], seq: ReturnType<typeof getState>['project']['sequence']): void {
  const wrap = canvas.parentElement!;
  const cssW = Math.max(620, wrap.clientWidth - 16);
  const cssH = Math.min(560, cssW * 0.7);
  const { ctx, w, h } = setupCanvas(canvas, cssW, cssH);
  const band = buildBand(unit, seq);
  const pad = 24;
  const plotW = w - 2 * pad;
  const plotH = h - 2 * pad;
  const halfTW = unit.treadWidth / 2;

  ctx.fillStyle = '#241c12';
  ctx.fillRect(pad, pad, plotW, plotH);

  const lens = seq.pitchIds.map((id) => seq.pitchTypes.find((p) => p.id === id)!.length);
  let acc = 0;
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  lens.forEach((L, i) => {
    const x = pad + (acc / band.totalLength) * plotW;
    ctx.beginPath();
    ctx.moveTo(x, pad);
    ctx.lineTo(x, pad + plotH);
    ctx.stroke();
    acc += L;
    if (i < 40) {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.font = '9px system-ui';
      ctx.fillText(String(i + 1), x + 2, pad + 10);
    }
  });

  const nx = Math.min(1400, Math.max(700, seq.pitchIds.length * 12));
  const ny = 160;
  const img = ctx.createImageData(nx, ny);
  for (let j = 0; j < ny; j++) {
    const y = -halfTW + (j / (ny - 1)) * unit.treadWidth;
    for (let i = 0; i < nx; i++) {
      const x = (i / (nx - 1)) * band.totalLength;
      const d = band.depthAt(x, y);
      const pidx = (j * nx + i) * 4;
      if (d > 0.25) {
        const t = Math.min(1, d / unit.maxDepth);
        img.data[pidx] = 30 + t * 40;
        img.data[pidx + 1] = 60 + t * 90;
        img.data[pidx + 2] = 110 + t * 120;
        img.data[pidx + 3] = 255;
      } else {
        img.data[pidx] = 200;
        img.data[pidx + 1] = 135;
        img.data[pidx + 2] = 63;
        img.data[pidx + 3] = 255;
      }
    }
  }
  const off = document.createElement('canvas');
  off.width = nx;
  off.height = ny;
  off.getContext('2d')!.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(off, pad, pad, plotW, plotH);

  ctx.strokeStyle = '#4a5a72';
  ctx.strokeRect(pad, pad, plotW, plotH);
  ctx.fillStyle = 'var(--text-dim)';
  ctx.font = '11px system-ui';
  ctx.fillText(`周向展开 ${band.totalLength.toFixed(1)} mm（${seq.pitchIds.length} 节距）`, pad, h - 6);
  ctx.fillText(`横向 ±${halfTW} mm`, w - 110, h - 6);
  void toast;
}

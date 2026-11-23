/**
 * 花纹单元页面：一个节距的 2D 编辑画布 + 特征参数表。
 */
import { h, clear, card, button, labeled, numInput, selectInput, badge, setupCanvas } from '../ui';
import { getState, updateProject } from '../store';
import { subscribePage } from '../pageBus';
import { uid, type TreadFeature, type FeatureKind } from '../../core/types';

const KIND_LABEL: Record<FeatureKind, string> = {
  circumferential: '纵沟',
  lateral: '横沟',
  sipe: '刀槽',
};

const KIND_COLOR: Record<FeatureKind, string> = {
  circumferential: '#4ea1ff',
  lateral: '#f0b452',
  sipe: '#35d0a0',
};

export function renderUnitPage(host: HTMLElement): () => void {
  clear(host);
  const root = h('div', { class: 'grid-2' });
  host.append(root);

  const left = h('div', { class: 'stack' });
  const canvas = h('canvas', {}) as HTMLCanvasElement;
  const legend = h('div', { class: 'btn-row' });
  const canvasCard = card('节距俯视图（x 周向 →，y 横向 ±）', h('div', { class: 'canvas-wrap' }, canvas), legend);
  root.append(left, canvasCard);

  function drawSidebar() {
    clear(left);
    const unit = getState().project.unit;

    left.append(
      card(
        '节距基准',
        labeled('基准节距长 mm', numInput(unit.baseLength, (v) => updateProject((p) => ({ ...p, unit: { ...p.unit, baseLength: v } })), 0.5, 5)),
        labeled('胎面宽度 mm', numInput(unit.treadWidth, (v) => updateProject((p) => ({ ...p, unit: { ...p.unit, treadWidth: v } })), 1, 50)),
        labeled('最大沟深 mm', numInput(unit.maxDepth, (v) => updateProject((p) => ({ ...p, unit: { ...p.unit, maxDepth: v } })), 0.5, 1)),
      ),
    );

    const addFeature = (kind: FeatureKind) => {
      const f: TreadFeature = {
        id: uid('f'),
        kind,
        position: unit.baseLength / 2,
        width: kind === 'sipe' ? 0.8 : kind === 'lateral' ? 5 : 7,
        depth: kind === 'sipe' ? 4 : unit.maxDepth,
        wallAngle: kind === 'sipe' ? 0 : 7,
        span: kind === 'circumferential' ? 1 : 30,
        skew: 0,
        yStart: 0,
        chamfer: kind === 'sipe' ? 0 : 0.8,
      };
      updateProject((p) => ({ ...p, unit: { ...p.unit, features: [...p.unit.features, f] } }));
    };

    const editFeature = (id: string, patch: Partial<TreadFeature>) => {
      updateProject((p) => ({
        ...p,
        unit: { ...p.unit, features: p.unit.features.map((f) => (f.id === id ? { ...f, ...patch } : f)) },
      }));
    };
    const removeFeature = (id: string) => {
      updateProject((p) => ({ ...p, unit: { ...p.unit, features: p.unit.features.filter((f) => f.id !== id) } }));
    };

    const featList = h('div', { class: 'scroll-list' });
    for (const f of unit.features) {
      const isCirc = f.kind === 'circumferential';
      featList.append(
        h(
          'div',
          { class: 'feat-row' },
          h('span', { style: `color:${KIND_COLOR[f.kind]};font-weight:700;white-space:nowrap` }, KIND_LABEL[f.kind]),
          h(
            'div',
            { class: 'stack', style: 'gap:4px' },
            labeled(isCirc ? 'y 位置 mm' : 'x 位置 mm', numInput(f.position, (v) => editFeature(f.id, { position: v }), 0.5)),
            labeled('沟口宽 mm', numInput(f.width, (v) => editFeature(f.id, { width: Math.max(0.2, v) }), 0.1)),
            labeled('沟深 mm', numInput(f.depth, (v) => editFeature(f.id, { depth: Math.min(v, unit.maxDepth) }), 0.1)),
            labeled('沟壁角 °', numInput(f.wallAngle, (v) => editFeature(f.id, { wallAngle: Math.max(0, Math.min(45, v)) }), 0.5)),
            isCirc
              ? labeled('周向占比', numInput(f.span, (v) => editFeature(f.id, { span: Math.min(1, Math.max(0.05, v)) }), 0.05))
              : labeled(`${f.kind === 'sipe' ? '长度' : '横向跨度'} mm`, numInput(f.span, (v) => editFeature(f.id, { span: v }), 0.5)),
            isCirc ? null : labeled('倾斜角 °', numInput(f.skew, (v) => editFeature(f.id, { skew: v }), 1)),
            isCirc ? null : labeled('y 起点 mm', numInput(f.yStart, (v) => editFeature(f.id, { yStart: v }), 1)),
            labeled('倒角 mm', numInput(f.chamfer, (v) => editFeature(f.id, { chamfer: Math.max(0, v) }), 0.1)),
          ),
          selectInput(
            Object.entries(KIND_LABEL).map(([value, label]) => ({ value: value as FeatureKind, label })),
            f.kind,
            (v) => editFeature(f.id, { kind: v }),
          ),
          button('删', () => removeFeature(f.id), 'danger'),
        ),
      );
    }

    left.append(
      card(
        '花纹沟/刀槽',
        h('div', { class: 'btn-row' }, button('+ 纵沟', () => addFeature('circumferential'), 'primary'), button('+ 横沟', () => addFeature('lateral')), button('+ 刀槽', () => addFeature('sipe'))),
        featList,
        h('div', { class: 'muted', style: 'font-size:11px' }, '纵沟 y=0 为胎面中线；横沟/刀槽按节距局部 x 坐标布置，接缝自动周期延拓、不错台。'),
      ),
    );
  }

  function drawCanvas() {
    const u = getState().project.unit;
    const wrap = canvas.parentElement!;
    const cssW = Math.max(560, wrap.clientWidth - 16);
    const cssH = Math.min(520, cssW * 0.62);
    const { ctx, w: cw, h: ch } = setupCanvas(canvas, cssW, cssH);
    const pad = 36;
    const sx = (x: number) => pad + (x / u.baseLength) * (cw - 2 * pad);
    const sy = (y: number) => ch / 2 - (y / (u.treadWidth / 2)) * (ch / 2 - pad);

    ctx.fillStyle = '#241c12';
    ctx.fillRect(sx(0), sy(u.treadWidth / 2), sx(u.baseLength) - sx(0), sy(-u.treadWidth / 2) - sy(u.treadWidth / 2));
    ctx.strokeStyle = '#4a5a72';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(sx(0), sy(u.treadWidth / 2), sx(u.baseLength) - sx(0), sy(-u.treadWidth / 2) - sy(u.treadWidth / 2));

    ctx.strokeStyle = 'rgba(139,152,173,0.35)';
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(sx(0), sy(0));
    ctx.lineTo(sx(u.baseLength), sy(0));
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = 'var(--text-dim)';
    ctx.font = '10px system-ui';
    ctx.fillText('0', sx(0) - 4, sy(u.treadWidth / 2) + 14);
    ctx.fillText(`${u.baseLength}`, sx(u.baseLength) - 20, sy(u.treadWidth / 2) + 14);
    ctx.fillText(`+${u.treadWidth / 2}`, 4, sy(u.treadWidth / 2) + 3);
    ctx.fillText(`-${u.treadWidth / 2}`, 4, sy(-u.treadWidth / 2) - 4);

    const DEG = Math.PI / 180;
    for (const f of u.features) {
      ctx.fillStyle = KIND_COLOR[f.kind];
      ctx.strokeStyle = KIND_COLOR[f.kind];
      ctx.globalAlpha = f.kind === 'sipe' ? 0.85 : 0.9;
      if (f.kind === 'circumferential') {
        const halfTop = f.width / 2 + f.chamfer;
        const x0 = f.span >= 1 ? sx(0) : sx(u.baseLength / 2 - (f.span * u.baseLength) / 2);
        const x1 = f.span >= 1 ? sx(u.baseLength) : sx(u.baseLength / 2 + (f.span * u.baseLength) / 2);
        ctx.fillRect(x0, sy(f.position + halfTop), x1 - x0, sy(f.position - halfTop) - sy(f.position + halfTop));
      } else {
        const a = f.skew * DEG;
        ctx.lineWidth = Math.max(2, (f.width + 2 * f.chamfer) * ((ch - 2 * pad) / u.treadWidth));
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(sx(f.position), sy(f.yStart));
        ctx.lineTo(sx(f.position + f.span * Math.sin(a)), sy(f.yStart + f.span * Math.cos(a)));
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    clear(legend);
    for (const [k, label] of Object.entries(KIND_LABEL)) {
      legend.append(h('span', { style: `color:${KIND_COLOR[k as FeatureKind]};font-size:11px` }, `■ ${label}`));
    }
    legend.append(badge(`${u.features.length} 个特征`, 'ok'));
  }

  const rerender = () => {
    drawSidebar();
    drawCanvas();
  };
  rerender();
  const unsub = subscribePage(rerender);
  const onResize = () => drawCanvas();
  window.addEventListener('resize', onResize);
  return () => {
    unsub();
    window.removeEventListener('resize', onResize);
  };
}

/**
 * 轻量 DOM 构建与组件 helper（无框架）。
 */

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | undefined | EventListenerOrEventListenerObject> = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === 'class') {
      el.className = String(v);
    } else if (k === 'dataset') {
      Object.assign(el.dataset, v);
    } else {
      el.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

export function clear(el: HTMLElement): void {
  el.replaceChildren();
}

export function labeled(label: string, control: HTMLElement, hint?: string): HTMLElement {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control, hint ? h('small', { class: 'field-hint' }, hint) : undefined);
}

export function numInput(value: number, onInput: (v: number) => void, step = 1, min?: number, max?: number): HTMLInputElement {
  const input = h('input', {
    type: 'number',
    step: String(step),
    value: String(value),
    ...(min !== undefined ? { min: String(min) } : {}),
    ...(max !== undefined ? { max: String(max) } : {}),
  }) as HTMLInputElement;
  input.addEventListener('input', () => {
    const v = Number(input.value);
    if (Number.isFinite(v)) onInput(v);
  });
  return input;
}

export function textInput(value: string, onInput: (v: string) => void): HTMLInputElement {
  const input = h('input', { type: 'text', value }) as HTMLInputElement;
  input.addEventListener('input', () => onInput(input.value));
  return input;
}

export function selectInput<T extends string>(options: { value: T; label: string }[], value: T, onInput: (v: T) => void): HTMLSelectElement {
  const sel = h('select', {}, ...options.map((o) => h('option', { value: o.value, ...(o.value === value ? { selected: true } : {}) }, o.label))) as HTMLSelectElement;
  sel.addEventListener('change', () => onInput(sel.value as T));
  return sel;
}

export function button(label: string, onClick: () => void, kind: 'primary' | 'ghost' | 'danger' = 'ghost'): HTMLButtonElement {
  return h('button', { class: `btn btn-${kind}`, onClick }, label);
}

export function card(title: string, ...children: (Node | false | null)[]): HTMLElement {
  return h('section', { class: 'card' }, h('h3', { class: 'card-title' }, title), h('div', { class: 'card-body' }, ...children.filter(Boolean) as Node[]));
}

export function stat(label: string, value: string, warn = false): HTMLElement {
  return h('div', { class: `stat ${warn ? 'stat-warn' : ''}` }, h('div', { class: 'stat-value' }, value), h('div', { class: 'stat-label' }, label));
}

export function badge(text: string, tone: 'ok' | 'warn' | 'bad' = 'ok'): HTMLElement {
  return h('span', { class: `badge badge-${tone}` }, text);
}

export function toast(message: string, tone: 'ok' | 'err' = 'ok'): void {
  const t = h('div', { class: `toast toast-${tone}` }, message);
  document.body.append(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, 2600);
}

/** Canvas 适配设备像素比，返回绘图上下文与 CSS 尺寸 */
export function setupCanvas(canvas: HTMLCanvasElement, cssW: number, cssH: number): { ctx: CanvasRenderingContext2D; w: number; h: number } {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: cssW, h: cssH };
}

/** 折线图（多序列），自动归一化 */
export function drawLineChart(
  canvas: HTMLCanvasElement,
  series: { color: string; points: { x: number; y: number }[]; label: string }[],
  opts: { xLabel?: string; yLabel?: string; fill?: boolean; yMin?: number; markers?: { x: number; color: string; label?: string }[] } = {},
): void {
  const parent = canvas.parentElement;
  const cssW = parent?.clientWidth || 640;
  const cssH = 260;
  const { ctx, w, h } = setupCanvas(canvas, cssW, cssH);
  ctx.clearRect(0, 0, w, h);
  const padL = 48;
  const padR = 16;
  const padT = 16;
  const padB = 36;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const allX = series.flatMap((s) => s.points.map((p) => p.x));
  const allY = series.flatMap((s) => s.points.map((p) => p.y));
  if (allX.length === 0) return;
  const xMin = Math.min(...allX);
  const xMax = Math.max(...allX);
  const yMax = Math.max(...allY, 1e-9);
  const yMin = opts.yMin ?? 0;
  const sx = (x: number) => padL + ((x - xMin) / Math.max(xMax - xMin, 1e-12)) * plotW;
  const sy = (y: number) => padT + plotH - ((y - yMin) / Math.max(yMax - yMin, 1e-12)) * plotH;

  // 网格
  ctx.strokeStyle = 'rgba(128,140,160,0.22)';
  ctx.lineWidth = 1;
  ctx.font = '10px system-ui';
  ctx.fillStyle = 'var(--text-dim)';
  for (let g = 0; g <= 4; g++) {
    const yy = padT + (plotH * g) / 4;
    ctx.beginPath();
    ctx.moveTo(padL, yy);
    ctx.lineTo(w - padR, yy);
    ctx.stroke();
    const val = yMax - ((yMax - yMin) * g) / 4;
    ctx.fillText(val.toFixed(val < 10 ? 2 : 0), 6, yy + 3);
  }
  for (const m of opts.markers ?? []) {
    const mx = sx(m.x);
    ctx.strokeStyle = m.color;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(mx, padT);
    ctx.lineTo(mx, padT + plotH);
    ctx.stroke();
    ctx.setLineDash([]);
    if (m.label) ctx.fillText(m.label, mx + 4, padT + 10);
  }

  for (const s of series) {
    if (s.points.length === 0) continue;
    ctx.beginPath();
    s.points.forEach((p, i) => {
      const px = sx(p.x);
      const py = sy(p.y);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 1.8;
    ctx.stroke();
    if (opts.fill) {
      ctx.lineTo(sx(s.points[s.points.length - 1]!.x), padT + plotH);
      ctx.lineTo(sx(s.points[0]!.x), padT + plotH);
      ctx.closePath();
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = s.color;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
  // 图例
  let lx = padL;
  ctx.font = '11px system-ui';
  for (const s of series) {
    ctx.fillStyle = s.color;
    ctx.fillRect(lx, h - 14, 14, 3);
    ctx.fillStyle = 'var(--text-dim)';
    ctx.fillText(s.label, lx + 18, h - 11);
    lx += ctx.measureText(s.label).width + 34;
  }
  if (opts.xLabel) {
    ctx.fillStyle = 'var(--text-dim)';
    ctx.fillText(opts.xLabel, w / 2 - ctx.measureText(opts.xLabel).width / 2, h - 2);
  }
}

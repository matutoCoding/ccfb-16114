/**
 * 噪声分析页面：阶次谱、车速-主峰联动、双序列 Web Audio 对比试听。
 */
import { h, clear, card, button, labeled, badge, stat, selectInput, toast } from '../ui';
import { getState } from '../store';
import { subscribePage } from '../pageBus';
import { noiseSpectrum, spectralPeakFraction, maxAutocorrelation } from '../../core/noise';
import { solveFootprint } from '../../core/geometry';
import { AudioEngine } from '../audio';
import { defaultSequences, defaultPitchTypes } from '../../core/defaults';
import type { PitchSequence } from '../../core/types';

export function renderNoisePage(host: HTMLElement): () => void {
  clear(host);
  const root = h('div', { class: 'stack' });
  host.append(root);

  const audio = new AudioEngine();
  let speed = 60;
  let compareSeq: PitchSequence | null = null;
  let voiceA: ReturnType<AudioEngine['createVoice']> | null = null;
  let voiceB: ReturnType<AudioEngine['createVoice']> | null = null;
  let playingA = false;
  let playingB = false;

  function getCompare(): PitchSequence {
    if (compareSeq) return compareSeq;
    const { project } = getState();
    const { uniform } = defaultSequences(project.tire, defaultPitchTypes());
    // 节距数对齐当前序列，保证同转速下可比
    uniform.pitchIds = Array.from({ length: project.sequence.pitchIds.length || uniform.pitchIds.length }, () => uniform.pitchTypes[1]!.id);
    compareSeq = uniform;
    return uniform;
  }

  function draw() {
    clear(root);
    const { project } = getState();
    const seqA = project.sequence;
    const seqB = getCompare();
    const geo = solveFootprint(project.tire);
    const R = geo.rollingRadius;
    const specA = noiseSpectrum(seqA, speed, R);
    const specB = noiseSpectrum(seqB, speed, R);

    const canvasA = h('canvas', {}) as HTMLCanvasElement;
    const canvasB = h('canvas', {}) as HTMLCanvasElement;

    const slider = h('input', { type: 'range', min: '20', max: '140', step: '5', value: String(speed) }) as HTMLInputElement;
    const speedOut = h('output', {}, `${speed} km/h`);
    slider.addEventListener('input', () => {
      speed = Number(slider.value);
      speedOut.textContent = `${speed} km/h`;
      draw();
      if (playingA) void voiceA?.play(speed, R);
      if (playingB) void voiceB?.play(speed, R);
    });

    root.append(
      card('车速', h('div', { class: 'range-row' }, h('span', { class: 'field-label' }, '车速 km/h'), slider, speedOut)),
      h(
        'div',
        { class: 'grid-3' },
        stat('转动频率 Hz', specA.fundamentalHz.toFixed(2)),
        stat(`主峰阶次（当前序列）`, specA.dominantOrder.toFixed(2)),
        stat('主峰频率 Hz', specA.dominantHz.toFixed(1), false),
      ),
      h(
        'div',
        { class: 'compare-split' },
        h(
          'section',
          { class: 'card panel-a' },
          h('h3', { class: 'card-title' }, `A：${seqA.name}`),
          h('div', { class: 'card-body stack' }, h('div', { class: 'btn-row' }, badge(`谱峰占比 ${(spectralPeakFraction(seqA) * 100).toFixed(1)}%`, spectralPeakFraction(seqA) > 0.3 ? 'warn' : 'ok'), badge(`最大自相关 ${maxAutocorrelation(seqA).toFixed(3)}`)), h('div', { class: 'canvas-wrap' }, canvasA), playBar('A')),
        ),
        h(
          'section',
          { class: 'card panel-b' },
          h('h3', { class: 'card-title' }, `B：${seqB.name}（等节距基准）`),
          h('div', { class: 'card-body stack' }, h('div', { class: 'btn-row' }, badge(`谱峰占比 ${(spectralPeakFraction(seqB) * 100).toFixed(1)}%`), badge(`最大自相关 ${maxAutocorrelation(seqB).toFixed(3)}`)), h('div', { class: 'canvas-wrap' }, canvasB), playBar('B')),
        ),
      ),
      card(
        '阶次谱解读',
        h('div', { class: 'muted' }, '横轴为每转周期数（阶次），纵轴为节距长度波动的归一化幅值。等节距序列能量集中在少数阶次 → 纯音突出；优化序列把能量摊平到宽阶次带 → 主观噪声更低。车速加倍时所有谱线频率加倍、阶次位置不变，主峰随车速右移。'),
      ),
    );

    requestAnimationFrame(() => {
      drawSpectrum(canvasA, specA.lines, '#4ea1ff', specA.dominantOrder);
      drawSpectrum(canvasB, specB.lines, '#35d0a0', specB.dominantOrder);
    });

    function playBar(which: 'A' | 'B'): HTMLElement {
      const seq = which === 'A' ? seqA : seqB;
      const isPlaying = () => (which === 'A' ? playingA : playingB);
      const playBtn = button(isPlaying() ? `■ 停止 ${which}` : `▶ 播放 ${which}`, () => {
        const voice = which === 'A' ? (voiceA ??= audio.createVoice(seq)) : (voiceB ??= audio.createVoice(seq));
        if (isPlaying()) {
          voice.stop();
          if (which === 'A') playingA = false;
          else playingB = false;
          playBtn.textContent = `▶ 播放 ${which}`;
        } else {
          void voice.play(speed, R).then(() => {
            if (which === 'A') playingA = true;
            else playingB = true;
            playBtn.textContent = `■ 停止 ${which}`;
          });
        }
      }, 'primary');
      return h(
        'div',
        { class: 'btn-row' },
        playBtn,
        button('对比序列切换', () => {
          compareSeq = null;
          toast('已重置为内置等节距基准');
          draw();
        }),
      );
    }
  }

  draw();
  const unsub = subscribePage(draw);
  return () => {
    unsub();
    voiceA?.stop();
    voiceB?.stop();
    audio.dispose();
  };
}

function drawSpectrum(canvas: HTMLCanvasElement, lines: { order: number; magnitude: number }[], color: string, dominant: number): void {
  const wrap = canvas.parentElement!;
  const cssW = Math.max(380, wrap.clientWidth - 16);
  const cssH = 240;
  const maxOrder = Math.min(60, Math.max(...lines.map((l) => l.order), dominant + 2));
  const points = lines.filter((l) => l.order <= maxOrder).map((l) => ({ x: l.order, y: l.magnitude }));
  // 用柱状风格自绘（阶次谱习惯柱线）
  const { ctx, w, h } = (() => {
    // 复用折线图管线前先做自定义柱图
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    const c = canvas.getContext('2d')!;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: c, w: cssW, h: cssH };
  })();
  const padL = 44;
  const padB = 30;
  const padT = 14;
  const plotW = w - padL - 12;
  const plotH = h - padT - padB;
  const maxY = Math.max(...points.map((p) => p.y), 1e-6);
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(128,140,160,0.2)';
  for (let g = 0; g <= 4; g++) {
    const yy = padT + (plotH * g) / 4;
    ctx.beginPath();
    ctx.moveTo(padL, yy);
    ctx.lineTo(w - 12, yy);
    ctx.stroke();
  }

  // 等节距（零方差）：无交流阶次分量，画纯音警示而非空图
  const totalEnergy = points.reduce((s, p) => s + p.y * p.y, 0);
  if (totalEnergy < 1e-12) {
    ctx.strokeStyle = '#f2695c';
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 6]);
    const px = padL + plotW * 0.5;
    ctx.beginPath();
    ctx.moveTo(px, padT);
    ctx.lineTo(px, padT + plotH);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#f2695c';
    ctx.font = 'bold 13px system-ui';
    ctx.fillText('等节距：节距通过频率纯音（能量 100% 集中）', padL + 10, padT + plotH / 2);
    ctx.font = '10px system-ui';
    ctx.fillStyle = 'var(--text-dim)';
    ctx.fillText('阶次 →', w / 2 - 14, h - 8);
    return;
  }

  const bw = Math.max(1, plotW / maxOrder - 0.5);
  for (const p of points) {
    const x = padL + (p.x / maxOrder) * plotW;
    const bh = (p.y / maxY) * plotH;
    ctx.fillStyle = Math.abs(p.x - dominant) < 0.6 ? '#f2695c' : color;
    ctx.fillRect(x, padT + plotH - bh, bw, bh);
  }
  ctx.fillStyle = 'var(--text-dim)';
  ctx.font = '10px system-ui';
  ctx.fillText('阶次 →', w / 2 - 14, h - 8);
  ctx.fillText('幅值', 6, padT + 8);
  ctx.fillStyle = '#f2695c';
  ctx.fillText(`主峰 ${dominant.toFixed(1)} 阶`, padL + 6, padT + 12);
  void selectInput;
}

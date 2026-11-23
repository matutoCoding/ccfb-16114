/**
 * 节距序列页面：节距类型管理、手排条带、约束自动搜索、周长匹配检查。
 */
import { h, clear, card, button, labeled, numInput, badge, stat, toast, setupCanvas } from '../ui';
import { getState, updateProject, setState } from '../store';
import { subscribePage } from '../pageBus';
import { uid, type PitchType, type PitchSequence } from '../../core/types';
import { totalLength, checkConstraints, suggestPitchCount, swapPositions, setPitchAt, removePitchAt, insertPitchAt, circumferenceError } from '../../core/sequence';
import { searchSequence } from '../../core/search';
import { pitchUsage } from '../../core/search';
import { outerCircumference, formatTireSpec } from '../../core/geometry';
import { drawLineChart } from '../ui';

const PITCH_COLORS = ['#4ea1ff', '#35d0a0', '#f0b452', '#c678dd', '#f2695c'];

export function renderSequencePage(host: HTMLElement): () => void {
  clear(host);
  const root = h('div', { class: 'stack' });
  host.append(root);

  let selected = -1;

  function draw() {
    clear(root);
    const { project } = getState();
    const seq = project.sequence;
    const tire = project.tire;
    const circ = outerCircumference(tire);
    const total = totalLength(seq);
    const err = circumferenceError(seq, tire);
    const violations = checkConstraints(seq, seq.constraints);
    const usage = pitchUsage(seq);
    const colorOf = (id: string) => PITCH_COLORS[seq.pitchTypes.findIndex((p) => p.id === id)] ?? '#888';

    // ---- 顶部统计 ----
    root.append(
      h(
        'div',
        { class: 'grid-3' },
        stat('节距总数', String(seq.pitchIds.length)),
        stat('节距总长 mm', total.toFixed(1)),
        stat('周长匹配误差 mm', `${err >= 0 ? '+' : ''}${err.toFixed(1)}`, Math.abs(err) > 5),
      ),
      h(
        'div',
        { class: 'btn-row', style: 'align-items:center' },
        h('span', { class: 'muted' }, `外周长 ${formatTireSpec(tire)} = ${circ.toFixed(1)} mm（建议节距数 ${suggestPitchCount(seq.pitchTypes, tire)}）`),
        Math.abs(err) <= 5 ? badge('周长匹配 OK', 'ok') : badge(`偏差 ${Math.abs(err).toFixed(1)} mm，需调整节距数或长度`, 'warn'),
        violations.length === 0 ? badge('约束全部满足', 'ok') : badge(`${violations.length} 处约束冲突`, 'bad'),
      ),
    );

    // ---- 节距类型 ----
    const typeRows = h('div', { class: 'stack', style: 'gap:6px' });
    seq.pitchTypes.forEach((p, i) => {
      typeRows.append(
        h(
          'div',
          { class: 'feat-row' },
          h('span', { style: `color:${PITCH_COLORS[i]};font-weight:700` }, p.label),
          h('div', { class: 'stack', style: 'gap:4px' }, labeled('长度 mm', numInput(p.length, (v) => updatePitchType(p.id, { length: Math.max(1, v) }), 0.5)), labeled('标签', labelInput(p.label, (v) => updatePitchType(p.id, { label: v })))),
          h('span', { class: 'muted' }, `用量 ${usage[p.id] ?? 0}`),
          button('删', () => removePitchType(p.id), 'danger'),
        ),
      );
    });
    const addTypeBtn = button('+ 节距类型', () => {
      if (seq.pitchTypes.length >= 5) return toast('最多支持 5 种节距长度', 'err');
      const idx = seq.pitchTypes.length;
      const t: PitchType = { id: uid('pitch'), length: 30 + idx * 6, label: ['S', 'M', 'L', 'XL', 'XXL'][idx] ?? `P${idx + 1}` };
      updateProject((p) => ({ ...p, sequence: { ...p.sequence, pitchTypes: [...p.sequence.pitchTypes, t] } }));
    }, 'primary');

    // ---- 约束 ----
    const c = seq.constraints;
    const constraintCard = card(
      '排列约束',
      labeled('同种最多连续', numInput(c.maxSameRun, (v) => updateConstraints({ maxSameRun: Math.max(1, Math.round(v)) }), 1, 1)),
      labeled('相邻长度比 ≤', numInput(c.maxAdjacentRatio, (v) => updateConstraints({ maxAdjacentRatio: Math.max(1, v) }), 0.05, 1)),
      labeled('谱峰权重', numInput(c.weightSpectralPeak, (v) => updateConstraints({ weightSpectralPeak: v }), 0.05, 0)),
      labeled('自相关权重', numInput(c.weightAutocorrelation, (v) => updateConstraints({ weightAutocorrelation: v }), 0.05, 0)),
    );

    // ---- 自动搜索 ----
    let targetCount = seq.pitchIds.length || suggestPitchCount(seq.pitchTypes, tire);
    const progress = h('div', { class: 'muted' }, '');
    const searchCard = card(
      '自动搜索（模拟退火）',
      labeled('目标节距数', numInput(targetCount, (v) => (targetCount = Math.round(v)), 1, 4)),
      button('在约束下搜索最优排列', () => runSearch(targetCount, progress), 'primary'),
      progress,
    );

    const left = h('div', { class: 'stack' }, card('节距类型（3~5 种长度）', typeRows, addTypeBtn), constraintCard, searchCard);

    // ---- 手排条带 ----
    const strip = h('div', { class: 'pitch-strip' });
    const totalW = 900;
    seq.pitchIds.forEach((id, i) => {
      const t = seq.pitchTypes.find((p) => p.id === id)!;
      const cell = h(
        'div',
        {
          class: `pitch-cell ${i === selected ? 'selected' : ''}`,
          style: `flex:${t.length};background:${colorOf(id)}`,
          title: `#${i + 1} ${t.label} ${t.length}mm`,
          onclick: () => {
            selected = selected === i ? -1 : i;
            draw();
          },
        },
        t.label,
      );
      strip.append(cell);
    });

    const manualTools = h('div', { class: 'btn-row' });
    if (selected >= 0 && seq.pitchIds[selected]) {
      const cur = seq.pitchIds[selected]!;
      manualTools.append(h('span', { class: 'muted' }, `选中 #${selected + 1}：`));
      for (const p of seq.pitchTypes) {
        manualTools.append(
          button(
            `${p.label}`,
            () => commit(setPitchAt(seq, selected, p.id)),
            p.id === cur ? 'primary' : 'ghost',
          ),
        );
      }
      manualTools.append(
        button('← 左移', () => selected > 0 && commit(swapPositions(seq, selected, selected - 1))),
        button('右移 →', () => selected < seq.pitchIds.length - 1 && commit(swapPositions(seq, selected, selected + 1))),
        button('前插', () => commit(insertPitchAt(seq, selected, cur))),
        button('删除', () => {
          commit(removePitchAt(seq, selected));
          selected = -1;
        }, 'danger'),
      );
    } else {
      manualTools.append(h('span', { class: 'muted' }, '点击条带中的节距块进行手排；末尾追加：'));
      for (const p of seq.pitchTypes) {
        manualTools.append(button(`+ ${p.label}`, () => commit({ ...seq, pitchIds: [...seq.pitchIds, p.id], updatedAt: Date.now() })));
      }
    }

    // ---- 冲突列表 ----
    const violList = h('div', { class: 'scroll-list', style: 'max-height:150px' });
    for (const v of violations.slice(0, 12)) violList.append(h('div', { class: 'badge badge-bad', style: 'text-align:left' }, v.message));

    // ---- 长度分布 ----
    const distCanvas = h('canvas', {}) as HTMLCanvasElement;
    const right = h(
      'div',
      { class: 'stack' },
      card('节距排列（宽度按实际长度比例）', strip, manualTools),
      card('约束冲突', violations.length === 0 ? h('span', { class: 'muted' }, '无') : violList),
      card('节距长度分布', h('div', { class: 'canvas-wrap' }, distCanvas)),
    );

    root.append(h('div', { class: 'grid-2' }, left, right));

    requestAnimationFrame(() => {
      const lens = seq.pitchIds.map((id) => seq.pitchTypes.find((p) => p.id === id)!.length);
      const bins = seq.pitchTypes.map((p, i) => ({
        x: i,
        y: lens.filter((l) => Math.abs(l - p.length) < 1e-6).length,
        color: PITCH_COLORS[i]!,
        label: p.label,
      }));
      drawBarChart(distCanvas, bins);
    });
  }

  function commit(next: PitchSequence) {
    updateProject((p) => ({ ...p, sequence: next }));
  }
  function updatePitchType(id: string, patch: Partial<PitchType>) {
    updateProject((p) => ({
      ...p,
      sequence: { ...p.sequence, pitchTypes: p.sequence.pitchTypes.map((t) => (t.id === id ? { ...t, ...patch } : t)) },
    }));
  }
  function updateConstraints(patch: Partial<PitchSequence['constraints']>) {
    updateProject((p) => ({ ...p, sequence: { ...p.sequence, constraints: { ...p.sequence.constraints, ...patch } } }));
  }
  function removePitchType(id: string) {
    const seq = getState().project.sequence;
    if (seq.pitchTypes.length <= 2) return toast('至少保留 2 种节距', 'err');
    if (seq.pitchIds.includes(id)) return toast('该类型仍在序列中使用，先替换掉再删', 'err');
    updateProject((p) => ({ ...p, sequence: { ...p.sequence, pitchTypes: p.sequence.pitchTypes.filter((t) => t.id !== id) } }));
  }

  async function runSearch(count: number, progressEl: HTMLElement) {
    setState({ busy: '搜索中…' });
    const seq = getState().project.sequence;
    await new Promise((r) => setTimeout(r, 30));
    try {
      const result = searchSequence(seq, {
        count,
        iterations: 20000,
        seed: (Date.now() & 0xffffffff) >>> 0,
        onProgress: (done, total, cost) => {
          progressEl.textContent = `进度 ${((done / total) * 100).toFixed(0)}%　当前最优目标值 ${cost.toFixed(4)}`;
        },
      });
      commit(result.sequence);
      selected = -1;
      toast(`搜索完成，目标值 ${result.cost.toFixed(4)}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : '搜索失败', 'err');
    } finally {
      setState({ busy: null });
    }
  }

  draw();
  const unsub = subscribePage(draw);
  return unsub;
}

function labelInput(value: string, onInput: (v: string) => void): HTMLInputElement {
  const input = h('input', { type: 'text', value, maxlength: '4' }) as HTMLInputElement;
  input.addEventListener('input', () => onInput(input.value));
  return input;
}

function drawBarChart(canvas: HTMLCanvasElement, bins: { x: number; y: number; color: string; label: string }[]): void {
  const wrap = canvas.parentElement!;
  const cssW = Math.max(420, wrap.clientWidth - 16);
  const cssH = 200;
  const { ctx, w, h } = setupCanvas(canvas, cssW, cssH);
  const pad = 36;
  const maxY = Math.max(1, ...bins.map((b) => b.y));
  const bw = (w - 2 * pad) / Math.max(bins.length, 1);
  ctx.font = '12px system-ui';
  bins.forEach((b, i) => {
    const bh = ((h - 2 * pad) * b.y) / maxY;
    ctx.fillStyle = b.color;
    ctx.fillRect(pad + i * bw + bw * 0.2, h - pad - bh, bw * 0.6, bh);
    ctx.fillStyle = 'var(--text-dim)';
    ctx.fillText(`${b.label}(${b.y})`, pad + i * bw + bw * 0.25, h - pad + 16);
    ctx.fillText(String(b.y), pad + i * bw + bw * 0.4, h - pad - bh - 6);
  });
  ctx.strokeStyle = 'rgba(128,140,160,0.3)';
  ctx.beginPath();
  ctx.moveTo(pad, h - pad);
  ctx.lineTo(w - pad, h - pad);
  ctx.stroke();
}

/**
 * 应用入口：外壳、页面路由、GPU 探测与首启数据。
 */
import './styles.css';
import { h, clear } from './app/ui';
import { initStore, getState, setState, subscribe, type PageId } from './app/store';
import { startPageBus } from './app/pageBus';
import { renderUnitPage } from './app/pages/unitPage';
import { renderSequencePage } from './app/pages/sequencePage';
import { renderTirePage } from './app/pages/tirePage';
import { renderFootprintPage } from './app/pages/footprintPage';
import { renderNoisePage } from './app/pages/noisePage';
import { createGpuBackend } from './gpu/footprintGpu';

const TABS: { id: PageId; label: string }[] = [
  { id: 'unit', label: '花纹单元' },
  { id: 'sequence', label: '节距序列' },
  { id: 'tire', label: '整胎预览' },
  { id: 'footprint', label: '接地印痕' },
  { id: 'noise', label: '噪声分析' },
];

let disposePage: (() => void) | null = null;

function mountPage(id: PageId) {
  const main = document.querySelector<HTMLElement>('#page-host')!;
  disposePage?.();
  clear(main);
  setState({ page: id });
  switch (id) {
    case 'unit':
      disposePage = renderUnitPage(main);
      break;
    case 'sequence':
      disposePage = renderSequencePage(main);
      break;
    case 'tire':
      disposePage = renderTirePage(main);
      break;
    case 'footprint':
      disposePage = renderFootprintPage(main);
      break;
    case 'noise':
      disposePage = renderNoisePage(main);
      break;
  }
  document.querySelectorAll<HTMLElement>('nav.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.page === id));
}

async function bootstrap() {
  const gpuSupported = typeof navigator !== 'undefined' && !!navigator.gpu;
  await initStore(gpuSupported);
  startPageBus();

  const app = document.querySelector<HTMLElement>('#app')!;
  const nav = h(
    'nav',
    { class: 'tabs' },
    ...TABS.map((t) => h('button', { 'data-page': t.id, onclick: () => mountPage(t.id) }, t.label)),
  );
  const gpuPill = h('span', { id: 'gpu-pill', class: `gpu-pill ${gpuSupported ? 'on' : 'off'}` }, gpuSupported ? 'WebGPU 可用' : 'WebGPU 不可用 · CPU 模式');
  const header = h('header', { class: 'topbar' }, h('div', { class: 'brand' }, '胎面节距设计与接地分析', h('small', {}, 'Tread Studio')), nav, gpuPill);
  const main = h('main', { class: 'page', id: 'page-host' });
  app.append(header, main);

  // 后台探测真实可用性（适配器/设备可能被策略拒绝）
  if (gpuSupported) {
    try {
      const backend = await createGpuBackend();
      if (!backend) {
        gpuPill.textContent = 'WebGPU 初始化失败 · CPU 模式';
        gpuPill.className = 'gpu-pill off';
        setState({ gpuAvailable: false });
      } else {
        backend.destroy();
        setState({ gpuAvailable: true });
      }
    } catch {
      gpuPill.textContent = 'WebGPU 初始化失败 · CPU 模式';
      gpuPill.className = 'gpu-pill off';
    }
  }

  mountPage('unit');
}

bootstrap().catch((e) => {
  console.error(e);
  document.body.innerHTML = `<pre style="padding:24px;color:#f2695c">启动失败：${String(e)}</pre>`;
});

// 忙态指示
const busyEl = h('div', { id: 'busy-mask', style: 'position:fixed;top:52px;right:18px;background:var(--bg-panel-2);border:1px solid var(--accent);padding:8px 14px;border-radius:8px;display:none;z-index:99' });
document.body.append(busyEl);
subscribe((s) => {
  busyEl.style.display = s.busy ? 'block' : 'none';
  busyEl.textContent = s.busy ?? '';
});

void getState;

/**
 * 页面总线：store 更新后微任务批处理通知当前活动页面重绘。
 * 一次同步代码块里的多次 store 更新合并为一次重绘，避免重入式 clear 递归。
 */
import { subscribe, getState, type AppState } from './store';

type PageListener = () => void;
const pageListeners = new Set<PageListener>();
let lastProject = 0;
let lastTests = 0;
let scheduled = false;

export function subscribePage(fn: PageListener): () => void {
  pageListeners.add(fn);
  return () => pageListeners.delete(fn);
}

function flush() {
  scheduled = false;
  for (const l of [...pageListeners]) l();
}

function maybeNotify(s: AppState): void {
  if (s.project.updatedAt !== lastProject || s.tests.length !== lastTests) {
    lastProject = s.project.updatedAt;
    lastTests = s.tests.length;
    if (!scheduled) {
      scheduled = true;
      queueMicrotask(flush);
    }
  }
}

export function startPageBus(): void {
  const s = getState();
  lastProject = s.project.updatedAt;
  lastTests = s.tests.length;
  subscribe(maybeNotify);
}

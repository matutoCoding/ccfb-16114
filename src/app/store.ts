/**
 * 极简响应式 store：发布订阅 + 浅层不可变更新，无框架依赖。
 */
import type { ProjectRecord, DrumTestRecord } from '../core/types';
import { storage } from '../db/storage';
import { buildDefaultProject } from '../core/defaults';
import { uid } from '../core/types';

export interface AppState {
  ready: boolean;
  project: ProjectRecord;
  /** 对比用第二套序列（等节距基准） */
  compareSequenceId: string | null;
  tests: DrumTestRecord[];
  gpuAvailable: boolean;
  gpuVerified: boolean;
  gpuMaxDiff: number;
  page: PageId;
  busy: string | null;
  error: string | null;
}

export type PageId = 'unit' | 'sequence' | 'tire' | 'footprint' | 'noise';

type Listener = (s: AppState) => void;

let state: AppState;
const listeners = new Set<Listener>();

export function getState(): AppState {
  return state;
}

export function setState(patch: Partial<AppState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l(state);
}

export function updateProject(mut: (p: ProjectRecord) => ProjectRecord): void {
  const project = mut(state.project);
  setState({ project: { ...project, updatedAt: Date.now() } });
  void storage.saveProject(state.project);
}

export function subscribe(l: Listener): () => void {
  listeners.add(l);
  l(state);
  return () => listeners.delete(l);
}

export async function initStore(gpuAvailable: boolean): Promise<void> {
  const projects = await storage.listProjects();
  const tests = await storage.listTests();
  let project = projects[0];
  if (!project) {
    project = buildDefaultProject();
    await storage.saveProject(project);
  }
  state = {
    ready: true,
    project,
    compareSequenceId: null,
    tests,
    gpuAvailable,
    gpuVerified: false,
    gpuMaxDiff: 0,
    page: 'unit',
    busy: null,
    error: null,
  };
  for (const l of listeners) l(state);
}

export async function refreshTests(): Promise<void> {
  const tests = await storage.listTests();
  setState({ tests });
}

export async function addTest(record: DrumTestRecord, blob?: Blob): Promise<void> {
  if (blob && record.pressurePaperBlobId) await storage.putBlob(record.pressurePaperBlobId, blob);
  await storage.saveTest(record);
  await refreshTests();
}

export async function removeTest(id: string): Promise<void> {
  const rec = state.tests.find((t) => t.id === id);
  await storage.deleteTest(id);
  if (rec?.pressurePaperBlobId) await storage.deleteBlob(rec.pressurePaperBlobId);
  await refreshTests();
}

export function newTestId(): string {
  return uid('test');
}

export function newBlobId(): string {
  return uid('blob');
}

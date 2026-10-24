import { contextBridge, ipcRenderer } from 'electron';
import type {
  CatalogRow,
  CloudConfig,
  GenerateProgress,
  GenerateRequest,
  GenerateShapedRequest,
  PxApi,
  RefreshEndlessRequest,
  RegenerateRequest,
  StudioStatus,
} from '../src/types';

const api: PxApi = {
  status: () => ipcRenderer.invoke('px:status') as Promise<StudioStatus>,
  probe: () => ipcRenderer.invoke('px:probe') as Promise<StudioStatus>,
  list: () => ipcRenderer.invoke('px:list') as Promise<CatalogRow[]>,
  getLevel: (levelNumber: number) =>
    ipcRenderer.invoke('px:get', levelNumber) as Promise<import('../../../src/levels/types').Level | null>,
  schema: () => ipcRenderer.invoke('px:schema') as Promise<string>,
  keys: () =>
    ipcRenderer.invoke('px:keys') as Promise<{
      url: string;
      anonKey: string;
      serviceRoleKey: string;
    }>,
  generate: (request: GenerateRequest) =>
    ipcRenderer.invoke('px:generate', request) as Promise<{ generated: number[]; skipped: number[] }>,
  generateShaped: (request: GenerateShapedRequest) =>
    ipcRenderer.invoke('px:generateShaped', request) as Promise<import('../../../src/levels/types').Level>,
  regenerate: (request: RegenerateRequest) =>
    ipcRenderer.invoke('px:regenerate', request) as Promise<{
      generated: number[];
      skipped: string[];
      cancelled?: 'now' | 'after';
    }>,
  refreshEndless: (request: RefreshEndlessRequest) =>
    ipcRenderer.invoke('px:refreshEndless', request) as Promise<{
      generated: number[];
      cancelled?: 'now' | 'after';
    }>,
  cancelGenerate: (mode: 'now' | 'after') => ipcRenderer.invoke('px:cancelGenerate', mode) as Promise<void>,
  pickFolder: () =>
    ipcRenderer.invoke('px:pickFolder') as Promise<{ path: string; count: number } | null>,
  listFolder: (path: string) =>
    ipcRenderer.invoke('px:listFolder', path) as Promise<{ path: string; count: number }>,
  onProgress: (handler: (progress: GenerateProgress) => void) => {
    const listen = (_event: unknown, progress: GenerateProgress) => handler(progress);
    ipcRenderer.on('px:progress', listen);
    return () => ipcRenderer.removeListener('px:progress', listen);
  },
  deleteLocal: (levelNumbers: number[]) => ipcRenderer.invoke('px:deleteLocal', levelNumbers),
  deleteCloud: (levelNumbers: number[]) => ipcRenderer.invoke('px:deleteCloud', levelNumbers),
  uploadSelected: (levelNumbers: number[]) => ipcRenderer.invoke('px:uploadSelected', levelNumbers),
  uploadPending: () => ipcRenderer.invoke('px:uploadPending'),
  uploadEndlessPending: () => ipcRenderer.invoke('px:uploadEndlessPending'),
  pull: () => ipcRenderer.invoke('px:pull'),
  saveConfig: (config: CloudConfig) => ipcRenderer.invoke('px:saveConfig', config),
  setup: () => ipcRenderer.invoke('px:setup'),
  saveLevel: (level) =>
    ipcRenderer.invoke('px:saveLevel', level) as Promise<import('../../../src/levels/types').Level>,
};

contextBridge.exposeInMainWorld('px', api);

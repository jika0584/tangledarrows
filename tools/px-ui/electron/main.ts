import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../../px/env';
import {
  deleteCloud,
  deleteLocal,
  generateRange,
  generateShaped,
  getCatalogLevel,
  listCatalog,
  probeSupabase,
  pullFromCloud,
  regenerateRange,
  requestGenerationCancel,
  saveCatalogLevel,
  saveCloudConfig,
  schemaSql,
  studioStatus,
  uploadPending,
  uploadSelected,
  type CloudConfig,
  type GenerateRequest,
  type GenerateShapedRequest,
  type RegenerateRequest,
} from '../../px/service';
import { currentKeysMasked, setupSupabase } from '../../px/setupSupabase';
import { defaultShapeFolder, listImageFiles } from '../../px/shapeFolder';
import type { Raster } from '../../../src/procedural/shapeFromImage';

process.env.NODE_NO_WARNINGS = '1';
loadEnv();

const here = dirname(fileURLToPath(import.meta.url));

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 980,
    minHeight: 660,
    title: 'PX — Amaze Escape',
    backgroundColor: '#D6F0F7',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(here, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void window.loadFile(join(here, '../dist/index.html'));
  }

  return window;
}

function registerIpc(): void {
  ipcMain.handle('px:status', () => studioStatus());
  ipcMain.handle('px:probe', () => probeSupabase());
  ipcMain.handle('px:list', () => listCatalog());
  ipcMain.handle('px:get', (_event, levelNumber: number) => getCatalogLevel(levelNumber));
  ipcMain.handle('px:schema', () => schemaSql());
  ipcMain.handle('px:keys', () => currentKeysMasked());

  ipcMain.handle('px:generate', async (event, request: GenerateRequest) => {
    return generateRange(request, (progress) => {
      event.sender.send('px:progress', progress);
    }, rasterFromPath);
  });

  ipcMain.handle('px:generateShaped', async (event, request: GenerateShapedRequest) => {
    return generateShaped(request, (progress) => {
      event.sender.send('px:progress', progress);
    });
  });

  ipcMain.handle('px:regenerate', async (event, request: RegenerateRequest) => {
    return regenerateRange(request, (progress) => {
      event.sender.send('px:progress', progress);
    }, rasterFromPath);
  });

  ipcMain.handle('px:cancelGenerate', (_event, mode: 'now' | 'after') => {
    requestGenerationCancel(mode === 'after' ? 'after' : 'now');
  });

  ipcMain.handle('px:pickFolder', async () => {
    const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const options = {
      title: 'Shape folder',
      defaultPath: defaultShapeFolder(),
      properties: ['openDirectory'] as Array<'openDirectory'>,
    };
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return null;
    const path = result.filePaths[0];
    return { path, count: listImageFiles(path).length };
  });

  ipcMain.handle('px:deleteLocal', (_event, levelNumbers: number[]) => deleteLocal(levelNumbers));
  ipcMain.handle('px:deleteCloud', (_event, levelNumbers: number[]) => deleteCloud(levelNumbers));
  ipcMain.handle('px:uploadSelected', (_event, levelNumbers: number[]) => uploadSelected(levelNumbers));
  ipcMain.handle('px:uploadPending', () => uploadPending());
  ipcMain.handle('px:pull', () => pullFromCloud());
  ipcMain.handle('px:saveConfig', (_event, config: CloudConfig) => saveCloudConfig(config));
  ipcMain.handle('px:setup', () => setupSupabase());
  ipcMain.handle('px:saveLevel', (_event, level: import('../../../src/levels/types').Level) =>
    saveCatalogLevel(level),
  );
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

function rasterFromPath(file: string): Raster {
  const image = nativeImage.createFromPath(file);
  if (image.isEmpty()) {
    throw new Error(`Could not read image: ${file}`);
  }
  const { width, height } = image.getSize();
  const bgra = image.toBitmap();
  if (width < 1 || height < 1 || bgra.length < width * height * 4) {
    throw new Error(`Could not decode image: ${file}`);
  }
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const offset = i * 4;
    data[offset] = bgra[offset + 2];
    data[offset + 1] = bgra[offset + 1];
    data[offset + 2] = bgra[offset];
    data[offset + 3] = bgra[offset + 3];
  }
  return { width, height, data };
}

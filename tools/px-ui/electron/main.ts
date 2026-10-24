import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, type NativeImage } from 'electron';
import { readFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
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
  refreshEndless,
  regenerateRange,
  requestGenerationCancel,
  saveCatalogLevel,
  saveCloudConfig,
  schemaSql,
  studioStatus,
  uploadEndlessPending,
  uploadPending,
  uploadSelected,
  type CloudConfig,
  type GenerateRequest,
  type GenerateShapedRequest,
  type RefreshEndlessRequest,
  type RegenerateRequest,
} from '../../px/service';
import { currentKeysMasked, setupSupabase } from '../../px/setupSupabase';
import { defaultShapeFolder, listImageFiles } from '../../px/shapeFolder';
import { isShapeSidecar, saveShapeBytes } from '../../px/shapeStore';
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

  ipcMain.handle('px:refreshEndless', async (event, request: RefreshEndlessRequest) => {
    return refreshEndless(request, (progress) => {
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

  ipcMain.handle('px:listFolder', (_event, path: string) => {
    const folder = typeof path === 'string' ? path : '';
    return { path: folder, count: listImageFiles(folder).length };
  });

  ipcMain.handle('px:deleteLocal', (_event, levelNumbers: number[]) => deleteLocal(levelNumbers));
  ipcMain.handle('px:deleteCloud', (_event, levelNumbers: number[]) => deleteCloud(levelNumbers));
  ipcMain.handle('px:uploadSelected', (_event, levelNumbers: number[]) => uploadSelected(levelNumbers));
  ipcMain.handle('px:uploadPending', () => uploadPending());
  ipcMain.handle('px:uploadEndlessPending', () => uploadEndlessPending());
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

function rasterFromNative(image: NativeImage, file: string): Raster {
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

function mimeFromExt(ext: string): string {
  switch (ext.toLowerCase()) {
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.bmp':
      return 'image/bmp';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    default:
      return 'application/octet-stream';
  }
}

async function decodeToPngBuffer(file: string): Promise<Buffer> {
  const bytes = readFileSync(file);
  const dataUrl = `data:${mimeFromExt(extname(file))};base64,${bytes.toString('base64')}`;
  const window =
    BrowserWindow.getFocusedWindow() ??
    BrowserWindow.getAllWindows().find((open) => !open.isDestroyed());
  if (!window) {
    throw new Error(`Could not read image: ${file}`);
  }
  const pngDataUrl = (await window.webContents.executeJavaScript(`
    (async () => {
      const img = new Image();
      img.src = ${JSON.stringify(dataUrl)};
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not decode image');
      ctx.drawImage(img, 0, 0);
      return canvas.toDataURL('image/png');
    })()
  `)) as string;
  const comma = pngDataUrl.indexOf(',');
  if (!pngDataUrl.startsWith('data:image/png') || comma < 0) {
    throw new Error(`Could not read image: ${file}`);
  }
  return Buffer.from(pngDataUrl.slice(comma + 1), 'base64');
}

function rewriteSidecarAsPng(file: string, png: Buffer): void {
  if (!isShapeSidecar(file)) return;
  const ext = extname(file).toLowerCase();
  if (ext === '.png' || ext === '.jpg' || ext === '.jpeg') return;
  const levelNumber = Number.parseInt(basename(file, ext), 10);
  if (!Number.isInteger(levelNumber) || levelNumber < 1) return;
  saveShapeBytes(levelNumber, `${levelNumber}.png`, png);
}

async function rasterFromPath(file: string): Promise<Raster> {
  const image = nativeImage.createFromPath(file);
  if (!image.isEmpty()) {
    return rasterFromNative(image, file);
  }

  // Windows nativeImage cannot decode WebP (and some GIF/BMP). Chromium can.
  let png: Buffer;
  try {
    png = await decodeToPngBuffer(file);
  } catch {
    throw new Error(`Could not read image: ${file}`);
  }
  const decoded = nativeImage.createFromBuffer(png);
  if (decoded.isEmpty()) {
    throw new Error(`Could not read image: ${file}`);
  }
  rewriteSidecarAsPng(file, png);
  return rasterFromNative(decoded, file);
}

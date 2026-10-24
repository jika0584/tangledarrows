import type { Raster } from '../../../src/procedural/shapeFromImage';

const DIRECT_STORE = new Set(['.png', '.jpg', '.jpeg']);

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot).toLowerCase() : '';
}

export async function rasterFromFile(file: File): Promise<{
  raster: Raster;
  fileName: string;
  bytes: number[];
}> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not read that image.');
    context.drawImage(image, 0, 0);
    const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
    const raster: Raster = { width, height, data };

    const ext = extensionOf(file.name);
    if (DIRECT_STORE.has(ext)) {
      return {
        raster,
        fileName: file.name,
        bytes: [...new Uint8Array(await file.arrayBuffer())],
      };
    }

    const png = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode PNG.'))),
        'image/png',
      );
    });
    const base = file.name.replace(/\.[^.]+$/, '') || 'shape';
    return {
      raster,
      fileName: `${base}.png`,
      bytes: [...new Uint8Array(await png.arrayBuffer())],
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

import type { Raster } from '../../../src/procedural/shapeFromImage';

export async function rasterFromFile(file: File): Promise<Raster> {
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
    return { width, height, data };
  } finally {
    URL.revokeObjectURL(url);
  }
}

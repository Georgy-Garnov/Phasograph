/** Photo preparation: downscaling to a reasonable size and a thumbnail. Runs in the browser (canvas). */

/** Long side of the stored photo, px. ~1920 px is enough to make out insulators and the pole number. */
export const PHOTO_MAX = 1920;
export const THUMB_MAX = 240;

export interface ProcessedPhoto {
  blob: Blob;
  thumb: Blob;
  width: number;
  height: number;
}

/**
 * Decode via <img>: browsers (including Safari on iPhone/iPad) then respect
 * EXIF orientation, so a camera shot will not end up rotated.
 */
function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image-decode-failed'));
    };
    img.src = url;
  });
}

function resize(img: HTMLImageElement, max: number, quality: number): Promise<{ blob: Blob; width: number; height: number }> {
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.round(img.naturalWidth * scale);
  const height = Math.round(img.naturalHeight * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve({ blob: b, width, height }) : reject(new Error('encode-failed'))), 'image/jpeg', quality),
  );
}

export async function processPhoto(file: Blob): Promise<ProcessedPhoto> {
  const img = await loadImage(file);
  const full = await resize(img, PHOTO_MAX, 0.82);
  const thumb = await resize(img, THUMB_MAX, 0.7);
  return { blob: full.blob, thumb: thumb.blob, width: full.width, height: full.height };
}

/** Thumbnail and dimensions of an already compressed image (on ZIP import). */
export async function makeThumb(blob: Blob): Promise<{ thumb: Blob; width: number; height: number }> {
  const img = await loadImage(blob);
  const thumb = await resize(img, THUMB_MAX, 0.7);
  return { thumb: thumb.blob, width: img.naturalWidth, height: img.naturalHeight };
}

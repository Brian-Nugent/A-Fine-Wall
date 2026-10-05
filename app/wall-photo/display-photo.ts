const MAX_DISPLAY_EDGE = 2560;
const MAX_DISPLAY_BYTES = 2 * 1024 * 1024;

/** Keep the original for tracing; use a smaller, identically framed photo for climbs. */
export async function createDisplayPhoto(file: File): Promise<Blob | null> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(1, MAX_DISPLAY_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const encode = (type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.82));
    let display = await encode("image/webp");
    // Older Safari versions can fall back to PNG when WebP encoding is unavailable.
    if (display?.type !== "image/webp") display = await encode("image/jpeg");
    canvas.width = canvas.height = 1;
    return display && display.size < file.size && display.size <= MAX_DISPLAY_BYTES ? display : null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

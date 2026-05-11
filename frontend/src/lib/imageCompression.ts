/**
 * Comprime una imagen usando Canvas API antes de subirla.
 * Reduce de 3-5MB a ~300-600KB manteniendo calidad aceptable.
 */
export async function compressImage(
  file: File | Blob,
  maxWidth = 1280,
  maxHeight = 1280,
  quality = 0.7
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      let { width, height } = img;

      // Scale down if larger than max dimensions
      if (width > maxWidth || height > maxHeight) {
        const ratio = Math.min(maxWidth / width, maxHeight / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("Canvas not supported")); return; }

      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            // Fallback: return original
            resolve(file instanceof Blob ? file : new Blob([file]));
          }
        },
        "image/jpeg",
        quality
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      // If can't process, return original
      resolve(file instanceof Blob ? file : new Blob([file]));
    };

    img.src = url;
  });
}

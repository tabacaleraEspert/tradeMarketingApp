/**
 * Hook universal para captura de fotos.
 *
 * Patrón: preview optimista + compresión + cola offline (executeOrEnqueue).
 * Nunca rompe la app si falla la subida — la foto queda en cola o se descarta silenciosamente.
 *
 * Uso básico:
 *   const { inputRef, inputProps, takePhoto, photos, removePhoto } = usePhotoCapture({ visitId, photoType: "fachada" });
 *   <input ref={inputRef} {...inputProps} />
 *   <button onClick={takePhoto}>Tomar foto</button>
 */

import { useRef, useState, useCallback } from "react";
import { executeOrEnqueue } from "@/lib/offline/execute";

export interface CapturedPhoto {
  url: string;       // ObjectURL for preview
  file?: File;       // Original file (before upload)
  fileId?: number;   // Server FileId after upload
  pending?: boolean; // Queued for upload
}

export interface UsePhotoCaptureOptions {
  /** Upload endpoint base: `/files/photos/visit/${visitId}` or `/files/photos/pdv/${pdvId}` */
  uploadUrl?: string;
  /** Photo type string sent to the server */
  photoType?: string;
  /** Label for the offline queue entry */
  label?: string;
  /** If the visit is offline-created, pass the temp ID */
  tempVisitId?: number;
  /** If true, upload immediately on capture. If false, store locally (upload on form save). Default: true */
  uploadImmediately?: boolean;
  /** Max file size in bytes (default: 15MB) */
  maxFileSize?: number;
  /** Callback on successful upload */
  onUploaded?: (photo: CapturedPhoto, serverData: unknown) => void;
  /** Callback on error (default: silent) */
  onError?: (error: unknown) => void;
}

export function usePhotoCapture(options: UsePhotoCaptureOptions = {}) {
  const {
    uploadUrl,
    photoType = "general",
    label = "Foto",
    tempVisitId,
    uploadImmediately = true,
    maxFileSize = 15 * 1024 * 1024,
    onUploaded,
    onError,
  } = options;

  const inputRef = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);

  const takePhoto = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const handleInput = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // Allow re-selecting same file
    if (!file) return;

    // Basic validation
    if (!file.type.startsWith("image/")) return;
    if (file.size > maxFileSize) return;

    // Optimistic preview
    const url = URL.createObjectURL(file);
    const newPhoto: CapturedPhoto = { url, file, pending: true };
    setPhotos((prev) => [...prev, newPhoto]);

    // Upload immediately if configured and we have an endpoint
    if (uploadImmediately && uploadUrl) {
      try {
        const { compressImage } = await import("@/lib/imageCompression");
        const compressed = await compressImage(file);

        const result = await executeOrEnqueue({
          kind: "photo_upload",
          method: "POST",
          url: uploadUrl,
          formParts: [
            { name: "file", value: compressed, filename: `${photoType}_${Date.now()}.jpg` },
            { name: "photo_type", value: photoType },
          ],
          label,
          _tempVisitId: tempVisitId,
        });

        if (!result.queued && result.data) {
          const serverData = result.data as { FileId?: number };
          setPhotos((prev) =>
            prev.map((p) =>
              p.url === url ? { ...p, fileId: serverData.FileId, pending: false } : p
            )
          );
          onUploaded?.({ ...newPhoto, fileId: serverData.FileId, pending: false }, result.data);
        }
        // If queued, the photo stays with pending=true — that's fine
      } catch (err) {
        // Never crash — photo stays in preview, user can retry or it's in offline queue
        console.warn("[usePhotoCapture] upload failed, keeping preview:", err);
        onError?.(err);
      }
    }
  }, [uploadUrl, photoType, label, tempVisitId, uploadImmediately, maxFileSize, onUploaded, onError]);

  const removePhoto = useCallback((index: number) => {
    setPhotos((prev) => {
      const removed = prev[index];
      if (removed?.url) URL.revokeObjectURL(removed.url);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const clearPhotos = useCallback(() => {
    setPhotos((prev) => {
      prev.forEach((p) => { if (p.url) URL.revokeObjectURL(p.url); });
      return [];
    });
  }, []);

  /** Compress and upload all pending photos (for deferred upload pattern) */
  const uploadAll = useCallback(async (overrideUrl?: string, overridePhotoType?: string) => {
    const url = overrideUrl || uploadUrl;
    if (!url) return;

    const pending = photos.filter((p) => p.file && !p.fileId);
    for (const photo of pending) {
      if (!photo.file) continue;
      try {
        const { compressImage } = await import("@/lib/imageCompression");
        const compressed = await compressImage(photo.file);
        const type = overridePhotoType || photoType;

        await executeOrEnqueue({
          kind: "photo_upload",
          method: "POST",
          url,
          formParts: [
            { name: "file", value: compressed, filename: `${type}_${Date.now()}.jpg` },
            { name: "photo_type", value: type },
          ],
          label,
          _tempVisitId: tempVisitId,
        });
      } catch (err) {
        // Silent — queued or skip
        console.warn("[usePhotoCapture] uploadAll failed for photo, skipping:", err);
      }
    }
  }, [photos, uploadUrl, photoType, label, tempVisitId]);

  // Props to spread on the hidden <input>
  // Nota: sin `capture` para que el usuario pueda elegir entre cámara y galería
  // (pedido del campo — a veces necesitan subir una foto vieja o tomar una nueva).
  // El browser muestra el chooser nativo con ambas opciones.
  const inputProps = {
    type: "file" as const,
    accept: "image/*",
    className: "hidden",
    onChange: handleInput,
  };

  return {
    inputRef,
    inputProps,
    takePhoto,
    photos,
    setPhotos,
    removePhoto,
    clearPhotos,
    uploadAll,
    hasPhotos: photos.length > 0,
  };
}

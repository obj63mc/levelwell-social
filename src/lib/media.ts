import type { ConvexReactClient } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

export type LocalMedia = {
  mediaId: Id<"media">;
  kind: "image" | "video";
  url: string;
  name: string;
  width?: number;
  height?: number;
  durationMs?: number;
};

export const ACCEPT = "image/jpeg,image/png,video/mp4,video/quicktime";

/** Instagram only accepts JPEG: re-encode anything else via canvas. Returns size too. */
export async function prepareImage(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  try {
    if (file.type === "image/jpeg") return { blob: file, width: bitmap.width, height: bitmap.height };
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff"; // PNG transparency → white, not black
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    if (!blob) throw new Error("Could not convert the image to JPEG.");
    return { blob, width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

export function probeVideo(file: File): Promise<{ width: number; height: number; durationMs: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      resolve({ width: video.videoWidth, height: video.videoHeight, durationMs: Math.round(video.duration * 1000) });
      URL.revokeObjectURL(url);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Could not read ${file.name}.`));
    };
    video.src = url;
  });
}

/** generateUploadUrl → POST bytes → register. */
export async function uploadMedia(
  convex: ConvexReactClient,
  sessionToken: string,
  profileId: Id<"profiles">,
  file: File,
): Promise<LocalMedia> {
  const isVideo = file.type.startsWith("video/");
  let body: Blob = file;
  let mimeType = file.type;
  let meta: { width?: number; height?: number; durationMs?: number };
  if (isVideo) {
    meta = await probeVideo(file);
  } else {
    const prepared = await prepareImage(file);
    body = prepared.blob;
    mimeType = "image/jpeg";
    meta = { width: prepared.width, height: prepared.height };
  }
  const uploadUrl = await convex.mutation(api.media.generateUploadUrl, { sessionToken, profileId });
  const res = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": mimeType }, body });
  if (!res.ok) throw new Error(`Upload failed (${res.status}).`);
  const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
  const { mediaId, url } = await convex.mutation(api.media.register, {
    sessionToken,
    profileId,
    storageId,
    kind: isVideo ? "video" : "image",
    mimeType,
    sizeBytes: body.size,
    ...meta,
  });
  return { mediaId, kind: isVideo ? "video" : "image", url, name: file.name, ...meta };
}

export function isPortrait(m: { width?: number; height?: number }): boolean {
  return !!m.width && !!m.height && m.height / m.width > 1.6;
}

/** Local datetime-local input value ⇄ epoch ms. */
export function toLocalInputValue(ms: number): string {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
}
export function fromLocalInputValue(value: string): number {
  return new Date(value).getTime();
}

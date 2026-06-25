import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import type { TaskAttachment, TaskAttachmentInput } from "../types.js";

const MAX_ATTACHMENTS = 10;
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

export function persistTaskAttachments(
  runtimeDir: string,
  taskId: string,
  attachments: TaskAttachmentInput[] | undefined,
): { ok: true; attachments: TaskAttachment[] } | { ok: false; error: string } {
  const input = attachments ?? [];
  if (input.length === 0) {
    return { ok: true, attachments: [] };
  }
  if (input.length > MAX_ATTACHMENTS) {
    return { ok: false, error: `附件数量不能超过 ${MAX_ATTACHMENTS} 个。` };
  }

  const root = resolve(runtimeDir, "attachments", taskId);
  mkdirSync(root, { recursive: true });
  const persisted: TaskAttachment[] = [];

  for (let index = 0; index < input.length; index++) {
    const item = input[index];
    const decoded = decodeAttachmentBase64(item.base64);
    if (!decoded.ok) {
      return { ok: false, error: `附件 ${index + 1} 不是有效 base64。` };
    }
    if (decoded.bytes.length > MAX_ATTACHMENT_BYTES) {
      return { ok: false, error: `附件 ${item.name || index + 1} 超过 ${MAX_ATTACHMENT_BYTES / 1024 / 1024}MB。` };
    }
    if (typeof item.size_bytes === "number" && item.size_bytes > 0 && item.size_bytes !== decoded.bytes.length) {
      return { ok: false, error: `附件 ${item.name || index + 1} 的大小和内容不一致。` };
    }

    const mimeType = sanitizeMimeType(item.mime_type);
    const kind = item.kind ?? (mimeType.startsWith("image/") ? "image" : "file");
    const safeName = sanitizeAttachmentName(item.name, mimeType, index + 1);
    const storedName = `${String(index + 1).padStart(2, "0")}-${safeName}`;
    const targetPath = resolve(root, storedName);
    if (!isInside(root, targetPath)) {
      return { ok: false, error: "附件路径安全校验失败。" };
    }

    writeFileSync(targetPath, decoded.bytes);
    persisted.push({
      id: `att_${index + 1}`,
      name: safeName,
      mime_type: mimeType,
      size_bytes: decoded.bytes.length,
      path: targetPath,
      kind,
    });
  }

  return { ok: true, attachments: persisted };
}

function decodeAttachmentBase64(value: string): { ok: true; bytes: Buffer } | { ok: false } {
  if (typeof value !== "string" || value.trim().length === 0) {
    return { ok: false };
  }
  const raw = value.includes(",") ? value.slice(value.indexOf(",") + 1) : value;
  if (!/^[a-zA-Z0-9+/=\r\n]+$/.test(raw)) {
    return { ok: false };
  }
  const bytes = Buffer.from(raw, "base64");
  if (bytes.length === 0) {
    return { ok: false };
  }
  return { ok: true, bytes };
}

function sanitizeMimeType(value: string | undefined): string {
  if (!value || !/^[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+$/.test(value)) {
    return "application/octet-stream";
  }
  return value;
}

function sanitizeAttachmentName(name: string | undefined, mimeType: string, index: number): string {
  const fallbackExt = extensionFromMime(mimeType);
  const raw = (name ?? "").trim() || `attachment-${index}${fallbackExt}`;
  const basename = raw
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\.\.+/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, 120)
    .trim();
  const withFallback = basename || `attachment-${index}${fallbackExt}`;
  if (extname(withFallback)) {
    return withFallback;
  }
  return `${withFallback}${fallbackExt}`;
}

function extensionFromMime(mimeType: string): string {
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/webp") return ".webp";
  if (mimeType === "image/gif") return ".gif";
  if (mimeType === "text/plain") return ".txt";
  return ".bin";
}

function isInside(root: string, candidate: string): boolean {
  const normalizedRoot = resolve(root);
  const normalizedCandidate = resolve(candidate);
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(normalizedRoot + "\\") || normalizedCandidate.startsWith(normalizedRoot + "/");
}

export function taskHasImageAttachment(attachments: TaskAttachmentInput[] | undefined): boolean {
  return (attachments ?? []).some((item) => item.kind === "image" || item.mime_type?.startsWith("image/"));
}

export function attachmentRuntimeDirExists(runtimeDir: string, taskId: string): boolean {
  return existsSync(join(runtimeDir, "attachments", taskId));
}

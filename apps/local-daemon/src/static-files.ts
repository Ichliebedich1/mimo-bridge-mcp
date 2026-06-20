import { createReadStream, existsSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { findRepoRoot } from "./daemon-config.js";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

export function tryServeStatic(req: IncomingMessage, res: ServerResponse, url: URL): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return false;
  }

  const distRoot = resolve(findRepoRoot(), "apps", "admin-ui", "dist");
  if (!existsSync(distRoot)) {
    return false;
  }

  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const candidate = safeResolve(distRoot, requestedPath);
  const fallbackIndex = join(distRoot, "index.html");
  const filePath = candidate && existsSync(candidate) && statSync(candidate).isFile()
    ? candidate
    : fallbackIndex;

  if (!isInsideRoot(distRoot, filePath) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    return false;
  }

  const stat = statSync(filePath);
  res.writeHead(200, {
    "content-type": MIME_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream",
    "content-length": stat.size,
    "cache-control": filePath.endsWith("index.html") ? "no-store" : "public, max-age=31536000, immutable",
  });
  if (req.method === "HEAD") {
    res.end();
    return true;
  }
  createReadStream(filePath).pipe(res);
  return true;
}

function safeResolve(root: string, requestPath: string): string | null {
  const cleaned = requestPath.replace(/^\/+/, "");
  const fullPath = resolve(root, cleaned);
  const normalizedRoot = normalize(root);
  const normalizedFullPath = normalize(fullPath);
  if (normalizedFullPath === normalizedRoot || normalizedFullPath.startsWith(normalizedRoot + "\\")) {
    return fullPath;
  }
  return null;
}

function isInsideRoot(root: string, filePath: string): boolean {
  const normalizedRoot = normalize(root);
  const normalizedFilePath = normalize(filePath);
  return normalizedFilePath === normalizedRoot || normalizedFilePath.startsWith(normalizedRoot + "\\");
}

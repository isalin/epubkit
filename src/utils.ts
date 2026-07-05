import path from "node:path";
import { randomUUID } from "node:crypto";

export const textDecoder = new TextDecoder("utf-8");
export const textEncoder = new TextEncoder();

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base"
});

export function naturalCompare(a: string, b: string): number {
  return collator.compare(a, b);
}

export function toBytes(value: string | Uint8Array): Uint8Array {
  return typeof value === "string" ? textEncoder.encode(value) : value;
}

export function fromBytes(value: Uint8Array): string {
  return textDecoder.decode(value);
}

export function normalizeZipPath(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/^\/+/, "");
  const parts = normalized.split("/").filter(Boolean);
  const out: string[] = [];
  for (const part of parts) {
    if (part === ".") continue;
    if (part === "..") {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join("/");
}

export function zipDirname(value: string): string {
  const normalized = normalizeZipPath(value);
  const dir = path.posix.dirname(normalized);
  return dir === "." ? "" : dir;
}

export function joinZip(...parts: string[]): string {
  return normalizeZipPath(path.posix.join(...parts.filter(Boolean)));
}

export function relativeFromZip(fromFile: string, href: string): string {
  const base = zipDirname(fromFile);
  return joinZip(base, decodeURIComponent(href.replace(/#.*/, "")));
}

export function hrefFromZipPath(filePath: string): string {
  return filePath.replaceAll("\\", "/").replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/");
}

export function relativeToBase(baseDir: string, target: string): string {
  const rel = path.posix.relative(baseDir || ".", target);
  return normalizeZipPath(rel);
}

export function dirnameOrDot(value: string): string {
  const dir = path.dirname(value);
  return dir === "." ? process.cwd() : dir;
}

export function ensureExt(value: string, ext: string): string {
  return value.toLowerCase().endsWith(ext) ? value : `${value}${ext}`;
}

export function filenameStem(value: string): string {
  return path.basename(value, path.extname(value));
}

export function sanitizeFilename(value: string): string {
  const clean = value
    .normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return clean || "untitled";
}

export function commonFilenamePrefix(files: string[]): string {
  if (files.length === 0) return "merged";
  const stems = files.map((file) => filenameStem(file));
  let prefix = stems[0] ?? "merged";
  for (const stem of stems.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < stem.length && prefix[i] === stem[i]) i += 1;
    prefix = prefix.slice(0, i);
  }
  const fallback = prefix.replace(/[-_.\s]+$/g, "");
  return fallback ? sanitizeFilename(fallback) : "merged";
}

export function splitMultiValue(value: string): string[] {
  return value
    .split("//")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function parseContributor(value: string): { name: string; fileAs?: string } {
  const [name, fileAs] = value.split("--", 2).map((part) => part.trim());
  return fileAs ? { name, fileAs } : { name };
}

export function uuidUrn(): string {
  return `urn:uuid:${randomUUID()}`;
}

export function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function decodeXmlEntities(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

export function extMimeType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".xhtml":
    case ".html":
    case ".htm":
      return "application/xhtml+xml";
    case ".css":
      return "text/css";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".gif":
      return "image/gif";
    case ".svg":
      return "image/svg+xml";
    case ".webp":
      return "image/webp";
    case ".avif":
      return "image/avif";
    case ".otf":
      return "font/otf";
    case ".ttf":
      return "font/ttf";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    case ".ncx":
      return "application/x-dtbncx+xml";
    default:
      return "application/octet-stream";
  }
}

export function isImageMime(mediaType: string): boolean {
  return mediaType.startsWith("image/");
}

export function formatList(values: string[]): string {
  return values.filter(Boolean).join(", ");
}

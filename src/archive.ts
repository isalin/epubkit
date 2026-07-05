import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { unzipSync, Zip, ZipDeflate, ZipPassThrough } from "fflate";
import type { DeflateOptions } from "fflate";
import { fromBytes, normalizeZipPath, toBytes } from "./utils.js";

export type ArchiveFiles = Map<string, Uint8Array>;
type WriteFileOptions = Parameters<typeof writeFile>[2];

export async function readArchiveFile(filePath: string): Promise<ArchiveFiles> {
  return readArchive(await readFile(filePath));
}

export function readArchive(data: Uint8Array): ArchiveFiles {
  const unzipped = unzipSync(data);
  const files = new Map<string, Uint8Array>();
  for (const [name, bytes] of Object.entries(unzipped)) {
    if (name.replaceAll("\\", "/").endsWith("/")) continue;
    const normalized = normalizeZipPath(name);
    if (normalized && !normalized.endsWith("/")) files.set(normalized, bytes);
  }
  return files;
}

export async function writeArchiveFile(
  filePath: string,
  files: ArchiveFiles | Record<string, Uint8Array | string>,
  options?: WriteFileOptions
): Promise<void> {
  await writeFile(filePath, writeArchive(files), options);
}

export async function replaceArchiveFile(
  filePath: string,
  files: ArchiveFiles | Record<string, Uint8Array | string>
): Promise<void> {
  const directory = path.dirname(filePath);
  const basename = path.basename(filePath);
  const tempDir = await mkdtemp(path.join(directory, `.${basename}.tmp-`));
  const tempPath = path.join(tempDir, basename);
  try {
    await writeArchiveFile(tempPath, files, { flag: "wx" });
    await rename(tempPath, filePath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export function writeArchive(files: ArchiveFiles | Record<string, Uint8Array | string>): Uint8Array {
  const entries = files instanceof Map ? [...files.entries()] : Object.entries(files);
  const chunks: Uint8Array[] = [];
  const zip = new Zip((error, chunk) => {
    if (error) throw error;
    if (chunk) chunks.push(chunk);
  });
  const mtime = new Date(1980, 0, 1);
  const add = (name: string, value: Uint8Array | string, level: DeflateOptions["level"] = 9): void => {
    const normalized = normalizeZipPath(name);
    const data = toBytes(value);
    const file = level === 0 ? new ZipPassThrough(normalized) : new ZipDeflate(normalized, { level });
    file.mtime = mtime;
    zip.add(file);
    file.push(data, true);
  };

  const mimetype = entries.find(([name]) => normalizeZipPath(name) === "mimetype");
  add("mimetype", mimetype ? mimetype[1] : "application/epub+zip", 0);

  for (const [name, value] of entries.sort(([a], [b]) => normalizeZipPath(a).localeCompare(normalizeZipPath(b)))) {
    const normalized = normalizeZipPath(name);
    if (!normalized || normalized === "mimetype") continue;
    add(normalized, value);
  }

  zip.end();
  const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

export function readTextFile(files: ArchiveFiles, name: string): string {
  const data = files.get(normalizeZipPath(name));
  if (!data) throw new Error(`Missing file in EPUB archive: ${name}`);
  return fromBytes(data);
}

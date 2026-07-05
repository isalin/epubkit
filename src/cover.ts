import { extname, posix as pathPosix, resolve } from "node:path";
import { lstat, readFile, stat, writeFile } from "node:fs/promises";
import { replaceArchiveFile, writeArchiveFile } from "./archive.js";
import {
  EpubDocument,
  getManifestElement,
  getManifestItems,
  getMetadataElement,
  readEpub,
  saveOpfIntoArchive
} from "./epub.js";
import { CoverExtractOptions, CoverInfo, CoverWriteOptions } from "./types.js";
import { attr, descendants, localName, parseXml } from "./xml.js";
import { extMimeType, hrefFromZipPath, isImageMime, joinZip, relativeFromZip } from "./utils.js";

export function detectCover(epub: EpubDocument): CoverInfo | undefined {
  const manifest = getManifestItems(epub);
  const metadata = getMetadataElement(epub.opfDoc);
  const byId = new Map(manifest.map((item) => [item.id, item]));

  const candidates = [
    manifest.find((item) => (item.properties ?? "").split(/\s+/).includes("cover-image")),
    ...descendants(metadata, "meta")
      .filter((item) => item.getAttribute("name") === "cover")
      .map((item) => byId.get(item.getAttribute("content") || ""))
      .filter((item) => item && isImageMime(item.mediaType)),
    coverFromGuide(epub),
    manifest.find((item) => isImageMime(item.mediaType) && isCoverImageCandidate(item))
  ];

  for (const item of candidates) {
    if (!item) continue;
    const data = epub.files.get(item.path);
    if (data) return { path: item.path, id: item.id, mediaType: item.mediaType, data };
    const caseMatch = [...epub.files.keys()].find((name) => name.toLowerCase() === item.path.toLowerCase());
    if (caseMatch) return { path: caseMatch, id: item.id, mediaType: item.mediaType, data: epub.files.get(caseMatch)! };
  }
  return undefined;
}

export async function extractCover(epubPath: string, outputOrOptions?: string | CoverExtractOptions): Promise<string> {
  const options = typeof outputOrOptions === "string" ? { output: outputOrOptions } : outputOrOptions ?? {};
  const epub = await readEpub(epubPath);
  const cover = detectCover(epub);
  if (!cover) throw new Error("No cover image found");
  const ext = extname(cover.path) || ".bin";
  const target = options.output || `${epubPath.replace(/\.epub$/i, "")}-cover${ext}`;
  await assertCoverTargetDoesNotAliasSource(epubPath, target);
  await writeExtractedCover(target, cover.data, options.force);
  return target;
}

export async function setCover(epubPath: string, imagePath: string, options: CoverWriteOptions = {}): Promise<CoverInfo> {
  return writeCover(epubPath, imagePath, false, options);
}

export async function replaceCover(epubPath: string, imagePath: string, options: CoverWriteOptions = {}): Promise<CoverInfo> {
  return writeCover(epubPath, imagePath, true, options);
}

export async function repairCover(epubPath: string, options: CoverWriteOptions = {}): Promise<CoverInfo> {
  const epub = await readEpub(epubPath);
  const cover = detectCover(epub);
  if (!cover) throw new Error("No cover image found");
  const coverId = cover.id || uniqueManifestId(epub, "cover-image");
  markCover(epub, cover.path, coverId, cover.mediaType);
  saveOpfIntoArchive(epub);
  await writeOutput(epubPath, epub.files, options.output, options.force);
  return { ...cover, id: coverId };
}

async function writeCover(
  epubPath: string,
  imagePath: string,
  requireExisting: boolean,
  options: CoverWriteOptions
): Promise<CoverInfo> {
  const epub = await readEpub(epubPath);
  const existing = detectCover(epub);
  if (requireExisting && !existing) throw new Error("No existing cover image found");
  const data = await readFile(imagePath);
  const mediaType = extMimeType(imagePath);
  const targetPath = existing?.path || joinZip(epub.rootDir, "images", `cover${extname(imagePath) || ".bin"}`);
  const coverId = existing?.id || reusableManifestIdForPath(epub, targetPath) || uniqueManifestId(epub, "cover-image");
  epub.files.set(targetPath, data);
  markCover(epub, targetPath, coverId, mediaType);
  saveOpfIntoArchive(epub);
  await writeOutput(epubPath, epub.files, options.output, options.force);
  return { path: targetPath, id: coverId, mediaType, data };
}

function markCover(epub: EpubDocument, coverPath: string, id: string, mediaType: string): void {
  const manifest = getManifestElement(epub.opfDoc);
  const metadata = getMetadataElement(epub.opfDoc);
  const href = relativeHref(epub.rootDir, coverPath);
  const manifestItems = descendants(manifest, "item");
  let item =
    manifestItems.find((candidate) => candidate.getAttribute("id") === id) ||
    manifestItems.find((candidate) => candidate.getAttribute("href") === href);
  if (!item) {
    item = epub.opfDoc.createElement("item");
    manifest.appendChild(item);
  }
  item.setAttribute("id", id);
  item.setAttribute("href", href);
  item.setAttribute("media-type", mediaType);
  if (epub.version === "3") item.setAttribute("properties", mergeProperties(item.getAttribute("properties"), "cover-image"));
  for (const other of manifestItems) {
    if (other !== item) removeProperty(other, "cover-image");
  }

  for (const old of descendants(metadata, "meta").filter((candidate) => candidate.getAttribute("name") === "cover")) {
    metadata.removeChild(old);
  }
  const meta = epub.opfDoc.createElement("meta");
  meta.setAttribute("name", "cover");
  meta.setAttribute("content", id);
  metadata.appendChild(meta);
}

function reusableManifestIdForPath(epub: EpubDocument, filePath: string): string | undefined {
  return getManifestItems(epub).find((item) => item.path === filePath)?.id || undefined;
}

function mergeProperties(existing: string | null, value: string): string {
  const set = new Set((existing || "").split(/\s+/).filter(Boolean));
  set.add(value);
  return [...set].join(" ");
}

function removeProperty(element: Element, value: string): void {
  const properties = (element.getAttribute("properties") || "").split(/\s+/).filter((property) => property && property !== value);
  if (properties.length > 0) element.setAttribute("properties", properties.join(" "));
  else element.removeAttribute("properties");
}

function uniqueManifestId(epub: EpubDocument, base: string): string {
  const used = new Set(getManifestItems(epub).map((item) => item.id));
  if (!used.has(base)) return base;
  let i = 2;
  while (used.has(`${base}-${i}`)) i += 1;
  return `${base}-${i}`;
}

function isCoverImageCandidate(item: ReturnType<typeof getManifestItems>[number]): boolean {
  return hasCoverToken(item.id) || hasCoverToken(pathPosix.basename(item.href)) || hasCoverToken(pathPosix.basename(item.path));
}

function hasCoverToken(value: string): boolean {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .includes("cover");
}

function coverFromGuide(epub: EpubDocument): ReturnType<typeof getManifestItems>[number] | undefined {
  const guideCover = descendants(epub.opfDoc, "reference").find((item) => item.getAttribute("type") === "cover");
  const href = guideCover?.getAttribute("href");
  if (!href) return undefined;
  const manifest = getManifestItems(epub);
  const coverPage = relativeFromZip(epub.opfPath, href);
  const directImage = manifest.find((item) => item.path === coverPage && isImageMime(item.mediaType));
  if (directImage) return directImage;
  const pageData = epub.files.get(coverPage);
  if (!pageData) return undefined;
  try {
    const page = parseXml(new TextDecoder().decode(pageData), coverPage);
    const fragmentId = fragmentFromHref(href);
    const fragmentRoot = fragmentId ? elementById(page, fragmentId) : undefined;
    const img = imageIn(fragmentRoot) || imageIn(page);
    const src = attr(img, "src") || attr(img, "href");
    if (!src) return undefined;
    const imagePath = relativeFromZip(coverPage, src);
    return manifest.find((item) => item.path === imagePath);
  } catch {
    return undefined;
  }
}

function fragmentFromHref(href: string): string | undefined {
  const fragment = href.split("#", 2)[1];
  return fragment ? decodeURIComponent(fragment) : undefined;
}

function imageIn(node: Node | undefined): Element | undefined {
  if (!node) return undefined;
  if (node.nodeType === 1 && ["img", "image"].includes(localName(node))) return node as Element;
  return descendants(node, "img")[0] || descendants(node, "image")[0];
}

function elementById(node: Node, id: string): Element | undefined {
  for (let i = 0; i < node.childNodes.length; i += 1) {
    const child = node.childNodes.item(i);
    if (child.nodeType !== 1) continue;
    const element = child as Element;
    if (element.getAttribute("id") === id) return element;
    const nested = elementById(element, id);
    if (nested) return nested;
  }
  return undefined;
}

function relativeHref(rootDir: string, filePath: string): string {
  const href = rootDir ? pathPosix.relative(rootDir, filePath) : filePath;
  return hrefFromZipPath(href);
}

async function assertCoverTargetDoesNotAliasSource(epubPath: string, target: string): Promise<void> {
  if (resolve(target) === resolve(epubPath)) throw new Error("cover output cannot overwrite input EPUB");
  const sourceIdentity = fileIdentityKey(await stat(epubPath));
  const targetIdentity = await existingFileIdentity(target);
  if (targetIdentity && targetIdentity === sourceIdentity) throw new Error("cover output cannot overwrite input EPUB");
}

async function existingFileIdentity(filePath: string): Promise<string | undefined> {
  try {
    return fileIdentityKey(await stat(filePath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function assertNotSymbolicLink(filePath: string): Promise<void> {
  try {
    if ((await lstat(filePath)).isSymbolicLink()) throw new Error(`Refusing to write through symbolic link: ${filePath}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}

function fileIdentityKey(stats: Awaited<ReturnType<typeof stat>>): string {
  return `${stats.dev}:${stats.ino}`;
}

async function writeExtractedCover(target: string, data: Uint8Array, force?: boolean): Promise<void> {
  if (force) await assertNotSymbolicLink(target);
  try {
    await writeFile(target, data, force ? undefined : { flag: "wx" });
  } catch (error) {
    if (!force && (error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`Refusing to overwrite existing file: ${target}`);
    }
    throw error;
  }
}

async function writeOutput(sourcePath: string, files: EpubDocument["files"], output?: string, force?: boolean): Promise<void> {
  if (output && resolve(output) !== resolve(sourcePath)) {
    await assertCoverTargetDoesNotAliasSource(sourcePath, output);
    if (force) await assertNotSymbolicLink(output);
    try {
      await writeArchiveFile(output, files, force ? undefined : { flag: "wx" });
    } catch (error) {
      if (!force && (error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error(`Refusing to overwrite existing file: ${output}`);
      }
      throw error;
    }
    return;
  }
  await replaceArchiveFile(sourcePath, files);
}

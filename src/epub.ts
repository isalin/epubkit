/// <reference lib="dom" preserve="true" />

import { readFile } from "node:fs/promises";
import { ArchiveFiles, readArchive, readArchiveFile, readTextFile, writeArchiveFile } from "./archive.js";
import { detectCover } from "./cover.js";
import { readMetadataFromOpf } from "./metadata.js";
import { EpubInfo, EpubVersion, ManifestItem, SpineItem } from "./types.js";
import { attr, descendants, firstChildElement, firstDescendant, parseXml, serializeXml } from "./xml.js";
import { fromBytes, joinZip, relativeFromZip, zipDirname } from "./utils.js";

export interface EpubDocument {
  sourcePath?: string;
  files: ArchiveFiles;
  containerPath: string;
  opfPath: string;
  rootDir: string;
  opfDoc: Document;
  version: EpubVersion;
}

export async function readEpub(input: string | Uint8Array): Promise<EpubDocument> {
  const files = typeof input === "string" ? await readArchiveFile(input) : readArchive(input);
  const containerPath = "META-INF/container.xml";
  const containerXml = readTextFile(files, containerPath);
  const containerDoc = parseXml(containerXml, "container.xml");
  const rootfiles = descendants(containerDoc, "rootfile");
  const rootfile =
    rootfiles.find((element) => attr(element, "media-type") === "application/oebps-package+xml") ||
    rootfiles.find((element) => attr(element, "full-path"));
  const opfPath = attr(rootfile, "full-path");
  if (!opfPath) throw new Error("EPUB container does not declare an OPF rootfile");
  const opfXml = readTextFile(files, opfPath);
  const opfDoc = parseXml(opfXml, opfPath);
  const packageElement = getPackageElement(opfDoc);
  const versionAttr = packageElement.getAttribute("version") || "3.0";
  const version = versionAttr.startsWith("2") ? "2" : "3";
  return {
    sourcePath: typeof input === "string" ? input : undefined,
    files,
    containerPath,
    opfPath,
    rootDir: zipDirname(opfPath),
    opfDoc,
    version
  };
}

export async function writeEpubArchive(files: ArchiveFiles | Record<string, Uint8Array | string>, output: string): Promise<void> {
  await writeArchiveFile(output, files);
}

export function getPackageElement(doc: Document): Element {
  const packageElement = doc.documentElement;
  if (!packageElement || packageElement.nodeType !== 1 || packageElement.localName !== "package") {
    throw new Error("OPF document does not have a package root element");
  }
  return packageElement;
}

export function getMetadataElement(opfDoc: Document): Element {
  const metadata = firstChildElement(getPackageElement(opfDoc), "metadata");
  if (!metadata) throw new Error("OPF document is missing metadata");
  return metadata;
}

export function getManifestElement(opfDoc: Document): Element {
  const manifest = firstChildElement(getPackageElement(opfDoc), "manifest");
  if (!manifest) throw new Error("OPF document is missing manifest");
  return manifest;
}

export function getSpineElement(opfDoc: Document): Element {
  const spine = firstChildElement(getPackageElement(opfDoc), "spine");
  if (!spine) throw new Error("OPF document is missing spine");
  return spine;
}

export function getManifestItems(epub: EpubDocument): ManifestItem[] {
  return descendants(getManifestElement(epub.opfDoc), "item").map((item) => {
    const id = item.getAttribute("id") || "";
    const href = item.getAttribute("href") || "";
    const mediaType = item.getAttribute("media-type") || "application/octet-stream";
    const properties = item.getAttribute("properties") || undefined;
    return {
      id,
      href,
      mediaType,
      properties,
      fallback: item.getAttribute("fallback") || undefined,
      fallbackStyle: item.getAttribute("fallback-style") || undefined,
      mediaOverlay: item.getAttribute("media-overlay") || undefined,
      path: relativeFromZip(epub.opfPath, href)
    };
  });
}

export function getSpineItems(epub: EpubDocument): SpineItem[] {
  return descendants(getSpineElement(epub.opfDoc), "itemref").map((itemref) => ({
    idref: itemref.getAttribute("idref") || "",
    linear: itemref.getAttribute("linear") || undefined,
    properties: itemref.getAttribute("properties") || undefined
  }));
}

export function findManifestItem(epub: EpubDocument, predicate: (item: ManifestItem) => boolean): ManifestItem | undefined {
  return getManifestItems(epub).find(predicate);
}

export function findNavItem(epub: EpubDocument): ManifestItem | undefined {
  return findManifestItem(epub, (item) => (item.properties ?? "").split(/\s+/).includes("nav"));
}

export function findNcxItem(epub: EpubDocument): ManifestItem | undefined {
  const spine = getSpineElement(epub.opfDoc);
  const toc = spine.getAttribute("toc");
  if (toc) {
    const byId = findManifestItem(epub, (item) => item.id === toc);
    if (byId) return byId;
  }
  return findManifestItem(epub, (item) => item.mediaType === "application/x-dtbncx+xml" || item.href.endsWith(".ncx"));
}

export async function readInfo(filePath: string): Promise<EpubInfo> {
  const epub = await readEpub(filePath);
  const manifest = getManifestItems(epub);
  const spine = getSpineItems(epub);
  const metadata = readMetadataFromOpf(epub.opfDoc);
  const nav = findNavItem(epub);
  const ncx = findNcxItem(epub);
  const cover = detectCover(epub);
  const uniqueIdentifierId = getPackageElement(epub.opfDoc).getAttribute("unique-identifier");
  const uniqueIdentifier = uniqueIdentifierId
    ? descendants(getMetadataElement(epub.opfDoc), "identifier").find((item) => item.getAttribute("id") === uniqueIdentifierId)
        ?.textContent?.trim()
    : undefined;
  return {
    path: filePath,
    version: epub.version,
    opfPath: epub.opfPath,
    rootDir: epub.rootDir,
    fileCount: epub.files.size,
    manifestCount: manifest.length,
    spineCount: spine.length,
    navPath: nav?.path,
    ncxPath: ncx?.path,
    coverPath: cover?.path,
    uniqueIdentifier,
    metadata
  };
}

export async function readStandaloneOpf(filePath: string): Promise<Document> {
  return parseXml(await readFile(filePath, "utf8"), filePath);
}

export function saveOpfIntoArchive(epub: EpubDocument): void {
  epub.files.set(epub.opfPath, new TextEncoder().encode(serializeXml(epub.opfDoc)));
}

export function archiveText(epub: EpubDocument, filePath: string): string | undefined {
  const data = epub.files.get(joinZip(filePath));
  return data ? fromBytes(data) : undefined;
}

export function firstSpinePath(epub: EpubDocument): string | undefined {
  const manifest = getManifestItems(epub);
  const byId = new Map(manifest.map((item) => [item.id, item]));
  const first = getSpineItems(epub).find((item) => item.linear !== "no");
  return first ? byId.get(first.idref)?.path : undefined;
}

export function firstHeadingFromFile(epub: EpubDocument, filePath: string): string | undefined {
  const xml = archiveText(epub, filePath);
  if (!xml) return undefined;
  try {
    const doc = parseXml(xml, filePath);
    return firstDescendant(doc, "title")?.textContent?.trim() || firstDescendant(doc, "h1")?.textContent?.trim() || undefined;
  } catch {
    return undefined;
  }
}

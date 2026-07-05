import { lstat, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { ArchiveFiles, writeArchiveFile } from "./archive.js";
import { ENCRYPTION_XML, obfuscatedFontAlgorithm } from "./encryption.js";
import {
  EpubDocument,
  findNcxItem,
  findNavItem,
  firstHeadingFromFile,
  getManifestItems,
  getSpineElement,
  getSpineItems,
  readEpub
} from "./epub.js";
import { readMetadataFromOpf } from "./metadata.js";
import { EpubVersion, ManifestItem, MergeOptions, SpineItem, UnpackOptions } from "./types.js";
import {
  commonFilenamePrefix,
  ensureExt,
  filenameStem,
  fromBytes,
  hrefFromZipPath,
  joinZip,
  naturalCompare,
  sanitizeFilename,
  uuidUrn,
  xmlEscape
} from "./utils.js";
import { descendants, parseXml, serializeXml } from "./xml.js";

const RESTORE_MANIFEST = "META-INF/epubkit/manifest.json";
const LEGACY_RESTORE_MANIFEST = "EPUB/epubkit/manifest.json";
const ORIGINALS_DIR = "META-INF/epubkit/originals";

interface MergeComponent {
  index: number;
  source: string;
  filename: string;
  label: string;
  epub: EpubDocument;
  originalBytes: Uint8Array;
}

interface ChapterLink {
  label: string;
  href: string;
}

export async function mergeEpubs(inputFiles: string[], options: MergeOptions = {}): Promise<string> {
  if (inputFiles.length < 2) throw new Error("merge requires at least two EPUB files");
  const ordered = options.preserveOrder ? [...inputFiles] : [...inputFiles].sort(naturalCompare);
  const components: MergeComponent[] = [];
  for (let i = 0; i < ordered.length; i += 1) {
    const source = ordered[i]!;
    const epub = await readEpub(source);
    components.push({
      index: i + 1,
      source,
      filename: path.basename(source),
      label: volumeLabel(source, i, options),
      epub,
      originalBytes: await readFile(source)
    });
  }
  const version = components[0]!.epub.version;
  for (const component of components) {
    if (component.epub.version !== version) throw new Error("all EPUB files in a merge must use the same EPUB version");
  }

  const title = options.title || commonFilenamePrefix(ordered);
  const output = resolveMergeOutput(ordered, title, options);
  const inputPaths = new Set(ordered.map((file) => path.resolve(file)));
  const inputIdentities = new Set<string>();
  for (const file of ordered) inputPaths.add(await realpath(file));
  for (const file of ordered) inputIdentities.add(fileIdentityKey(await stat(file)));
  const outputRealPath = await existingRealPath(output);
  const outputIdentity = await existingFileIdentity(output);
  if (
    inputPaths.has(path.resolve(output)) ||
    (outputRealPath && inputPaths.has(outputRealPath)) ||
    (outputIdentity && inputIdentities.has(outputIdentity))
  ) {
    throw new Error("merge output cannot overwrite an input file");
  }
  const files = buildMergedArchive(components, version, title, options.language);
  if (options.force) await assertNotSymbolicLink(output);
  try {
    await writeArchiveFile(output, files, options.force ? undefined : { flag: "wx" });
  } catch (error) {
    if (!options.force && (error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`Refusing to overwrite existing file: ${output}`);
    }
    throw error;
  }
  return output;
}

async function existingRealPath(filePath: string): Promise<string | undefined> {
  try {
    return await realpath(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
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

export async function unpackMergedEpub(mergedPath: string, options: UnpackOptions = {}): Promise<string[]> {
  const epub = await readEpub(mergedPath);
  const manifestData = epub.files.get(RESTORE_MANIFEST) ?? epub.files.get(LEGACY_RESTORE_MANIFEST);
  if (!manifestData) throw new Error("EPUB does not contain epubkit restore data");
  const restore = JSON.parse(fromBytes(manifestData)) as { originals: Array<{ fileName: string; archivePath: string }> };
  const outputDir = options.outputDir || path.dirname(mergedPath);
  const sourcePath = path.resolve(mergedPath);
  const sourceRealPath = await realpath(mergedPath);
  const sourceIdentity = fileIdentityKey(await stat(mergedPath));
  await mkdir(outputDir, { recursive: true });
  const written: string[] = [];
  const targetNames = uniqueRestoreFileNames(restore.originals.map((original) => original.fileName));
  for (let i = 0; i < restore.originals.length; i += 1) {
    const original = restore.originals[i]!;
    const data = epub.files.get(original.archivePath);
    if (!data) throw new Error(`Missing restore payload: ${original.archivePath}`);
    const target = path.join(outputDir, targetNames[i]!);
    await assertUnpackTargetDoesNotAliasSource(target, sourcePath, sourceRealPath, sourceIdentity);
    if (options.force) {
      await assertNotSymbolicLink(target);
      await writeFile(target, data);
    } else {
      try {
        await writeFile(target, data, { flag: "wx" });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          throw new Error(`Refusing to overwrite existing file: ${target}`);
        }
        throw error;
      }
    }
    written.push(target);
  }
  return written;
}

async function assertUnpackTargetDoesNotAliasSource(
  target: string,
  sourcePath: string,
  sourceRealPath: string,
  sourceIdentity: string
): Promise<void> {
  if (path.resolve(target) === sourcePath) throw new Error("unpack output cannot overwrite input EPUB");
  const targetRealPath = await existingRealPath(target);
  if (targetRealPath && targetRealPath === sourceRealPath) throw new Error("unpack output cannot overwrite input EPUB");
  const targetIdentity = await existingFileIdentity(target);
  if (targetIdentity && targetIdentity === sourceIdentity) throw new Error("unpack output cannot overwrite input EPUB");
}

function buildMergedArchive(
  components: MergeComponent[],
  version: EpubVersion,
  title: string,
  language?: string
): ArchiveFiles {
  const files: ArchiveFiles = new Map();
  files.set("mimetype", new TextEncoder().encode("application/epub+zip"));
  files.set(
    "META-INF/container.xml",
    new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`)
  );

  const manifestItems: string[] = [];
  const spineItems: string[] = [];
  const chaptersByVolume: Array<{ label: string; chapters: ChapterLink[] }> = [];
  const usedIds = new Set<string>();
  const encryptionDocs: Document[] = [];
  const uniqueIdentifier = uuidUrn();

  for (const component of components) {
    const base = `EPUB/volumes/${String(component.index).padStart(3, "0")}`;
    const nav = findNavItem(component.epub);
    const ncx = findNcxItem(component.epub);
    for (const [filePath, data] of component.epub.files) {
      if (filePath === "mimetype" || filePath.startsWith("META-INF/") || filePath === component.epub.opfPath || filePath === ncx?.path) {
        continue;
      }
      files.set(joinZip(base, filePath), data);
    }
    const encryption = component.epub.files.get(ENCRYPTION_XML);
    if (encryption) encryptionDocs.push(rewriteEncryptionXml(encryption, base, component.filename));

    const sourceSpine = getSpineItems(component.epub);
    const manifest = getManifestItems(component.epub).filter((item) => item.path !== ncx?.path);
    const byId = new Map(manifest.map((item) => [item.id, item]));
    const idMap = new Map<string, string>();
    const itemIds = new Map<ManifestItem, string>();
    for (const item of manifest) {
      const id = uniqueId(`v${component.index}_${item.id || path.basename(item.href).replace(/\W+/g, "_")}`, usedIds);
      itemIds.set(item, id);
      if (item.id) idMap.set(item.id, id);
    }
    for (const item of manifest) {
      const id = itemIds.get(item)!;
      const href = hrefFromZipPath(joinZip("volumes", String(component.index).padStart(3, "0"), item.path));
      const itemProperties = stripManifestProperties(item.properties, item.path === nav?.path ? ["cover-image", "nav"] : ["cover-image"]);
      const properties = itemProperties ? ` properties="${xmlEscape(itemProperties)}"` : "";
      const idrefAttributes = remappedManifestIdrefAttributes(item, idMap);
      manifestItems.push(
        `<item id="${xmlEscape(id)}" href="${xmlEscape(href)}" media-type="${xmlEscape(item.mediaType)}"${properties}${idrefAttributes}/>`
      );
    }
    const chapters: ChapterLink[] = [];
    for (const spine of sourceSpine) {
      const item = byId.get(spine.idref);
      if (!item) continue;
      const idref = idMap.get(item.id);
      if (!idref) continue;
      const linear = spine.linear ? ` linear="${xmlEscape(spine.linear)}"` : "";
      const properties = spineItemProperties(spine);
      spineItems.push(`<itemref idref="${xmlEscape(idref)}"${linear}${properties}/>`);
      if (spine.linear !== "no") {
        chapters.push({
          href: hrefFromZipPath(joinZip("volumes", String(component.index).padStart(3, "0"), item.path)),
          label: firstHeadingFromFile(component.epub, item.path) || path.basename(item.href)
        });
      }
    }
    chaptersByVolume.push({ label: component.label, chapters });
    const archivePath = joinZip(ORIGINALS_DIR, `${String(component.index).padStart(3, "0")}-${sanitizeFilename(component.filename)}`);
    files.set(archivePath, component.originalBytes);
  }

  const firstLanguage = language || components.map((component) => readMetadataFromOpf(component.epub.opfDoc).language).find(Boolean) || "en";
  if (encryptionDocs.length > 0) {
    files.set(ENCRYPTION_XML, new TextEncoder().encode(buildMergedEncryptionXml(encryptionDocs)));
  }
  if (version === "3") {
    const navMarkup = buildNav(title, firstLanguage, chaptersByVolume);
    files.set("EPUB/nav.xhtml", new TextEncoder().encode(navMarkup));
    manifestItems.push(`<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`);
  } else {
    const ncxMarkup = buildNcx(title, uniqueIdentifier, chaptersByVolume);
    files.set("EPUB/toc.ncx", new TextEncoder().encode(ncxMarkup));
    manifestItems.push(`<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`);
  }

  const pageProgressionDirection = commonPageProgressionDirection(components);
  const opf = buildPackageOpf(version, title, firstLanguage, uniqueIdentifier, manifestItems, spineItems, pageProgressionDirection);
  files.set("EPUB/package.opf", new TextEncoder().encode(opf));
  files.set(
    RESTORE_MANIFEST,
    new TextEncoder().encode(
      JSON.stringify(
        {
          tool: "epubkit",
          version: 1,
          originals: components.map((component) => ({
            fileName: component.filename,
            archivePath: joinZip(ORIGINALS_DIR, `${String(component.index).padStart(3, "0")}-${sanitizeFilename(component.filename)}`)
          }))
        },
        null,
        2
      )
    )
  );
  return files;
}

function commonPageProgressionDirection(components: MergeComponent[]): string | undefined {
  const directions = components.map((component) => getSpineElement(component.epub.opfDoc).getAttribute("page-progression-direction")?.trim());
  const first = directions[0];
  if (!first || directions.some((direction) => !direction)) return undefined;
  return directions.every((direction) => direction === first) ? first : undefined;
}

function buildPackageOpf(
  version: EpubVersion,
  title: string,
  language: string,
  uniqueId: string,
  manifestItems: string[],
  spineItems: string[],
  pageProgressionDirection?: string
): string {
  const modified = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const spineToc = version === "2" ? ' toc="ncx"' : "";
  const spineDirection = pageProgressionDirection ? ` page-progression-direction="${xmlEscape(pageProgressionDirection)}"` : "";
  const modifiedMeta = version === "3" ? `    <meta property="dcterms:modified">${modified}</meta>\n` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="${version}.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:identifier id="book-id">${xmlEscape(uniqueId)}</dc:identifier>
    <dc:title>${xmlEscape(title)}</dc:title>
    <dc:language>${xmlEscape(language)}</dc:language>
${modifiedMeta}  </metadata>
  <manifest>
    ${manifestItems.join("\n    ")}
  </manifest>
  <spine${spineToc}${spineDirection}>
    ${spineItems.join("\n    ")}
  </spine>
</package>`;
}

function buildNav(title: string, language: string, volumes: Array<{ label: string; chapters: ChapterLink[] }>): string {
  const volumeItems = volumes
    .map(
      (volume) => `<li><span>${xmlEscape(volume.label)}</span><ol>${volume.chapters
        .map((chapter) => `<li><a href="${xmlEscape(chapter.href)}">${xmlEscape(chapter.label)}</a></li>`)
        .join("")}</ol></li>`
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${xmlEscape(language)}">
  <head><title>${xmlEscape(title)}</title></head>
  <body>
    <nav epub:type="toc" id="toc">
      <h1>${xmlEscape(title)}</h1>
      <ol>${volumeItems}</ol>
    </nav>
  </body>
</html>`;
}

function buildNcx(title: string, uniqueId: string, volumes: Array<{ label: string; chapters: ChapterLink[] }>): string {
  let playOrder = 1;
  const depth = volumes.some((volume) => volume.chapters.length > 0) ? 2 : 1;
  const navPoints = volumes
    .map((volume, volumeIndex) => {
      const order = playOrder++;
      const childPoints = volume.chapters
        .map((chapter, chapterIndex) => {
          const order = playOrder++;
          return `<navPoint id="nav-${volumeIndex + 1}-${chapterIndex + 1}" playOrder="${order}"><navLabel><text>${xmlEscape(
            chapter.label
          )}</text></navLabel><content src="${xmlEscape(chapter.href)}"/></navPoint>`;
        })
        .join("");
      const firstHref = volume.chapters[0]?.href || "";
      return `<navPoint id="volume-${volumeIndex + 1}" playOrder="${order}"><navLabel><text>${xmlEscape(
        volume.label
      )}</text></navLabel><content src="${xmlEscape(firstHref)}"/>${childPoints}</navPoint>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${xmlEscape(uniqueId)}"/>
    <meta name="dtb:depth" content="${depth}"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${xmlEscape(title)}</text></docTitle>
  <navMap>${navPoints}</navMap>
</ncx>`;
}

function rewriteEncryptionXml(data: Uint8Array, volumeBase: string, label: string): Document {
  const doc = parseXml(fromBytes(data), `${label} encryption.xml`);
  const obfuscationAlgorithm = obfuscatedFontAlgorithm(doc);
  if (obfuscationAlgorithm) {
    throw new Error(
      `Cannot merge EPUBs with obfuscated fonts because the merged package identifier would change the de-obfuscation key (${label}: ${obfuscationAlgorithm})`
    );
  }
  for (const reference of descendants(doc, "CipherReference")) {
    const uri = reference.getAttribute("URI");
    if (uri) reference.setAttribute("URI", rewriteEncryptionUri(uri, volumeBase));
  }
  return doc;
}

function rewriteEncryptionUri(uri: string, volumeBase: string): string {
  const fragmentIndex = uri.indexOf("#");
  const pathPart = fragmentIndex >= 0 ? uri.slice(0, fragmentIndex) : uri;
  const fragment = fragmentIndex >= 0 ? uri.slice(fragmentIndex) : "";
  if (!pathPart) return uri;
  return `${hrefFromZipPath(joinZip(volumeBase, decodeURIComponent(pathPart)))}${fragment}`;
}

function buildMergedEncryptionXml(docs: Document[]): string {
  const merged = parseXml(
    `<?xml version="1.0" encoding="UTF-8"?><encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"/>`,
    "merged encryption.xml"
  );
  for (const doc of docs) {
    for (const encryptedData of descendants(doc, "EncryptedData")) {
      merged.documentElement.appendChild(merged.importNode(encryptedData, true));
    }
  }
  return serializeXml(merged);
}

function volumeLabel(source: string, index: number, options: MergeOptions): string {
  if (options.volumeLabels?.[index]) return options.volumeLabels[index]!;
  if (options.volumeLabelsFromFiles) return filenameStem(source);
  return `${options.volumePrefix ?? "Volume "}${index + 1}${options.volumeSuffix ?? ""}`;
}

function resolveMergeOutput(inputs: string[], title: string, options: MergeOptions): string {
  if (options.output) return options.output;
  const stem = sanitizeFilename(title || commonFilenamePrefix(inputs));
  return ensureExt(stem, ".epub");
}

function uniqueId(base: string, used: Set<string>): string {
  const clean = base.replace(/[^A-Za-z0-9_-]/g, "_") || "item";
  let candidate = clean;
  let i = 2;
  while (used.has(candidate)) {
    candidate = `${clean}_${i}`;
    i += 1;
  }
  used.add(candidate);
  return candidate;
}

function stripManifestProperties(properties: string | undefined, removed: string[]): string | undefined {
  const removedSet = new Set(removed);
  const tokens = properties?.split(/\s+/).filter((token) => token && !removedSet.has(token)) ?? [];
  return tokens.length > 0 ? tokens.join(" ") : undefined;
}

function remappedManifestIdrefAttributes(item: ManifestItem, idMap: Map<string, string>): string {
  const attributes: Array<[string, string | undefined]> = [
    ["fallback", item.fallback],
    ["fallback-style", item.fallbackStyle],
    ["media-overlay", item.mediaOverlay]
  ];
  return attributes
    .map(([name, sourceId]) => {
      if (!sourceId) return "";
      const mapped = idMap.get(sourceId);
      return mapped ? ` ${name}="${xmlEscape(mapped)}"` : "";
    })
    .join("");
}

function spineItemProperties(spine: SpineItem): string {
  return spine.properties ? ` properties="${xmlEscape(spine.properties)}"` : "";
}

function uniqueRestoreFileNames(fileNames: string[]): string[] {
  const used = new Set<string>();
  return fileNames.map((fileName) => {
    const sanitized = sanitizeFilename(fileName);
    const unique = uniqueRestoreFileName(sanitized, used);
    used.add(restoreNameKey(unique));
    return unique;
  });
}

function uniqueRestoreFileName(fileName: string, used: Set<string>): string {
  if (!used.has(restoreNameKey(fileName))) return fileName;
  const ext = path.extname(fileName);
  const stem = ext ? fileName.slice(0, -ext.length) : fileName;
  let i = 2;
  while (used.has(restoreNameKey(`${stem} (${i})${ext}`))) i += 1;
  return `${stem} (${i})${ext}`;
}

function restoreNameKey(fileName: string): string {
  return fileName.toLowerCase();
}

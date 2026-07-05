/// <reference lib="dom" preserve="true" />

import { readFile, writeFile } from "node:fs/promises";
import { replaceArchiveFile } from "./archive.js";
import { ENCRYPTION_XML, obfuscatedFontAlgorithmFromXml } from "./encryption.js";
import { EpubDocument, readEpub, readStandaloneOpf, saveOpfIntoArchive } from "./epub.js";
import { Contributor, EpubMetadata, MetadataPatch } from "./types.js";
import { uuidUrn } from "./utils.js";
import {
  NS,
  appendTextElement,
  attr,
  cdataText,
  childElements,
  descendants,
  firstChildElement,
  parseXml,
  removeChildrenWhere,
  serializeXml,
  setTextPreservingCdata
} from "./xml.js";

function emptyMetadata(): EpubMetadata {
  return {
    authors: [],
    translators: [],
    subjects: []
  };
}

export async function readMetadata(sourcePath: string): Promise<EpubMetadata> {
  if (sourcePath.toLowerCase().endsWith(".opf")) {
    return readMetadataFromOpf(await readStandaloneOpf(sourcePath));
  }
  const epub = await readEpub(sourcePath);
  return readMetadataFromOpf(epub.opfDoc);
}

export function readMetadataFromOpf(opfDoc: Document): EpubMetadata {
  const metadata = metadataElement(opfDoc);
  const result = emptyMetadata();
  const rolesById = refinedRoles(metadata);
  const fileAsById = refinedValues(metadata, "file-as");
  for (const child of childElements(metadata, "title")) {
    result.title ??= child.textContent?.trim() || undefined;
  }
  for (const child of childElements(metadata, "creator")) {
    const role = contributorRole(child, rolesById);
    const contributor = contributorFromElement(child, fileAsById);
    if (!contributor.name) continue;
    if (!role || role === "aut" || role === "author") result.authors.push(contributor);
  }
  for (const child of [...childElements(metadata, "contributor"), ...childElements(metadata, "creator")]) {
    const role = contributorRole(child, rolesById);
    if (role !== "trl" && role !== "translator") continue;
    const contributor = contributorFromElement(child, fileAsById);
    if (contributor.name) result.translators.push(contributor);
  }
  for (const child of childElements(metadata, "subject")) {
    const value = child.textContent?.trim();
    if (value) result.subjects.push(value);
  }
  result.description = cdataText(childElements(metadata, "description")[0]);
  result.publisher = textOf(metadata, "publisher");
  result.language = textOf(metadata, "language");
  result.rights = textOf(metadata, "rights");
  for (const child of childElements(metadata, "date")) {
    const event = (attr(child, "event") || "").toLowerCase();
    const value = child.textContent?.trim();
    if (!value) continue;
    if (!event || event === "publication" || event === "published") result.published ??= value;
    else if (event === "modification" || event === "modified") result.modified ??= value;
    else if (event === "creation" || event === "created") result.created ??= value;
    else result.created ??= value;
  }
  for (const child of childElements(metadata, "meta")) {
    if (child.getAttribute("property") === "dcterms:modified") {
      result.modified = child.textContent?.trim() || result.modified;
    }
  }
  for (const child of childElements(metadata, "identifier")) {
    const scheme = (attr(child, "scheme") || "").toLowerCase();
    const value = child.textContent?.trim();
    if (!value) continue;
    const isbn = isbnFromIdentifierText(value);
    if (scheme.includes("isbn") || isbn) {
      result.isbn = isbn ?? value;
      break;
    }
  }
  return result;
}

export async function updateMetadata(sourcePath: string, patch: MetadataPatch): Promise<EpubMetadata> {
  if (sourcePath.toLowerCase().endsWith(".opf")) {
    const doc = parseXml(await readFile(sourcePath, "utf8"), sourcePath);
    applyMetadataPatch(doc, patch);
    await writeFile(sourcePath, serializeXml(doc));
    return readMetadataFromOpf(doc);
  }

  const epub = await readEpub(sourcePath);
  assertIsbnPatchSafeForObfuscatedFonts(epub, patch);
  applyMetadataPatch(epub.opfDoc, patch);
  saveOpfIntoArchive(epub);
  await replaceArchiveFile(sourcePath, epub.files);
  return readMetadataFromOpf(epub.opfDoc);
}

export function applyMetadataPatch(opfDoc: Document, patch: MetadataPatch): void {
  const metadata = metadataElement(opfDoc);
  if (hasDefinedPatchValue(patch, "title")) replaceSingleDc(opfDoc, metadata, "title", patch.title);
  if (hasDefinedPatchValue(patch, "publisher")) replaceSingleDc(opfDoc, metadata, "publisher", patch.publisher);
  if (hasDefinedPatchValue(patch, "language")) replaceSingleDc(opfDoc, metadata, "language", patch.language);
  if (hasDefinedPatchValue(patch, "rights")) replaceSingleDc(opfDoc, metadata, "rights", patch.rights);
  if (hasDefinedPatchValue(patch, "description")) replaceDescription(opfDoc, metadata, patch.description);
  if (hasDefinedPatchValue(patch, "subjects")) replaceSubjects(opfDoc, metadata, patch.subjects);
  if (hasDefinedPatchValue(patch, "authors")) replaceContributors(opfDoc, metadata, "creator", "aut", patch.authors);
  if (hasDefinedPatchValue(patch, "translators")) replaceContributors(opfDoc, metadata, "contributor", "trl", patch.translators);
  if (hasDefinedPatchValue(patch, "published")) replaceDate(opfDoc, metadata, "publication", patch.published);
  if (hasDefinedPatchValue(patch, "modified")) replaceModified(opfDoc, metadata, patch.modified);
  if (hasDefinedPatchValue(patch, "isbn")) replaceIsbn(opfDoc, metadata, patch.isbn);
}

function metadataElement(opfDoc: Document): Element {
  const metadata = firstChildElement(opfDoc.documentElement, "metadata");
  if (!metadata) throw new Error("OPF document is missing metadata");
  return metadata;
}

function hasDefinedPatchValue<K extends keyof MetadataPatch>(patch: MetadataPatch, key: K): boolean {
  return Object.hasOwn(patch, key) && patch[key] !== undefined;
}

function assertIsbnPatchSafeForObfuscatedFonts(epub: EpubDocument, patch: MetadataPatch): void {
  if (!hasDefinedPatchValue(patch, "isbn")) return;
  if (!isbnPatchChangesUniqueIdentifier(epub.opfDoc, patch.isbn)) return;
  const encryption = epub.files.get(ENCRYPTION_XML);
  if (!encryption) return;
  const algorithm = obfuscatedFontAlgorithmFromXml(encryption, ENCRYPTION_XML);
  if (!algorithm) return;
  throw new Error(
    `Cannot update ISBN metadata for EPUBs with obfuscated fonts because the package identifier is the de-obfuscation key (${algorithm})`
  );
}

function isbnPatchChangesUniqueIdentifier(opfDoc: Document, value: string | null | undefined): boolean {
  if (value === undefined) return false;
  const uniqueIdentifierId = opfDoc.documentElement.getAttribute("unique-identifier");
  if (!uniqueIdentifierId) return false;
  const identifier = childElements(metadataElement(opfDoc), "identifier").find((element) => element.getAttribute("id") === uniqueIdentifierId);
  if (!identifier || !isIsbnIdentifier(identifier)) return false;
  if (value == null || value === "") return true;
  return (identifier.textContent ?? "") !== value;
}

function textOf(metadata: Element, name: string): string | undefined {
  const value = childElements(metadata, name)[0]?.textContent?.trim();
  return value || undefined;
}

function contributorFromElement(element: Element, fileAsById: Map<string, string>): Contributor {
  const name = element.textContent?.trim() || "";
  const directFileAs = attr(element, "file-as");
  const id = element.getAttribute("id");
  const fileAs = directFileAs || (id ? fileAsById.get(id) : undefined);
  return fileAs ? { name, fileAs } : { name };
}

function refinedRoles(metadata: Element): Map<string, string> {
  return refinedValues(metadata, "role");
}

function refinedValues(metadata: Element, property: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const meta of childElements(metadata, "meta")) {
    if (meta.getAttribute("property") !== property) continue;
    const refines = meta.getAttribute("refines");
    const value = meta.textContent?.trim();
    if (!refines?.startsWith("#") || !value) continue;
    values.set(refines.slice(1), property === "role" ? value.toLowerCase() : value);
  }
  return values;
}

function contributorRole(element: Element, rolesById: Map<string, string>): string {
  const direct = attr(element, "role");
  if (direct) return direct.toLowerCase();
  const id = element.getAttribute("id");
  return id ? rolesById.get(id) ?? "" : "";
}

function removeDc(metadata: Element, name: string): void {
  removeMetadataChildrenWhere(metadata, (element) => element.localName === name);
}

function removeMetadataChildrenWhere(metadata: Element, predicate: (element: Element) => boolean): void {
  const removedIds = new Set<string>();
  removeChildrenWhere(metadata, (element) => {
    const shouldRemove = predicate(element);
    const id = element.getAttribute("id");
    if (shouldRemove && id) removedIds.add(id);
    return shouldRemove;
  });
  removeRefinements(metadata, removedIds);
}

function replaceSingleDc(opfDoc: Document, metadata: Element, name: string, value: string | null | undefined): void {
  removeDc(metadata, name);
  if (value == null || value === "") return;
  appendTextElement(opfDoc, metadata, `dc:${name}`, value, NS.dc);
}

function replaceDescription(opfDoc: Document, metadata: Element, value: string | null | undefined): void {
  const existing = childElements(metadata, "description")[0];
  removeMetadataChildrenWhere(metadata, (element) => element.localName === "description" && element !== existing);
  if (value == null || value === "") {
    if (existing) removeMetadataChildrenWhere(metadata, (element) => element === existing);
    return;
  }
  if (existing) setTextPreservingCdata(existing, value);
  else appendTextElement(opfDoc, metadata, "dc:description", value, NS.dc);
}

function replaceSubjects(opfDoc: Document, metadata: Element, values: string[] | null | undefined): void {
  removeDc(metadata, "subject");
  for (const value of values ?? []) {
    if (value) appendTextElement(opfDoc, metadata, "dc:subject", value, NS.dc);
  }
}

function replaceContributors(
  opfDoc: Document,
  metadata: Element,
  elementName: "creator" | "contributor",
  role: "aut" | "trl",
  values: Contributor[] | null | undefined
): void {
  const rolesById = refinedRoles(metadata);
  removeMetadataChildrenWhere(metadata, (element) => shouldRemoveContributor(element, elementName, role, rolesById));
  for (const contributor of values ?? []) {
    if (!contributor.name) continue;
    const element = appendTextElement(opfDoc, metadata, `dc:${elementName}`, contributor.name, NS.dc);
    element.setAttributeNS(NS.opf, "opf:role", role);
    if (contributor.fileAs) element.setAttributeNS(NS.opf, "opf:file-as", contributor.fileAs);
  }
}

function shouldRemoveContributor(
  element: Element,
  elementName: "creator" | "contributor",
  role: "aut" | "trl",
  rolesById: Map<string, string>
): boolean {
  const existingRole = contributorRole(element, rolesById);
  if (role === "trl") {
    return (element.localName === "creator" || element.localName === "contributor") && (existingRole === "trl" || existingRole === "translator");
  }
  if (element.localName !== elementName) return false;
  return !existingRole || existingRole === "aut" || existingRole === "author";
}

function removeRefinements(metadata: Element, metadataIds: Set<string>): void {
  if (metadataIds.size === 0) return;
  removeChildrenWhere(metadata, (element) => {
    if (element.localName !== "meta") return false;
    const refines = element.getAttribute("refines");
    return !!refines?.startsWith("#") && metadataIds.has(refines.slice(1));
  });
}

function replaceDate(opfDoc: Document, metadata: Element, event: string, value: string | null | undefined): void {
  const eventAliases = event === "publication" ? ["", "publication", "published"] : [event];
  removeMetadataChildrenWhere(
    metadata,
    (element) => element.localName === "date" && eventAliases.includes((attr(element, "event") || "").toLowerCase())
  );
  if (value == null || value === "") return;
  const element = appendTextElement(opfDoc, metadata, "dc:date", value, NS.dc);
  element.setAttributeNS(NS.opf, "opf:event", event);
}

function replaceModified(opfDoc: Document, metadata: Element, value: string | null | undefined): void {
  removeMetadataChildrenWhere(
    metadata,
    (element) =>
      (element.localName === "meta" && element.getAttribute("property") === "dcterms:modified") ||
      (element.localName === "date" && ["modification", "modified"].includes((attr(element, "event") || "").toLowerCase()))
  );
  if (value == null || value === "") return;
  if ((opfDoc.documentElement.getAttribute("version") || "").startsWith("2")) {
    const date = appendTextElement(opfDoc, metadata, "dc:date", value, NS.dc);
    date.setAttributeNS(NS.opf, "opf:event", "modification");
    return;
  }
  const meta = opfDoc.createElement("meta");
  meta.setAttribute("property", "dcterms:modified");
  meta.appendChild(opfDoc.createTextNode(value));
  metadata.appendChild(meta);
}

function replaceIsbn(opfDoc: Document, metadata: Element, value: string | null | undefined): void {
  const uniqueIdentifierId = opfDoc.documentElement.getAttribute("unique-identifier") || "";
  let identifierId = "epubkit-isbn";
  let removedUniqueIdentifier = false;
  removeMetadataChildrenWhere(metadata, (element) => {
    const isIsbn = isIsbnIdentifier(element);
    if (isIsbn && uniqueIdentifierId && element.getAttribute("id") === uniqueIdentifierId) {
      removedUniqueIdentifier = true;
      if (value != null && value !== "") identifierId = uniqueIdentifierId;
    }
    return isIsbn;
  });
  if (value == null || value === "") {
    if (removedUniqueIdentifier) {
      const identifier = appendTextElement(opfDoc, metadata, "dc:identifier", uuidUrn(), NS.dc);
      identifier.setAttribute("id", uniqueIdentifierId);
    }
    return;
  }
  if (identifierId === "epubkit-isbn") identifierId = uniqueDocumentId(opfDoc, identifierId);
  const identifier = appendTextElement(opfDoc, metadata, "dc:identifier", value, NS.dc);
  identifier.setAttribute("id", identifierId);
  identifier.setAttributeNS(NS.opf, "opf:scheme", "ISBN");
}

function uniqueDocumentId(opfDoc: Document, base: string): string {
  const used = new Set<string>();
  collectElementIds(opfDoc.documentElement, used);
  if (!used.has(base)) return base;
  let i = 2;
  while (used.has(`${base}-${i}`)) i += 1;
  return `${base}-${i}`;
}

function collectElementIds(node: Node, used: Set<string>): void {
  if (node.nodeType === 1) {
    const id = (node as Element).getAttribute("id");
    if (id) used.add(id);
  }
  if (!node.childNodes) return;
  for (let i = 0; i < node.childNodes.length; i += 1) {
    collectElementIds(node.childNodes.item(i), used);
  }
}

function isIsbnIdentifier(element: Element): boolean {
  if (element.localName !== "identifier") return false;
  const scheme = (attr(element, "scheme") || "").toLowerCase();
  const text = element.textContent?.trim() ?? "";
  return scheme.includes("isbn") || identifierTextLooksLikeIsbn(text);
}

function identifierTextLooksLikeIsbn(value: string): boolean {
  return isbnFromIdentifierText(value) !== undefined;
}

function isbnFromIdentifierText(value: string): string | undefined {
  const isbnPrefix = value.match(/^ISBN(?::\s*|\s+)(.+)$/i);
  if (isbnPrefix?.[1]) return isbnPrefix[1].trim();
  const urnPrefix = value.match(/^urn:isbn:(.+)$/i);
  if (urnPrefix?.[1]) return urnPrefix[1].trim();
  const normalized = value.replace(/[-\s]/g, "");
  return isValidIsbn10(normalized) || isValidIsbn13(normalized) ? value : undefined;
}

function isValidIsbn10(value: string): boolean {
  if (!/^[0-9]{9}[0-9Xx]$/.test(value)) return false;
  const sum = [...value].reduce((total, char, index) => {
    const digit = char.toLowerCase() === "x" ? 10 : Number(char);
    return total + digit * (10 - index);
  }, 0);
  return sum % 11 === 0;
}

function isValidIsbn13(value: string): boolean {
  if (!/^97[89][0-9]{10}$/.test(value)) return false;
  const digits = [...value].map(Number);
  const sum = digits.slice(0, 12).reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10 === digits[12];
}

export function changedMetadataFields(patch: MetadataPatch): string[] {
  return Object.keys(patch).sort();
}

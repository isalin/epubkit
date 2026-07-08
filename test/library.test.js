import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { link, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { unzipSync, zipSync } from "fflate";
import {
  detectCover,
  extractCover,
  mergeEpubs,
  readArchive,
  readEpub,
  readInfo,
  readMetadata,
  replaceCover,
  setCover,
  unpackMergedEpub,
  updateMetadata,
  writeArchive,
  writeEpubArchive
} from "../dist/index.js";
import { commonFilenamePrefix } from "../dist/utils.js";
import { createEpub2, createEpub3, tempDir, tinyPng } from "./helpers.js";

const exec = promisify(execFile);

test("reads metadata and structural EPUB info", async () => {
  const dir = await tempDir();
  const book = path.join(dir, "alpha.epub");
  await createEpub3(book, { title: "Alpha", author: "Ada Lovelace", heading: "Opening" });

  const metadata = await readMetadata(book);
  assert.equal(metadata.title, "Alpha");
  assert.equal(metadata.authors[0].name, "Ada Lovelace");
  assert.equal(metadata.authors[0].fileAs, "Lovelace, Ada");
  assert.equal(metadata.subjects[0], "Fiction");
  assert.equal(metadata.description, "Line one\nLine two");
  assert.equal(metadata.isbn, "9781234567890");

  const info = await readInfo(book);
  assert.equal(info.version, "3");
  assert.equal(info.opfPath, "OEBPS/package.opf");
  assert.equal(info.manifestCount, 4);
  assert.equal(info.spineCount, 1);
  assert.equal(info.navPath, "OEBPS/nav.xhtml");
  assert.equal(info.coverPath, "OEBPS/images/cover.png");
});

test("selects OPF rootfile before generic container entries", async () => {
  const dir = await tempDir();
  const book = path.join(dir, "multiple-rootfiles.epub");
  await createEpubWithMultipleRootfiles(book);

  const info = await readInfo(book);
  assert.equal(info.opfPath, "OEBPS/package.opf");
  assert.equal(info.metadata.title, "Package Rootfile");
});

test("falls back to rootfile full-path when OPF media type is missing", async () => {
  const dir = await tempDir();
  const book = path.join(dir, "generic-rootfile.epub");
  await createEpubWithGenericRootfile(book);

  const info = await readInfo(book);
  assert.equal(info.opfPath, "OPS/content.opf");
  assert.equal(info.metadata.title, "Generic Rootfile");
});

test("drops explicit archive directory entries when reading", () => {
  const archive = zipSync({
    mimetype: new TextEncoder().encode("application/epub+zip"),
    "META-INF/": new Uint8Array(),
    "META-INF/container.xml": new TextEncoder().encode("container"),
    "OEBPS/": new Uint8Array(),
    "OEBPS/package.opf": new TextEncoder().encode("opf")
  });

  const files = readArchive(archive);
  assert.deepEqual([...files.keys()].sort(), ["META-INF/container.xml", "OEBPS/package.opf", "mimetype"]);

  const rewritten = unzipSync(writeArchive(files));
  assert.deepEqual(Object.keys(rewritten).sort(), ["META-INF/container.xml", "OEBPS/package.opf", "mimetype"]);
});

test("keeps mimetype as the first ZIP entry with numeric top-level names", () => {
  const archive = writeArchive({
    mimetype: "application/epub+zip",
    "0": "numeric",
    "10": "numeric",
    "META-INF/container.xml": "container"
  });

  assert.equal(firstZipEntryName(archive), "mimetype");
  assert.deepEqual(Object.keys(unzipSync(archive)).sort(), ["0", "10", "META-INF/container.xml", "mimetype"]);
});

test("writes archives in time zones west of UTC", async () => {
  await exec(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { writeArchive } from "./dist/index.js";
writeArchive({ mimetype: "application/epub+zip", "META-INF/container.xml": "container" });`
    ],
    { env: { ...process.env, TZ: "America/Los_Angeles" } }
  );
});

test("uses merged fallback when filenames have no common prefix", () => {
  assert.equal(commonFilenamePrefix(["a.epub", "b.epub"]), "merged");
});

test("updates EPUB and standalone OPF metadata", async () => {
  const dir = await tempDir();
  const book = path.join(dir, "metadata.epub");
  await createEpub3(book, { title: "Before" });

  await updateMetadata(book, {
    title: "After & Beyond",
    authors: [{ name: "Jane Writer", fileAs: "Writer, Jane" }],
    translators: [{ name: "Taro Translator" }],
    subjects: ["One", "Two"],
    language: "sv",
    description: "New <description>",
    isbn: "9780000000001",
    published: "2026-07-04",
    modified: "2026-07-04T12:00:00Z"
  });

  const metadata = await readMetadata(book);
  assert.equal(metadata.title, "After & Beyond");
  assert.equal(metadata.authors[0].fileAs, "Writer, Jane");
  assert.equal(metadata.translators[0].name, "Taro Translator");
  assert.deepEqual(metadata.subjects, ["One", "Two"]);
  assert.equal(metadata.description, "New <description>");
  assert.equal(metadata.language, "sv");
  assert.equal(metadata.isbn, "9780000000001");
  assert.equal(metadata.published, "2026-07-04");
  assert.equal(metadata.modified, "2026-07-04T12:00:00Z");

  const epub = await readEpub(book);
  await writeFile(path.join(dir, "content.opf"), epub.files.get(epub.opfPath));
  await updateMetadata(path.join(dir, "content.opf"), { title: "Standalone" });
  assert.equal((await readMetadata(path.join(dir, "content.opf"))).title, "Standalone");
});

test("ignores undefined metadata patch values and preserves explicit clears", async () => {
  const dir = await tempDir();
  const book = path.join(dir, "undefined-metadata.epub");
  await createEpub3(book, { title: "Before", author: "Ada Lovelace" });

  await updateMetadata(book, {
    title: undefined,
    authors: undefined,
    subjects: undefined,
    description: undefined,
    language: undefined,
    isbn: undefined
  });

  let metadata = await readMetadata(book);
  assert.equal(metadata.title, "Before");
  assert.deepEqual(metadata.authors, [{ name: "Ada Lovelace", fileAs: "Lovelace, Ada" }]);
  assert.deepEqual(metadata.subjects, ["Fiction"]);
  assert.equal(metadata.description, "Line one\nLine two");
  assert.equal(metadata.language, "en");
  assert.equal(metadata.isbn, "9781234567890");

  await updateMetadata(book, {
    title: "",
    authors: null,
    subjects: null,
    description: null,
    isbn: null
  });

  metadata = await readMetadata(book);
  assert.equal(metadata.title, undefined);
  assert.deepEqual(metadata.authors, []);
  assert.deepEqual(metadata.subjects, []);
  assert.equal(metadata.description, undefined);
  assert.equal(metadata.isbn, undefined);
});

test("updates CDATA descriptions containing CDATA terminators", async () => {
  const dir = await tempDir();
  const book = path.join(dir, "cdata-terminator.epub");
  const description = "Before ]]> after <tag>";
  await createEpub3(book, { title: "CDATA Terminator" });

  await updateMetadata(book, { description });

  const metadata = await readMetadata(book);
  const opf = archiveText(await readEpub(book), "OEBPS/package.opf");
  assert.equal(metadata.description, description);
  assert.doesNotMatch(opf, /<!\[CDATA\[Before/);
});

test("metadata in-place updates do not write through stale predictable temp symlinks", async () => {
  const dir = await tempDir();
  const book = path.join(dir, "metadata-temp-symlink.epub");
  const staleTemp = `${book}.tmp-${process.pid}`;
  const escapedTarget = path.join(dir, "escaped-metadata-temp.epub");
  await createEpub3(book, { title: "Metadata Temp Symlink" });
  await symlink(escapedTarget, staleTemp);

  await updateMetadata(book, { title: "Updated Without Stale Temp" });

  assert.equal((await readMetadata(book)).title, "Updated Without Stale Temp");
  await assert.rejects(() => readFile(escapedTarget), { code: "ENOENT" });
});

test("removes refinements for replaced metadata elements", async () => {
  const dir = await tempDir();
  const opf = path.join(dir, "refined-metadata-replace.opf");
  await writeFile(
    opf,
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:refined-metadata-replace</dc:identifier>
    <dc:title id="old-title">Old Title</dc:title>
    <meta refines="#old-title" property="title-type">main</meta>
    <dc:subject id="old-subject">Old Subject</dc:subject>
    <meta refines="#old-subject" property="display-seq">1</meta>
    <dc:language>en</dc:language>
  </metadata>
  <manifest/>
  <spine/>
</package>`
  );

  await updateMetadata(opf, { title: "New Title", subjects: ["New Subject"] });

  const metadata = await readMetadata(opf);
  const opfText = await readFile(opf, "utf8");
  assert.equal(metadata.title, "New Title");
  assert.deepEqual(metadata.subjects, ["New Subject"]);
  assert.doesNotMatch(opfText, /Old Title/);
  assert.doesNotMatch(opfText, /Old Subject/);
  assert.doesNotMatch(opfText, /refines="#old-title"/);
  assert.doesNotMatch(opfText, /refines="#old-subject"/);
});

test("writes EPUB 2 modified dates using OPF 2 date metadata", async () => {
  const dir = await tempDir();
  const book = path.join(dir, "epub2-modified.epub");
  await createEpub2(book);

  await updateMetadata(book, { modified: "2026-07-04T12:00:00Z" });

  const epub = await readEpub(book);
  const opf = archiveText(epub, epub.opfPath);
  assert.equal((await readMetadata(book)).modified, "2026-07-04T12:00:00Z");
  assert.match(opf, /<dc:date[^>]*opf:event="modification"[^>]*>2026-07-04T12:00:00Z<\/dc:date>/);
  assert.doesNotMatch(opf, /property="dcterms:modified"/);
});

test("reads unqualified ISBN identifiers with ISBN prefix", async () => {
  const dir = await tempDir();
  const opf = path.join(dir, "isbn-prefix.opf");
  await writeFile(
    opf,
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:isbn-prefix</dc:identifier>
    <dc:identifier>ISBN: 9781234567890</dc:identifier>
    <dc:title>ISBN Prefix</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest/>
  <spine/>
</package>`
  );

  assert.equal((await readMetadata(opf)).isbn, "9781234567890");
});

test("reads and replaces ISBN URN identifiers", async () => {
  const dir = await tempDir();
  const opf = path.join(dir, "isbn-urn.opf");
  await writeFile(
    opf,
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="isbn">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="isbn">urn:isbn:9781234567897</dc:identifier>
    <dc:title>ISBN URN</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest/>
  <spine/>
</package>`
  );

  assert.equal((await readMetadata(opf)).isbn, "9781234567897");

  await updateMetadata(opf, { isbn: "9780000000001" });

  const metadata = await readMetadata(opf);
  const opfText = await readFile(opf, "utf8");
  assert.equal(metadata.isbn, "9780000000001");
  assert.match(opfText, /unique-identifier="isbn"/);
  assert.match(opfText, /<dc:identifier[^>]*id="isbn"[^>]*>9780000000001<\/dc:identifier>/);
  assert.doesNotMatch(opfText, /urn:isbn:9781234567897/);
});

test("inserts ISBN with an unused identifier id", async () => {
  const dir = await tempDir();
  const opf = path.join(dir, "isbn-id-collision.opf");
  await writeFile(
    opf,
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:isbn-id-collision</dc:identifier>
    <dc:identifier id="epubkit-isbn">catalog-id</dc:identifier>
    <dc:title>ISBN ID Collision</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest/>
  <spine/>
</package>`
  );

  await updateMetadata(opf, { isbn: "9780000000001" });

  const metadata = await readMetadata(opf);
  const opfText = await readFile(opf, "utf8");
  const ids = [...opfText.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(metadata.isbn, "9780000000001");
  assert.equal(new Set(ids).size, ids.length);
  assert.match(opfText, /<dc:identifier[^>]*id="epubkit-isbn"[^>]*>catalog-id<\/dc:identifier>/);
  assert.match(opfText, /<dc:identifier[^>]*id="epubkit-isbn-2"[^>]*opf:scheme="ISBN"[^>]*>9780000000001<\/dc:identifier>/);
});

test("does not repurpose non-ISBN unique identifier when adding ISBN", async () => {
  const dir = await tempDir();
  const book = path.join(dir, "unique-epubkit-isbn-catalog.epub");
  await createEpub3WithNonIsbnEpubkitIsbnUniqueIdentifier(book);

  await updateMetadata(book, { isbn: "9780000000001" });

  const info = await readInfo(book);
  const opf = archiveText(await readEpub(book), "OEBPS/package.opf");
  const ids = [...opf.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(info.uniqueIdentifier, "catalog-id");
  assert.equal(info.metadata.isbn, "9780000000001");
  assert.equal(new Set(ids).size, ids.length);
  assert.match(opf, /unique-identifier="epubkit-isbn"/);
  assert.match(opf, /<dc:identifier[^>]*id="epubkit-isbn"[^>]*>catalog-id<\/dc:identifier>/);
  assert.match(opf, /<dc:identifier[^>]*id="epubkit-isbn-2"[^>]*opf:scheme="ISBN"[^>]*>9780000000001<\/dc:identifier>/);
});

test("does not treat long numeric package identifiers as ISBNs", async () => {
  const dir = await tempDir();
  const opf = path.join(dir, "numeric-catalog-id.opf");
  await writeFile(
    opf,
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="catalog-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="catalog-id">1234567890123456</dc:identifier>
    <dc:title>Numeric Catalog ID</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest/>
  <spine/>
</package>`
  );

  assert.equal((await readMetadata(opf)).isbn, undefined);

  await updateMetadata(opf, { isbn: "9780000000001" });

  const metadata = await readMetadata(opf);
  const opfText = await readFile(opf, "utf8");
  assert.equal(metadata.isbn, "9780000000001");
  assert.match(opfText, /unique-identifier="catalog-id"/);
  assert.match(opfText, /<dc:identifier[^>]*id="catalog-id"[^>]*>1234567890123456<\/dc:identifier>/);
  assert.match(opfText, /<dc:identifier[^>]*id="epubkit-isbn"[^>]*opf:scheme="ISBN"[^>]*>9780000000001<\/dc:identifier>/);
});

test("does not treat invalid bare ISBN-shaped package identifiers as ISBNs", async () => {
  const dir = await tempDir();
  const opf = path.join(dir, "invalid-isbn-shaped-catalog-id.opf");
  await writeFile(
    opf,
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="catalog-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="catalog-id">1234567890</dc:identifier>
    <dc:title>Invalid ISBN-Shaped Catalog ID</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest/>
  <spine/>
</package>`
  );

  assert.equal((await readMetadata(opf)).isbn, undefined);

  await updateMetadata(opf, { isbn: "" });

  const opfText = await readFile(opf, "utf8");
  assert.equal((await readMetadata(opf)).isbn, undefined);
  assert.match(opfText, /unique-identifier="catalog-id"/);
  assert.match(opfText, /<dc:identifier[^>]*id="catalog-id"[^>]*>1234567890<\/dc:identifier>/);
  assert.doesNotMatch(opfText, /urn:uuid:/);
});

test("reads EPUB 3 contributor roles from metadata refinements", async () => {
  const dir = await tempDir();
  const opf = path.join(dir, "refined-role.opf");
  await writeFile(
    opf,
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:refined-role</dc:identifier>
    <dc:title>Refined Role</dc:title>
    <dc:creator id="author">Author Name</dc:creator>
    <dc:creator id="translator">Translator Name</dc:creator>
    <meta refines="#author" property="role" scheme="marc:relators">aut</meta>
    <meta refines="#author" property="file-as">Name, Author</meta>
    <meta refines="#translator" property="role" scheme="marc:relators">trl</meta>
    <meta refines="#translator" property="file-as">Name, Translator</meta>
    <dc:language>en</dc:language>
  </metadata>
  <manifest/>
  <spine/>
</package>`
  );

  const metadata = await readMetadata(opf);
  assert.deepEqual(metadata.authors, [{ name: "Author Name", fileAs: "Name, Author" }]);
  assert.deepEqual(metadata.translators, [{ name: "Translator Name", fileAs: "Name, Translator" }]);
});

test("updates contributors using EPUB 3 refined roles", async () => {
  const dir = await tempDir();
  const opf = path.join(dir, "update-refined-role.opf");
  await writeFile(
    opf,
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:update-refined-role</dc:identifier>
    <dc:title>Update Refined Role</dc:title>
    <dc:creator id="author">Old Author</dc:creator>
    <dc:creator id="translator">Old Translator</dc:creator>
    <dc:creator id="editor">Editor Name</dc:creator>
    <meta refines="#author" property="role" scheme="marc:relators">aut</meta>
    <meta refines="#author" property="file-as">Author, Old</meta>
    <meta refines="#translator" property="role" scheme="marc:relators">trl</meta>
    <meta refines="#translator" property="file-as">Translator, Old</meta>
    <meta refines="#editor" property="role" scheme="marc:relators">edt</meta>
    <meta refines="#editor" property="file-as">Editor, Name</meta>
    <dc:language>en</dc:language>
  </metadata>
  <manifest/>
  <spine/>
</package>`
  );

  await updateMetadata(opf, { authors: [{ name: "New Author" }] });
  let metadata = await readMetadata(opf);
  let opfText = await readFile(opf, "utf8");
  assert.deepEqual(metadata.authors.map((author) => author.name), ["New Author"]);
  assert.deepEqual(metadata.translators, [{ name: "Old Translator", fileAs: "Translator, Old" }]);
  assert.doesNotMatch(opfText, /Old Author/);
  assert.doesNotMatch(opfText, /refines="#author"/);
  assert.match(opfText, /Old Translator/);
  assert.match(opfText, /Editor Name/);
  assert.match(opfText, /refines="#editor"[^>]*>edt<\/meta>/);
  assert.match(opfText, /refines="#editor"[^>]*>Editor, Name<\/meta>/);

  await updateMetadata(opf, { translators: [{ name: "New Translator" }] });
  metadata = await readMetadata(opf);
  opfText = await readFile(opf, "utf8");
  assert.deepEqual(metadata.authors.map((author) => author.name), ["New Author"]);
  assert.deepEqual(metadata.translators.map((translator) => translator.name), ["New Translator"]);
  assert.doesNotMatch(opfText, /Old Translator/);
  assert.doesNotMatch(opfText, /refines="#translator"/);
  assert.match(opfText, /Editor Name/);
  assert.match(opfText, /refines="#editor"[^>]*>edt<\/meta>/);
});

test("preserves ISBN unique identifier and replaces creator translators", async () => {
  const dir = await tempDir();
  const book = path.join(dir, "unique-isbn.epub");
  await createEpub3WithIsbnUniqueIdentifierAndCreatorTranslator(book);

  assert.equal((await readInfo(book)).uniqueIdentifier, "9781234567890");

  await updateMetadata(book, {
    isbn: "9780000000001",
    translators: [{ name: "New Translator" }]
  });

  const info = await readInfo(book);
  const opf = archiveText(await readEpub(book), "OEBPS/package.opf");
  assert.equal(info.uniqueIdentifier, "9780000000001");
  assert.equal(info.metadata.isbn, "9780000000001");
  assert.deepEqual(info.metadata.translators.map((translator) => translator.name), ["New Translator"]);
  assert.match(opf, /unique-identifier="isbn"/);
  assert.match(opf, /<dc:identifier[^>]*id="isbn"[^>]*>9780000000001<\/dc:identifier>/);
  assert.doesNotMatch(opf, /Old Translator/);
});

test("clears ISBN without deleting the package unique identifier", async () => {
  const dir = await tempDir();
  const book = path.join(dir, "clear-unique-isbn.epub");
  await createEpub3WithIsbnUniqueIdentifierAndCreatorTranslator(book);

  await updateMetadata(book, { isbn: "" });

  const info = await readInfo(book);
  const opf = archiveText(await readEpub(book), "OEBPS/package.opf");
  assert.equal(info.metadata.isbn, undefined);
  assert.match(info.uniqueIdentifier, /^urn:uuid:/);
  assert.match(opf, /unique-identifier="isbn"/);
  assert.match(opf, /<dc:identifier[^>]*id="isbn"[^>]*>urn:uuid:[^<]+<\/dc:identifier>/);
  assert.doesNotMatch(opf, /opf:scheme="ISBN"/);
});

test("rejects ISBN unique identifier changes for EPUBs with obfuscated fonts", async () => {
  const dir = await tempDir();
  const book = path.join(dir, "obfuscated-unique-isbn.epub");
  await createEpub3WithObfuscatedFontAndIsbnUniqueIdentifier(book);
  const before = await readFile(book);

  await assert.rejects(
    () => updateMetadata(book, { isbn: "9780000000001" }),
    /obfuscated fonts/
  );

  const info = await readInfo(book);
  assert.deepEqual(await readFile(book), before);
  assert.equal(info.uniqueIdentifier, "9781234567890");
  assert.equal(info.metadata.isbn, "9781234567890");
});

test("rejects ISBN unique identifier reformatting for EPUBs with obfuscated fonts", async () => {
  const dir = await tempDir();
  const book = path.join(dir, "obfuscated-reformatted-unique-isbn.epub");
  await createEpub3WithObfuscatedFontAndIsbnUniqueIdentifier(book);
  const before = await readFile(book);

  await assert.rejects(
    () => updateMetadata(book, { isbn: "978-1-234-56789-0" }),
    /obfuscated fonts/
  );

  const info = await readInfo(book);
  assert.deepEqual(await readFile(book), before);
  assert.equal(info.uniqueIdentifier, "9781234567890");
  assert.equal(info.metadata.isbn, "9781234567890");
});

test("rejects ISBN unique identifier representation changes for EPUBs with obfuscated fonts", async () => {
  const dir = await tempDir();
  const book = path.join(dir, "obfuscated-urn-unique-isbn.epub");
  await createEpub3WithObfuscatedFontAndIsbnUniqueIdentifier(book);
  const before = await readFile(book);

  await assert.rejects(
    () => updateMetadata(book, { isbn: "urn:isbn:9781234567890" }),
    /obfuscated fonts/
  );

  const info = await readInfo(book);
  assert.deepEqual(await readFile(book), before);
  assert.equal(info.uniqueIdentifier, "9781234567890");
  assert.equal(info.metadata.isbn, "9781234567890");
});

test("rejects clearing ISBN unique identifiers for EPUBs with obfuscated fonts", async () => {
  const dir = await tempDir();
  const book = path.join(dir, "obfuscated-clear-unique-isbn.epub");
  await createEpub3WithObfuscatedFontAndIsbnUniqueIdentifier(book);
  const before = await readFile(book);

  await assert.rejects(
    () => updateMetadata(book, { isbn: "" }),
    /obfuscated fonts/
  );

  const info = await readInfo(book);
  assert.deepEqual(await readFile(book), before);
  assert.equal(info.uniqueIdentifier, "9781234567890");
  assert.equal(info.metadata.isbn, "9781234567890");
});

test("merges EPUB 3 books and unpacks exact originals", async () => {
  const dir = await tempDir();
  const a = path.join(dir, "book-10.epub");
  const b = path.join(dir, "book-2.epub");
  await createEpub3(a, { title: "Ten", heading: "Ten Heading" });
  await createEpub3(b, { title: "Two", heading: "Two Heading" });
  const out = path.join(dir, "merged.epub");

  await mergeEpubs([a, b], {
    output: out,
    title: "Merged Book",
    volumeLabelsFromFiles: true
  });

  const info = await readInfo(out);
  assert.equal(info.metadata.title, "Merged Book");
  assert.equal(info.version, "3");
  assert.equal(info.navPath, "EPUB/nav.xhtml");
  assert.equal(info.spineCount, 2);

  const merged = await readEpub(out);
  const nav = archiveText(merged, "EPUB/nav.xhtml");
  const opf = archiveText(merged, "EPUB/package.opf");
  assert.match(nav, /xmlns:epub="http:\/\/www\.idpf\.org\/2007\/ops"/);
  assertTextOrder(nav, "book-10", "book-2");
  assert.match(archiveText(merged, "EPUB/volumes/001/OEBPS/chapter.xhtml"), /Ten/);
  assert.match(archiveText(merged, "EPUB/volumes/002/OEBPS/chapter.xhtml"), /Two/);
  assertTextOrder(opf, "v1_chapter", "v2_chapter");
  assert.doesNotMatch(opf, /properties="[^"]*cover-image[^"]*"/);
  assert.ok(merged.files.has("META-INF/epubkit/manifest.json"));
  assert.ok([...merged.files.keys()].some((file) => file.startsWith("META-INF/epubkit/originals/")));
  assert.equal([...merged.files.keys()].some((file) => file.startsWith("EPUB/epubkit/")), false);

  const unpackDir = path.join(dir, "unpacked");
  const restored = await unpackMergedEpub(out, { outputDir: unpackDir });
  assert.deepEqual(restored.map((file) => path.basename(file)).sort(), ["book-10.epub", "book-2.epub"]);
  assert.deepEqual(await readFile(path.join(unpackDir, "book-10.epub")), await readFile(a));
  assert.deepEqual(await readFile(path.join(unpackDir, "book-2.epub")), await readFile(b));
});

test("sorts EPUB merge inputs by natural filename order when requested", async () => {
  const dir = await tempDir();
  const earlyDir = path.join(dir, "a");
  const lateDir = path.join(dir, "z");
  await mkdir(earlyDir);
  await mkdir(lateDir);
  const ten = path.join(earlyDir, "book-10.epub");
  const two = path.join(lateDir, "book-2.epub");
  await createEpub3(ten, { title: "Ten", heading: "Ten Heading" });
  await createEpub3(two, { title: "Two", heading: "Two Heading" });
  const out = path.join(dir, "merged-sorted.epub");

  await mergeEpubs([ten, two], {
    output: out,
    title: "Sorted Merge",
    sort: true,
    volumeLabelsFromFiles: true
  });

  const merged = await readEpub(out);
  const nav = archiveText(merged, "EPUB/nav.xhtml");
  const opf = archiveText(merged, "EPUB/package.opf");
  assertTextOrder(nav, "book-2", "book-10");
  assert.match(archiveText(merged, "EPUB/volumes/001/OEBPS/chapter.xhtml"), /Two/);
  assert.match(archiveText(merged, "EPUB/volumes/002/OEBPS/chapter.xhtml"), /Ten/);
  assertTextOrder(opf, "v1_chapter", "v2_chapter");
});

test("rejects conflicting API merge order options", async () => {
  const dir = await tempDir();
  const a = path.join(dir, "a.epub");
  const b = path.join(dir, "b.epub");
  await createEpub3(a, { title: "A" });
  await createEpub3(b, { title: "B" });

  await assert.rejects(
    () => mergeEpubs([a, b], { output: path.join(dir, "out.epub"), sort: true, preserveOrder: true }),
    /Use either sort or preserveOrder, not both/
  );
});

test("uses the resolved merge language in generated EPUB 3 nav", async () => {
  const dir = await tempDir();
  const a = path.join(dir, "sv-a.epub");
  const b = path.join(dir, "sv-b.epub");
  const out = path.join(dir, "sv-merged.epub");
  await createEpub3(a, { title: "Svenska A", language: "sv" });
  await createEpub3(b, { title: "Svenska B", language: "sv" });

  await mergeEpubs([a, b], { output: out, title: "Svensk Samling", preserveOrder: true });

  const merged = await readEpub(out);
  const opf = archiveText(merged, "EPUB/package.opf");
  const nav = archiveText(merged, "EPUB/nav.xhtml");
  assert.match(opf, /<dc:language>sv<\/dc:language>/);
  assert.match(nav, /<html[^>]*lang="sv"/);
  assert.doesNotMatch(nav, /<html[^>]*lang="en"/);
});

test("preserves manifest IDREF attributes and spine properties when merging", async () => {
  const dir = await tempDir();
  const linked = path.join(dir, "linked.epub");
  const regular = path.join(dir, "regular.epub");
  const out = path.join(dir, "linked-merged.epub");
  await createEpub3WithManifestIdrefsAndSpineProperties(linked);
  await createEpub3(regular, { title: "Regular" });

  await mergeEpubs([linked, regular], { output: out, title: "Linked Merge", preserveOrder: true });

  const merged = await readEpub(out);
  const opf = archiveText(merged, "EPUB/package.opf");
  assert.match(opf, /<item id="v1_page"[^>]*media-overlay="v1_mo"/);
  assert.match(opf, /<item id="v1_vector"[^>]*fallback="v1_raster"/);
  assert.match(opf, /<item id="v1_fancy"[^>]*fallback-style="v1_plain"/);
  assert.match(opf, /<itemref idref="v1_page" properties="page-spread-left"\/>/);
  assert.ok(merged.files.has("EPUB/volumes/001/OEBPS/page.smil"));
  assert.ok(merged.files.has("EPUB/volumes/001/OEBPS/images/diagram.png"));
  assert.ok(merged.files.has("EPUB/volumes/001/OEBPS/plain.css"));
});

test("preserves common spine page progression direction when merging", async () => {
  const dir = await tempDir();
  const first = path.join(dir, "rtl-a.epub");
  const second = path.join(dir, "rtl-b.epub");
  const out = path.join(dir, "rtl-merged.epub");
  await createEpub3WithPageProgression(first, "RTL A", "rtl");
  await createEpub3WithPageProgression(second, "RTL B", "rtl");

  await mergeEpubs([first, second], { output: out, title: "RTL Merge", preserveOrder: true });

  const opf = archiveText(await readEpub(out), "EPUB/package.opf");
  assert.match(opf, /<spine[^>]*page-progression-direction="rtl"/);
});

test("omits spine page progression direction unless every input declares it", async () => {
  const dir = await tempDir();
  const rtl = path.join(dir, "rtl.epub");
  const unspecified = path.join(dir, "unspecified.epub");
  const out = path.join(dir, "partly-unspecified-direction.epub");
  await createEpub3WithPageProgression(rtl, "RTL", "rtl");
  await createEpub3(unspecified, { title: "Unspecified" });

  await mergeEpubs([rtl, unspecified], { output: out, title: "Partly Unspecified Direction", preserveOrder: true });

  const opf = archiveText(await readEpub(out), "EPUB/package.opf");
  assert.doesNotMatch(opf, /page-progression-direction=/);
});

test("omits spine page progression direction for conflicting merge inputs", async () => {
  const dir = await tempDir();
  const rtl = path.join(dir, "rtl.epub");
  const ltr = path.join(dir, "ltr.epub");
  const out = path.join(dir, "mixed-direction.epub");
  await createEpub3WithPageProgression(rtl, "RTL", "rtl");
  await createEpub3WithPageProgression(ltr, "LTR", "ltr");

  await mergeEpubs([rtl, ltr], { output: out, title: "Mixed Direction", preserveOrder: true });

  const opf = archiveText(await readEpub(out), "EPUB/package.opf");
  assert.doesNotMatch(opf, /page-progression-direction=/);
});

test("refuses to overwrite existing merge output unless forced", async () => {
  const dir = await tempDir();
  const a = path.join(dir, "a.epub");
  const b = path.join(dir, "b.epub");
  const out = path.join(dir, "existing.epub");
  await createEpub3(a, { title: "A" });
  await createEpub3(b, { title: "B" });
  await writeFile(out, "do not clobber");

  await assert.rejects(() => mergeEpubs([a, b], { output: out }), /Refusing to overwrite existing file/);
  assert.equal(await readFile(out, "utf8"), "do not clobber");

  await mergeEpubs([a, b], { output: out, force: true, title: "Forced Merge" });
  assert.equal((await readInfo(out)).metadata.title, "Forced Merge");
});

test("refuses broken symlink merge outputs without writing outside output path", async () => {
  const dir = await tempDir();
  const a = path.join(dir, "a.epub");
  const b = path.join(dir, "b.epub");
  const out = path.join(dir, "linked-output.epub");
  const escapedTarget = path.join(dir, "escaped-merge.epub");
  await createEpub3(a, { title: "A" });
  await createEpub3(b, { title: "B" });
  await symlink(escapedTarget, out);

  await assert.rejects(
    () => mergeEpubs([a, b], { output: out, title: "Broken Symlink Merge" }),
    /Refusing to overwrite existing file/
  );
  await assert.rejects(() => readFile(escapedTarget), { code: "ENOENT" });
});

test("refuses forced broken symlink merge outputs without writing outside output path", async () => {
  const dir = await tempDir();
  const a = path.join(dir, "a.epub");
  const b = path.join(dir, "b.epub");
  const out = path.join(dir, "linked-forced-output.epub");
  const escapedTarget = path.join(dir, "escaped-forced-merge.epub");
  await createEpub3(a, { title: "A" });
  await createEpub3(b, { title: "B" });
  await symlink(escapedTarget, out);

  await assert.rejects(
    () => mergeEpubs([a, b], { output: out, force: true, title: "Forced Broken Symlink Merge" }),
    /symbolic link/
  );
  await assert.rejects(() => readFile(escapedTarget), { code: "ENOENT" });
});

test("refuses to overwrite merge inputs even when forced", async () => {
  const dir = await tempDir();
  const a = path.join(dir, "a.epub");
  const b = path.join(dir, "b.epub");
  await createEpub3(a, { title: "A" });
  await createEpub3(b, { title: "B" });
  const before = await readFile(a);

  await assert.rejects(() => mergeEpubs([a, b], { output: a, force: true, title: "Bad Merge" }), /merge output cannot overwrite an input file/);
  assert.deepEqual(await readFile(a), before);
});

test("refuses symlinked merge outputs that resolve to inputs even when forced", async () => {
  const dir = await tempDir();
  const a = path.join(dir, "a.epub");
  const b = path.join(dir, "b.epub");
  const output = path.join(dir, "linked-output.epub");
  await createEpub3(a, { title: "A" });
  await createEpub3(b, { title: "B" });
  await symlink(a, output);
  const before = await readFile(a);

  await assert.rejects(
    () => mergeEpubs([a, b], { output, force: true, title: "Bad Symlink Merge" }),
    /merge output cannot overwrite an input file/
  );
  assert.deepEqual(await readFile(a), before);
});

test("refuses hard-linked merge outputs that share an input inode even when forced", async () => {
  const dir = await tempDir();
  const a = path.join(dir, "a.epub");
  const b = path.join(dir, "b.epub");
  const output = path.join(dir, "hard-linked-output.epub");
  await createEpub3(a, { title: "A" });
  await createEpub3(b, { title: "B" });
  await link(a, output);
  const before = await readFile(a);

  await assert.rejects(
    () => mergeEpubs([a, b], { output, force: true, title: "Bad Hard Link Merge" }),
    /merge output cannot overwrite an input file/
  );
  assert.deepEqual(await readFile(a), before);
});

test("preserves spine-listed EPUB 3 nav documents as readable content", async () => {
  const dir = await tempDir();
  const a = path.join(dir, "nav-a.epub");
  const b = path.join(dir, "nav-b.epub");
  const out = path.join(dir, "nav-spine-merged.epub");
  await createEpub3WithNavOnlySpine(a, "Nav A");
  await createEpub3WithNavOnlySpine(b, "Nav B");

  await mergeEpubs([a, b], { output: out, title: "Nav Spine Merge", preserveOrder: true });

  const info = await readInfo(out);
  const merged = await readEpub(out);
  const opf = archiveText(merged, "EPUB/package.opf");
  const navProperties = [...opf.matchAll(/properties="([^"]*)"/g)].filter((match) => match[1].split(/\s+/).includes("nav"));
  assert.equal(info.spineCount, 2);
  assert.ok(merged.files.has("EPUB/volumes/001/OEBPS/nav.xhtml"));
  assert.ok(merged.files.has("EPUB/volumes/002/OEBPS/nav.xhtml"));
  assert.match(opf, /<item id="v1_nav" href="volumes\/001\/OEBPS\/nav\.xhtml" media-type="application\/xhtml\+xml"\/>/);
  assert.match(opf, /<item id="v2_nav" href="volumes\/002\/OEBPS\/nav\.xhtml" media-type="application\/xhtml\+xml"\/>/);
  assert.match(opf, /<itemref idref="v1_nav"\/>/);
  assert.match(opf, /<itemref idref="v2_nav"\/>/);
  assert.equal(navProperties.length, 1);
});

test("keeps manifest-listed source nav documents when merging", async () => {
  const dir = await tempDir();
  const linked = path.join(dir, "linked-nav.epub");
  const regular = path.join(dir, "regular.epub");
  const out = path.join(dir, "linked-nav-merged.epub");
  await createEpub3WithChapterLinkToManifestNav(linked);
  await createEpub3(regular, { title: "Regular" });

  await mergeEpubs([linked, regular], { output: out, title: "Linked Nav Merge", preserveOrder: true });

  const merged = await readEpub(out);
  const opf = archiveText(merged, "EPUB/package.opf");
  const chapter = archiveText(merged, "EPUB/volumes/001/OEBPS/chapter.xhtml");
  const navProperties = [...opf.matchAll(/properties="([^"]*)"/g)].filter((match) => match[1].split(/\s+/).includes("nav"));
  assert.ok(merged.files.has("EPUB/volumes/001/OEBPS/nav.xhtml"));
  assert.match(opf, /<item id="v1_nav" href="volumes\/001\/OEBPS\/nav\.xhtml" media-type="application\/xhtml\+xml"\/>/);
  assert.match(opf, /<item id="nav" href="nav\.xhtml" media-type="application\/xhtml\+xml" properties="nav"\/>/);
  assert.match(chapter, /href="nav\.xhtml"/);
  assert.equal(navProperties.length, 1);
});

test("drops source NCX fallbacks when merging EPUB 3 books", async () => {
  const dir = await tempDir();
  const fallback = path.join(dir, "ncx-fallback.epub");
  const regular = path.join(dir, "regular.epub");
  const out = path.join(dir, "ncx-fallback-merged.epub");
  await createEpub3WithNcxFallback(fallback);
  await createEpub3(regular, { title: "Regular" });

  await mergeEpubs([fallback, regular], { output: out, title: "NCX Fallback Merge", preserveOrder: true });

  const merged = await readEpub(out);
  const opf = archiveText(merged, "EPUB/package.opf");
  assert.ok(merged.files.has("EPUB/nav.xhtml"));
  assert.equal(merged.files.has("EPUB/volumes/001/OEBPS/toc.ncx"), false);
  assert.match(opf, /<item id="nav" href="nav\.xhtml" media-type="application\/xhtml\+xml" properties="nav"\/>/);
  assert.doesNotMatch(opf, /volumes\/001\/OEBPS\/toc\.ncx/);
});

test("unpacks duplicate original basenames without overwriting", async () => {
  const dir = await tempDir();
  const firstDir = path.join(dir, "first");
  const secondDir = path.join(dir, "second");
  await mkdir(firstDir);
  await mkdir(secondDir);
  const first = path.join(firstDir, "same.epub");
  const second = path.join(secondDir, "same.epub");
  const out = path.join(dir, "duplicates.epub");
  await createEpub3(first, { title: "First" });
  await createEpub3(second, { title: "Second" });

  await mergeEpubs([first, second], { output: out, title: "Duplicate Restore", preserveOrder: true });

  const unpackDir = path.join(dir, "unpacked-duplicates");
  const restored = await unpackMergedEpub(out, { outputDir: unpackDir });
  assert.deepEqual(restored.map((file) => path.basename(file)), ["same.epub", "same (2).epub"]);
  assert.deepEqual(await readFile(restored[0]), await readFile(first));
  assert.deepEqual(await readFile(restored[1]), await readFile(second));
});

test("unpacks case-only original basename collisions without overwriting", async () => {
  const dir = await tempDir();
  const firstDir = path.join(dir, "first");
  const secondDir = path.join(dir, "second");
  await mkdir(firstDir);
  await mkdir(secondDir);
  const first = path.join(firstDir, "Book.epub");
  const second = path.join(secondDir, "book.epub");
  const out = path.join(dir, "case-duplicates.epub");
  await createEpub3(first, { title: "Upper Book" });
  await createEpub3(second, { title: "Lower Book" });

  await mergeEpubs([first, second], { output: out, title: "Case Duplicate Restore", preserveOrder: true });

  const unpackDir = path.join(dir, "unpacked-case-duplicates");
  const restored = await unpackMergedEpub(out, { outputDir: unpackDir });
  assert.deepEqual(restored.map((file) => path.basename(file)), ["Book.epub", "book (2).epub"]);
  assert.deepEqual(await readFile(restored[0]), await readFile(first));
  assert.deepEqual(await readFile(restored[1]), await readFile(second));
});

test("unpack refuses broken symlink restore targets without writing outside output dir", async () => {
  const dir = await tempDir();
  const first = path.join(dir, "a.epub");
  const second = path.join(dir, "b.epub");
  const out = path.join(dir, "merged.epub");
  const unpackDir = path.join(dir, "unpacked-symlink");
  const escapedTarget = path.join(dir, "escaped.epub");
  await createEpub3(first, { title: "A" });
  await createEpub3(second, { title: "B" });
  await mergeEpubs([first, second], { output: out, title: "Symlink Restore", preserveOrder: true });
  await mkdir(unpackDir);
  await symlink(escapedTarget, path.join(unpackDir, "a.epub"));

  await assert.rejects(
    () => unpackMergedEpub(out, { outputDir: unpackDir }),
    /Refusing to overwrite existing file/
  );
  await assert.rejects(() => readFile(escapedTarget), { code: "ENOENT" });
});

test("forced unpack refuses broken symlink restore targets without writing outside output dir", async () => {
  const dir = await tempDir();
  const first = path.join(dir, "a.epub");
  const second = path.join(dir, "b.epub");
  const out = path.join(dir, "merged-forced-symlink.epub");
  const unpackDir = path.join(dir, "unpacked-forced-symlink");
  const escapedTarget = path.join(dir, "escaped-forced-unpack.epub");
  await createEpub3(first, { title: "A" });
  await createEpub3(second, { title: "B" });
  await mergeEpubs([first, second], { output: out, title: "Forced Symlink Restore", preserveOrder: true });
  await mkdir(unpackDir);
  await symlink(escapedTarget, path.join(unpackDir, "a.epub"));

  await assert.rejects(
    () => unpackMergedEpub(out, { outputDir: unpackDir, force: true }),
    /symbolic link/
  );
  await assert.rejects(() => readFile(escapedTarget), { code: "ENOENT" });
});

test("forced unpack refuses to overwrite the source merged EPUB", async () => {
  const dir = await tempDir();
  const sourceDir = path.join(dir, "sources");
  const unpackDir = path.join(dir, "unpack-source-alias");
  await mkdir(sourceDir);
  await mkdir(unpackDir);
  const first = path.join(sourceDir, "a.epub");
  const second = path.join(sourceDir, "b.epub");
  const merged = path.join(unpackDir, "a.epub");
  await createEpub3(first, { title: "A" });
  await createEpub3(second, { title: "B" });
  await mergeEpubs([first, second], { output: merged, title: "Source Alias Restore", preserveOrder: true });
  const before = await readFile(merged);

  await assert.rejects(
    () => unpackMergedEpub(merged, { outputDir: unpackDir, force: true }),
    /unpack output cannot overwrite input EPUB/
  );
  assert.deepEqual(await readFile(merged), before);
  assert.equal((await readInfo(merged)).metadata.title, "Source Alias Restore");
});

test("forced unpack refuses hard-linked restore targets that share the source inode", async () => {
  const dir = await tempDir();
  const first = path.join(dir, "a.epub");
  const second = path.join(dir, "b.epub");
  const merged = path.join(dir, "merged-hardlink-source.epub");
  const unpackDir = path.join(dir, "unpack-hardlink-source");
  await createEpub3(first, { title: "A" });
  await createEpub3(second, { title: "B" });
  await mergeEpubs([first, second], { output: merged, title: "Hard Link Source Restore", preserveOrder: true });
  await mkdir(unpackDir);
  await link(merged, path.join(unpackDir, "a.epub"));
  const before = await readFile(merged);

  await assert.rejects(
    () => unpackMergedEpub(merged, { outputDir: unpackDir, force: true }),
    /unpack output cannot overwrite input EPUB/
  );
  assert.deepEqual(await readFile(merged), before);
  assert.equal((await readInfo(merged)).metadata.title, "Hard Link Source Restore");
});

test("unpacks sanitized original filename collisions without overwriting", async () => {
  const dir = await tempDir();
  const merged = path.join(dir, "sanitized-collisions.epub");
  await createMergedRestoreFixture(merged);

  const unpackDir = path.join(dir, "unpacked-sanitized");
  const restored = await unpackMergedEpub(merged, { outputDir: unpackDir });
  assert.deepEqual(restored.map((file) => path.basename(file)), ["bad name.epub", "bad name (2).epub"]);
  assert.equal(await readFile(restored[0], "utf8"), "first original");
  assert.equal(await readFile(restored[1], "utf8"), "second original");
});

test("merges EPUB 3 resources resolved outside the OPF directory", async () => {
  const dir = await tempDir();
  const external = path.join(dir, "external.epub");
  const regular = path.join(dir, "regular.epub");
  const out = path.join(dir, "external-merged.epub");
  await createEpub3WithResourceOutsideOpfDir(external);
  await createEpub3(regular, { title: "Regular" });

  await mergeEpubs([external, regular], { output: out, title: "External Merge", preserveOrder: true });

  const merged = await readEpub(out);
  const opf = archiveText(merged, "EPUB/package.opf");
  const nav = archiveText(merged, "EPUB/nav.xhtml");
  assert.ok(merged.files.has("EPUB/volumes/001/OEBPS/shared/chapter.xhtml"));
  assert.ok(merged.files.has("EPUB/volumes/001/OEBPS/shared/style.css"));
  assert.match(opf, /href="volumes\/001\/OEBPS\/shared\/chapter\.xhtml"/);
  assert.match(nav, /href="volumes\/001\/OEBPS\/shared\/chapter\.xhtml"/);
  assert.doesNotMatch(opf, /href="[^"]*\.\.\//);
});

test("percent-encodes merged manifest and nav hrefs", async () => {
  const dir = await tempDir();
  const encoded = path.join(dir, "encoded.epub");
  const regular = path.join(dir, "regular.epub");
  const out = path.join(dir, "encoded-merged.epub");
  await createEpub3WithEncodedReservedHref(encoded);
  await createEpub3(regular, { title: "Regular" });

  await mergeEpubs([encoded, regular], { output: out, title: "Encoded Merge", preserveOrder: true });

  const merged = await readEpub(out);
  const opf = archiveText(merged, "EPUB/package.opf");
  const nav = archiveText(merged, "EPUB/nav.xhtml");
  assert.ok(merged.files.has("EPUB/volumes/001/OEBPS/chapter#1.xhtml"));
  assert.match(opf, /href="volumes\/001\/OEBPS\/chapter%231\.xhtml"/);
  assert.match(nav, /href="volumes\/001\/OEBPS\/chapter%231\.xhtml"/);
  assert.doesNotMatch(opf, /href="[^"]*chapter#1\.xhtml"/);
  assert.doesNotMatch(nav, /href="[^"]*chapter#1\.xhtml"/);
});

test("preserves encryption metadata when merging encrypted resources", async () => {
  const dir = await tempDir();
  const encrypted = path.join(dir, "encrypted.epub");
  const regular = path.join(dir, "regular.epub");
  const out = path.join(dir, "encrypted-merged.epub");
  await createEpub3WithEncryptedFont(encrypted);
  await createEpub3(regular, { title: "Regular" });

  await mergeEpubs([encrypted, regular], { output: out, title: "Encrypted Merge", preserveOrder: true });

  const merged = await readEpub(out);
  const encryption = archiveText(merged, "META-INF/encryption.xml");
  assert.ok(merged.files.has("EPUB/volumes/001/OEBPS/fonts/font.otf"));
  assert.match(encryption, /URI="EPUB\/volumes\/001\/OEBPS\/fonts\/font\.otf"/);
});

test("rejects merging EPUBs with obfuscated fonts", async () => {
  const dir = await tempDir();
  const obfuscated = path.join(dir, "obfuscated.epub");
  const regular = path.join(dir, "regular.epub");
  const out = path.join(dir, "obfuscated-merged.epub");
  await createEpub3WithObfuscatedFont(obfuscated);
  await createEpub3(regular, { title: "Regular" });

  await assert.rejects(
    () => mergeEpubs([obfuscated, regular], { output: out, title: "Obfuscated Merge", preserveOrder: true }),
    /obfuscated fonts/
  );
  await assert.rejects(() => readFile(out), { code: "ENOENT" });
});

test("re-escapes rewritten encryption resource URIs", async () => {
  const dir = await tempDir();
  const encrypted = path.join(dir, "escaped-encrypted.epub");
  const regular = path.join(dir, "regular.epub");
  const out = path.join(dir, "escaped-encrypted-merged.epub");
  await createEpub3WithEscapedEncryptedFont(encrypted);
  await createEpub3(regular, { title: "Regular" });

  await mergeEpubs([encrypted, regular], { output: out, title: "Escaped Encryption Merge", preserveOrder: true });

  const merged = await readEpub(out);
  const encryption = archiveText(merged, "META-INF/encryption.xml");
  assert.ok(merged.files.has("EPUB/volumes/001/OEBPS/fonts/font#1.otf"));
  assert.match(encryption, /URI="EPUB\/volumes\/001\/OEBPS\/fonts\/font%231\.otf"/);
  assert.doesNotMatch(encryption, /URI="[^"]*font#1\.otf"/);
});

test("merges EPUB 2 books with NCX output", async () => {
  const dir = await tempDir();
  const a = path.join(dir, "a.epub");
  const b = path.join(dir, "b.epub");
  await createEpub2(a, { title: "A" });
  await createEpub2(b, { title: "B" });
  const out = path.join(dir, "epub2-merged.epub");

  await mergeEpubs([a, b], { output: out, title: "EPUB 2 Merge" });

  const info = await readInfo(out);
  assert.equal(info.version, "2");
  assert.equal(info.ncxPath, "EPUB/toc.ncx");
  assert.equal(info.spineCount, 2);

  const merged = await readEpub(out);
  const opf = archiveText(merged, "EPUB/package.opf");
  const ncx = archiveText(merged, "EPUB/toc.ncx");
  const uniqueId = opf.match(/<dc:identifier id="book-id">([^<]+)<\/dc:identifier>/)?.[1];
  const playOrders = [...ncx.matchAll(/playOrder="(\d+)"/g)].map((match) => Number(match[1]));
  assert.ok(merged.files.has("EPUB/toc.ncx"));
  assert.equal(merged.files.has("EPUB/nav.xhtml"), false);
  assert.equal(merged.files.has("EPUB/volumes/001/OPS/toc.ncx"), false);
  assert.equal(merged.files.has("EPUB/volumes/002/OPS/toc.ncx"), false);
  assert.match(opf, /<item id="ncx" href="toc\.ncx" media-type="application\/x-dtbncx\+xml"\/>/);
  assert.doesNotMatch(opf, /volumes\/00[12]\/OPS\/toc\.ncx/);
  assert.ok(uniqueId);
  assert.ok(ncx.includes(`name="dtb:uid" content="${uniqueId}"`));
  assert.match(ncx, /<meta name="dtb:depth" content="2"\/>/);
  assert.match(ncx, /<meta name="dtb:totalPageCount" content="0"\/>/);
  assert.match(ncx, /<meta name="dtb:maxPageNumber" content="0"\/>/);
  assert.deepEqual(playOrders, [1, 2, 3, 4]);
});

test("replaces published aliases and ISBN-10 metadata", async () => {
  const dir = await tempDir();
  const opf = path.join(dir, "aliases.opf");
  await writeFile(
    opf,
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:identifier id="book-id">urn:uuid:aliases</dc:identifier>
    <dc:identifier>123456789X</dc:identifier>
    <dc:title>Aliases</dc:title>
    <dc:language>en</dc:language>
    <dc:date opf:event="published">2020-01-01</dc:date>
  </metadata>
  <manifest/>
  <spine/>
</package>`
  );

  await updateMetadata(opf, { published: "2026-07-04", isbn: "9780000000001" });

  const metadata = await readMetadata(opf);
  const opfText = await readFile(opf, "utf8");
  assert.equal(metadata.published, "2026-07-04");
  assert.equal(metadata.isbn, "9780000000001");
  assert.doesNotMatch(opfText, /opf:event="published">2020-01-01/);
  assert.doesNotMatch(opfText, />123456789X</);
});

test("treats bare dc:date as publication date and replaces it", async () => {
  const dir = await tempDir();
  const opf = path.join(dir, "bare-publication-date.opf");
  await writeFile(
    opf,
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:identifier id="book-id">urn:uuid:bare-publication-date</dc:identifier>
    <dc:title>Bare Publication Date</dc:title>
    <dc:language>en</dc:language>
    <dc:date>2020-01-01</dc:date>
  </metadata>
  <manifest/>
  <spine/>
</package>`
  );

  let metadata = await readMetadata(opf);
  assert.equal(metadata.published, "2020-01-01");
  assert.equal(metadata.created, undefined);

  await updateMetadata(opf, { published: "2026-07-04" });

  metadata = await readMetadata(opf);
  const opfText = await readFile(opf, "utf8");
  assert.equal(metadata.published, "2026-07-04");
  assert.equal(metadata.created, undefined);
  assert.doesNotMatch(opfText, /<dc:date>2020-01-01<\/dc:date>/);
  assert.equal((opfText.match(/<dc:date/g) ?? []).length, 1);
  assert.match(opfText, /<dc:date[^>]*opf:event="publication"[^>]*>2026-07-04<\/dc:date>/);
});

test("detects, extracts, and replaces covers", async () => {
  const dir = await tempDir();
  const book = path.join(dir, "cover.epub");
  const replacement = path.join(dir, "replacement.png");
  await createEpub3(book, { title: "Cover Book" });
  await writeFile(replacement, tinyPng);

  const epub = await readEpub(book);
  const cover = detectCover(epub);
  assert.equal(cover?.path, "OEBPS/images/cover.png");

  const extracted = path.join(dir, "cover.png");
  await extractCover(book, extracted);
  assert.deepEqual(await readFile(extracted), Buffer.from(tinyPng));

  await replaceCover(book, replacement);
  const updated = detectCover(await readEpub(book));
  assert.equal(updated?.mediaType, "image/png");
  assert.deepEqual(Buffer.from(updated?.data ?? []), Buffer.from(tinyPng));
});

test("cover in-place updates do not write through stale predictable temp symlinks", async () => {
  const dir = await tempDir();
  const book = path.join(dir, "cover-temp-symlink.epub");
  const replacement = path.join(dir, "replacement.png");
  const staleTemp = `${book}.tmp-${process.pid}`;
  const escapedTarget = path.join(dir, "escaped-cover-temp.epub");
  await createEpub3(book, { title: "Cover Temp Symlink" });
  await writeFile(replacement, tinyPng);
  await symlink(escapedTarget, staleTemp);

  await replaceCover(book, replacement);

  assert.deepEqual(Buffer.from(detectCover(await readEpub(book))?.data ?? []), Buffer.from(tinyPng));
  await assert.rejects(() => readFile(escapedTarget), { code: "ENOENT" });
});

test("refuses to overwrite existing extracted cover output unless forced", async () => {
  const dir = await tempDir();
  const book = path.join(dir, "cover-extract-output.epub");
  const out = path.join(dir, "existing-cover.png");
  await createEpub3(book, { title: "Cover Extract Output" });
  await writeFile(out, "existing output");

  await assert.rejects(
    () => extractCover(book, { output: out }),
    /Refusing to overwrite existing file/
  );
  assert.equal(await readFile(out, "utf8"), "existing output");

  await extractCover(book, { output: out, force: true });
  assert.deepEqual(await readFile(out), Buffer.from(tinyPng));
});

test("cover extraction refuses to overwrite the source EPUB even when forced", async () => {
  const dir = await tempDir();
  const book = path.join(dir, "cover-extract-source.epub");
  await createEpub3(book, { title: "Cover Extract Source" });
  const before = await readFile(book);

  await assert.rejects(
    () => extractCover(book, { output: book, force: true }),
    /cover output cannot overwrite input EPUB/
  );
  assert.deepEqual(await readFile(book), before);
  assert.equal((await readInfo(book)).metadata.title, "Cover Extract Source");
});

test("cover extraction refuses symlink outputs that resolve to the source EPUB even when forced", async () => {
  const dir = await tempDir();
  const book = path.join(dir, "cover-extract-source-symlink.epub");
  const out = path.join(dir, "linked-source.epub");
  await createEpub3(book, { title: "Cover Extract Source Symlink" });
  await symlink(book, out);
  const before = await readFile(book);

  await assert.rejects(
    () => extractCover(book, { output: out, force: true }),
    /cover output cannot overwrite input EPUB/
  );
  assert.deepEqual(await readFile(book), before);
  assert.equal((await readInfo(book)).metadata.title, "Cover Extract Source Symlink");
});

test("cover extraction refuses hardlink outputs that share the source EPUB inode even when forced", async () => {
  const dir = await tempDir();
  const book = path.join(dir, "cover-extract-source-hardlink.epub");
  const out = path.join(dir, "hardlinked-source.epub");
  await createEpub3(book, { title: "Cover Extract Source Hardlink" });
  await link(book, out);
  const before = await readFile(book);

  await assert.rejects(
    () => extractCover(book, { output: out, force: true }),
    /cover output cannot overwrite input EPUB/
  );
  assert.deepEqual(await readFile(book), before);
  assert.equal((await readInfo(book)).metadata.title, "Cover Extract Source Hardlink");
});

test("refuses broken symlink extracted cover outputs without writing outside output path", async () => {
  const dir = await tempDir();
  const book = path.join(dir, "cover-extract-symlink.epub");
  const out = path.join(dir, "linked-cover.png");
  const escapedTarget = path.join(dir, "escaped-cover.png");
  await createEpub3(book, { title: "Cover Extract Symlink" });
  await symlink(escapedTarget, out);

  await assert.rejects(
    () => extractCover(book, { output: out }),
    /Refusing to overwrite existing file/
  );
  await assert.rejects(() => readFile(escapedTarget), { code: "ENOENT" });
});

test("refuses forced broken symlink extracted cover outputs without writing outside output path", async () => {
  const dir = await tempDir();
  const book = path.join(dir, "cover-extract-forced-symlink.epub");
  const out = path.join(dir, "linked-forced-cover.png");
  const escapedTarget = path.join(dir, "escaped-forced-cover.png");
  await createEpub3(book, { title: "Cover Extract Forced Symlink" });
  await symlink(escapedTarget, out);

  await assert.rejects(
    () => extractCover(book, { output: out, force: true }),
    /symbolic link/
  );
  await assert.rejects(() => readFile(escapedTarget), { code: "ENOENT" });
});

test("refuses to overwrite existing cover output unless forced", async () => {
  const dir = await tempDir();
  const book = path.join(dir, "cover-output.epub");
  const replacement = path.join(dir, "replacement.png");
  const out = path.join(dir, "existing-output.epub");
  await createEpub3(book, { title: "Cover Output" });
  await writeFile(replacement, tinyPng);
  await writeFile(out, "existing output");

  await assert.rejects(
    () => replaceCover(book, replacement, { output: out }),
    /Refusing to overwrite existing file/
  );
  assert.equal(await readFile(out, "utf8"), "existing output");

  await replaceCover(book, replacement, { output: out, force: true });
  assert.equal(detectCover(await readEpub(out))?.path, "OEBPS/images/cover.png");
});

test("cover writes refuse symlink outputs that resolve to the source EPUB even when forced", async () => {
  const dir = await tempDir();
  const book = path.join(dir, "cover-output-source-symlink.epub");
  const replacement = path.join(dir, "replacement.png");
  const out = path.join(dir, "linked-source-output.epub");
  await createEpub3(book, { title: "Cover Output Source Symlink" });
  await writeFile(replacement, tinyPng);
  await symlink(book, out);
  const before = await readFile(book);

  await assert.rejects(
    () => replaceCover(book, replacement, { output: out, force: true }),
    /cover output cannot overwrite input EPUB/
  );
  assert.deepEqual(await readFile(book), before);
  assert.equal((await readInfo(book)).metadata.title, "Cover Output Source Symlink");
});

test("cover writes refuse hardlink outputs that share the source EPUB inode even when forced", async () => {
  const dir = await tempDir();
  const book = path.join(dir, "cover-output-source-hardlink.epub");
  const replacement = path.join(dir, "replacement.png");
  const out = path.join(dir, "hardlinked-source-output.epub");
  await createEpub3(book, { title: "Cover Output Source Hardlink" });
  await writeFile(replacement, tinyPng);
  await link(book, out);
  const before = await readFile(book);

  await assert.rejects(
    () => replaceCover(book, replacement, { output: out, force: true }),
    /cover output cannot overwrite input EPUB/
  );
  assert.deepEqual(await readFile(book), before);
  assert.equal((await readInfo(book)).metadata.title, "Cover Output Source Hardlink");
});

test("refuses broken symlink cover outputs without writing outside output path", async () => {
  const dir = await tempDir();
  const book = path.join(dir, "cover-output-symlink.epub");
  const replacement = path.join(dir, "replacement.png");
  const out = path.join(dir, "linked-output.epub");
  const escapedTarget = path.join(dir, "escaped-cover-output.epub");
  await createEpub3(book, { title: "Cover Output Symlink" });
  await writeFile(replacement, tinyPng);
  await symlink(escapedTarget, out);

  await assert.rejects(
    () => replaceCover(book, replacement, { output: out }),
    /Refusing to overwrite existing file/
  );
  await assert.rejects(() => readFile(escapedTarget), { code: "ENOENT" });
});

test("refuses forced broken symlink cover outputs without writing outside output path", async () => {
  const dir = await tempDir();
  const book = path.join(dir, "cover-output-forced-symlink.epub");
  const replacement = path.join(dir, "replacement.png");
  const out = path.join(dir, "linked-forced-output.epub");
  const escapedTarget = path.join(dir, "escaped-forced-cover-output.epub");
  await createEpub3(book, { title: "Cover Output Forced Symlink" });
  await writeFile(replacement, tinyPng);
  await symlink(escapedTarget, out);

  await assert.rejects(
    () => replaceCover(book, replacement, { output: out, force: true }),
    /symbolic link/
  );
  await assert.rejects(() => readFile(escapedTarget), { code: "ENOENT" });
});

test("replaces cover outside the OPF directory with an OPF-relative href", async () => {
  const dir = await tempDir();
  const book = path.join(dir, "outside-cover.epub");
  const replacement = path.join(dir, "replacement.png");
  await createEpub3WithCoverOutsideOpfDir(book);
  await writeFile(replacement, tinyPng);

  await replaceCover(book, replacement);

  const epub = await readEpub(book);
  const opf = archiveText(epub, "OEBPS/package.opf");
  assert.match(opf, /href="\.\.\/Images\/cover\.png"/);
  assert.equal((await readInfo(book)).coverPath, "Images/cover.png");
  assert.equal(detectCover(epub)?.path, "Images/cover.png");
});

test("percent-encodes cover hrefs before writing OPF metadata", async () => {
  const dir = await tempDir();
  const book = path.join(dir, "escaped-cover.epub");
  const replacement = path.join(dir, "replacement.png");
  await createEpub3WithEscapedCoverHref(book);
  await writeFile(replacement, tinyPng);

  assert.equal(detectCover(await readEpub(book))?.path, "OEBPS/images/cover#1.png");

  await replaceCover(book, replacement);

  const epub = await readEpub(book);
  const opf = archiveText(epub, "OEBPS/package.opf");
  assert.equal(detectCover(epub)?.path, "OEBPS/images/cover#1.png");
  assert.match(opf, /href="images\/cover%231\.png"/);
  assert.doesNotMatch(opf, /href="images\/cover#1\.png"/);
});

test("does not treat arbitrary images as existing covers", async () => {
  const dir = await tempDir();
  const book = path.join(dir, "no-cover.epub");
  const replacement = path.join(dir, "replacement.png");
  await createEpub3WithOrdinaryImageOnly(book);
  await writeFile(replacement, tinyPng);

  const before = await readEpub(book);
  assert.equal(detectCover(before), undefined);

  await assert.rejects(() => replaceCover(book, replacement), /No existing cover image found/);
  assert.deepEqual(Buffer.from((await readEpub(book)).files.get("OEBPS/images/figure.png")), Buffer.from([1, 2, 3, 4]));

  const cover = await setCover(book, replacement);
  const after = await readEpub(book);
  assert.equal(cover.path, "OEBPS/images/cover.png");
  assert.deepEqual(Buffer.from(after.files.get("OEBPS/images/figure.png")), Buffer.from([1, 2, 3, 4]));
  assert.equal(detectCover(after)?.path, "OEBPS/images/cover.png");
});

test("setCover reuses stale cover manifest entries at the target href", async () => {
  const dir = await tempDir();
  const book = path.join(dir, "stale-cover-manifest.epub");
  const replacement = path.join(dir, "replacement.png");
  await createEpub3WithStaleCoverManifest(book);
  await writeFile(replacement, tinyPng);

  assert.equal(detectCover(await readEpub(book)), undefined);

  const cover = await setCover(book, replacement);
  const epub = await readEpub(book);
  const opf = archiveText(epub, "OEBPS/package.opf");
  const coverHrefMatches = opf.match(/href="images\/cover\.png"/g) ?? [];
  const coverPropertyMatches = opf.match(/properties="[^"]*\bcover-image\b[^"]*"/g) ?? [];
  assert.equal(cover.id, "cover-image");
  assert.equal(cover.path, "OEBPS/images/cover.png");
  assert.equal(coverHrefMatches.length, 1);
  assert.equal(coverPropertyMatches.length, 1);
  assert.equal(detectCover(epub)?.id, "cover-image");
  assert.deepEqual(Buffer.from(epub.files.get("OEBPS/images/cover.png")), Buffer.from(tinyPng));
});

test("setCover does not reuse a non-cover manifest item id", async () => {
  const dir = await tempDir();
  const book = path.join(dir, "cover-page-id.epub");
  const replacement = path.join(dir, "replacement.png");
  await createEpub3WithCoverImageIdOnSpine(book);
  await writeFile(replacement, tinyPng);

  assert.equal(detectCover(await readEpub(book)), undefined);

  const cover = await setCover(book, replacement);
  const epub = await readEpub(book);
  const opf = archiveText(epub, "OEBPS/package.opf");
  assert.equal(cover.id, "cover-image-2");
  assert.equal(cover.path, "OEBPS/images/cover.png");
  assert.match(opf, /<item[^>]*id="cover-image"[^>]*href="cover\.xhtml"[^>]*media-type="application\/xhtml\+xml"/);
  assert.match(opf, /<itemref[^>]*idref="cover-image"/);
  assert.match(opf, /<item[^>]*id="cover-image-2"[^>]*href="images\/cover\.png"[^>]*media-type="image\/png"[^>]*properties="cover-image"/);
  assert.equal(detectCover(epub)?.id, "cover-image-2");
});

test("does not match cover inside unrelated image names", async () => {
  const dir = await tempDir();
  const book = path.join(dir, "discover-image.epub");
  const replacement = path.join(dir, "replacement.png");
  await createEpub3WithDiscoverImageOnly(book);
  await writeFile(replacement, tinyPng);

  const before = await readEpub(book);
  assert.equal(detectCover(before), undefined);

  await assert.rejects(() => replaceCover(book, replacement), /No existing cover image found/);
  assert.deepEqual(Buffer.from((await readEpub(book)).files.get("OEBPS/images/discover.png")), Buffer.from([4, 3, 2, 1]));

  const cover = await setCover(book, replacement);
  const after = await readEpub(book);
  assert.equal(cover.path, "OEBPS/images/cover.png");
  assert.deepEqual(Buffer.from(after.files.get("OEBPS/images/discover.png")), Buffer.from([4, 3, 2, 1]));
  assert.equal(detectCover(after)?.path, "OEBPS/images/cover.png");
});

test("detects EPUB 2 guide covers with URL fragments", async () => {
  const dir = await tempDir();
  const book = path.join(dir, "guide-fragment.epub");
  await createEpub2WithGuideCoverFragment(book);

  const cover = detectCover(await readEpub(book));
  assert.equal(cover?.path, "OPS/images/front.png");
  assert.deepEqual(Buffer.from(cover?.data ?? []), Buffer.from([9, 8, 7]));
});

test("prefers EPUB 2 guide covers before filename heuristics", async () => {
  const dir = await tempDir();
  const book = path.join(dir, "guide-before-heuristic.epub");
  await createEpub2WithGuideCoverAndHeuristicCover(book);

  const cover = detectCover(await readEpub(book));
  assert.equal(cover?.path, "OPS/images/front.png");
  assert.deepEqual(Buffer.from(cover?.data ?? []), Buffer.from([9, 8, 7]));
});

test("detects EPUB 2 guide fragments that target the cover image directly", async () => {
  const dir = await tempDir();
  const book = path.join(dir, "guide-image-fragment.epub");
  await createEpub2WithGuideCoverImageFragment(book);

  const cover = detectCover(await readEpub(book));
  assert.equal(cover?.path, "OPS/images/front.png");
  assert.deepEqual(Buffer.from(cover?.data ?? []), Buffer.from([9, 8, 7]));
});

test("detects EPUB 2 guide covers that point directly to an image", async () => {
  const dir = await tempDir();
  const book = path.join(dir, "guide-direct-image.epub");
  await createEpub2WithGuideCoverDirectImage(book);

  const cover = detectCover(await readEpub(book));
  assert.equal(cover?.path, "OPS/images/front.png");
  assert.deepEqual(Buffer.from(cover?.data ?? []), Buffer.from([9, 8, 7]));
});

test("skips non-image EPUB 2 meta cover targets so guide can resolve cover image", async () => {
  const dir = await tempDir();
  const book = path.join(dir, "meta-cover-page.epub");
  const extracted = path.join(dir, "front.png");
  const replacement = path.join(dir, "replacement.png");
  await createEpub2WithMetaCoverPageAndGuideImage(book);
  await writeFile(replacement, tinyPng);

  const cover = detectCover(await readEpub(book));
  assert.equal(cover?.path, "OPS/images/front.png");
  assert.deepEqual(Buffer.from(cover?.data ?? []), Buffer.from([9, 8, 7]));

  await extractCover(book, extracted);
  assert.deepEqual(await readFile(extracted), Buffer.from([9, 8, 7]));

  await replaceCover(book, replacement);
  const updated = await readEpub(book);
  assert.deepEqual(Buffer.from(updated.files.get("OPS/images/front.png")), Buffer.from(tinyPng));
  assert.match(archiveText(updated, "OPS/jacket.xhtml"), /<img src="images\/front\.png"/);
});

test("rejects merging mixed EPUB versions", async () => {
  const dir = await tempDir();
  const epub2 = path.join(dir, "two.epub");
  const epub3 = path.join(dir, "three.epub");
  await createEpub2(epub2);
  await createEpub3(epub3);
  await assert.rejects(() => mergeEpubs([epub2, epub3], { output: path.join(dir, "bad.epub") }), /same EPUB version/);
});

async function createEpub3WithResourceOutsideOpfDir(filePath) {
  await writeEpubArchive(
    {
      mimetype: "application/epub+zip",
      "META-INF/container.xml": `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
      "OEBPS/content/package.opf": `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:identifier id="book-id">urn:uuid:outside-opf-dir</dc:identifier>
    <dc:title>Outside OPF Dir</dc:title>
    <dc:creator opf:role="aut">Path Author</dc:creator>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="chapter" href="../shared/chapter.xhtml" media-type="application/xhtml+xml"/>
    <item id="style" href="../shared/style.css" media-type="text/css"/>
  </manifest>
  <spine>
    <itemref idref="chapter"/>
  </spine>
</package>`,
      "OEBPS/content/nav.xhtml": `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head><title>Outside OPF Dir</title></head>
  <body><nav epub:type="toc"><ol><li><a href="../shared/chapter.xhtml">Outside Chapter</a></li></ol></nav></body>
</html>`,
      "OEBPS/shared/chapter.xhtml": `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Outside Chapter</title><link href="style.css" rel="stylesheet" type="text/css"/></head>
  <body><h1>Outside Chapter</h1><p>Outside the OPF directory.</p></body>
</html>`,
      "OEBPS/shared/style.css": "body { color: #222; }"
    },
    filePath
  );
}

async function createEpub3WithManifestIdrefsAndSpineProperties(filePath) {
  await writeEpubArchive(
    {
      mimetype: "application/epub+zip",
      "META-INF/container.xml": `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
      "OEBPS/package.opf": `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:manifest-idrefs</dc:identifier>
    <dc:title>Manifest IDREFs</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="page" href="page.xhtml" media-type="application/xhtml+xml" media-overlay="mo"/>
    <item id="mo" href="page.smil" media-type="application/smil+xml"/>
    <item id="vector" href="images/diagram.svg" media-type="image/svg+xml" fallback="raster"/>
    <item id="raster" href="images/diagram.png" media-type="image/png"/>
    <item id="fancy" href="style.css" media-type="text/css" fallback-style="plain"/>
    <item id="plain" href="plain.css" media-type="text/css"/>
  </manifest>
  <spine>
    <itemref idref="page" properties="page-spread-left"/>
  </spine>
</package>`,
      "OEBPS/nav.xhtml": `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head><title>Manifest IDREFs</title></head>
  <body><nav epub:type="toc"><ol><li><a href="page.xhtml">Page</a></li></ol></nav></body>
</html>`,
      "OEBPS/page.xhtml": `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Page</title><link href="style.css" rel="stylesheet" type="text/css"/></head>
  <body><h1>Page</h1><img src="images/diagram.svg"/></body>
</html>`,
      "OEBPS/page.smil": `<?xml version="1.0" encoding="UTF-8"?>
<smil xmlns="http://www.w3.org/ns/SMIL"><body><seq><text src="page.xhtml"/></seq></body></smil>`,
      "OEBPS/images/diagram.svg": `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>`,
      "OEBPS/images/diagram.png": tinyPng,
      "OEBPS/style.css": "body { writing-mode: horizontal-tb; }",
      "OEBPS/plain.css": "body { color: black; }"
    },
    filePath
  );
}

async function createEpub3WithPageProgression(filePath, title, direction) {
  await writeEpubArchive(
    {
      mimetype: "application/epub+zip",
      "META-INF/container.xml": `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
      "OEBPS/package.opf": `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:${title.replace(/\W+/g, "-")}</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine page-progression-direction="${direction}">
    <itemref idref="chapter"/>
  </spine>
</package>`,
      "OEBPS/nav.xhtml": `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head><title>${title}</title></head>
  <body><nav epub:type="toc"><ol><li><a href="chapter.xhtml">${title}</a></li></ol></nav></body>
</html>`,
      "OEBPS/chapter.xhtml": `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head><body><h1>${title}</h1></body></html>`
    },
    filePath
  );
}

async function createEpub3WithNavOnlySpine(filePath, title) {
  await writeEpubArchive(
    {
      mimetype: "application/epub+zip",
      "META-INF/container.xml": `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
      "OEBPS/package.opf": `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:${title.replace(/\W+/g, "-")}</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
  </manifest>
  <spine>
    <itemref idref="nav"/>
  </spine>
</package>`,
      "OEBPS/nav.xhtml": `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head><title>${title}</title></head>
  <body>
    <nav epub:type="toc"><ol><li><a href="nav.xhtml">${title}</a></li></ol></nav>
    <h1>${title}</h1>
  </body>
</html>`
    },
    filePath
  );
}

async function createEpub3WithChapterLinkToManifestNav(filePath) {
  await writeEpubArchive(
    {
      mimetype: "application/epub+zip",
      "META-INF/container.xml": `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
      "OEBPS/package.opf": `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:linked-nav</dc:identifier>
    <dc:title>Linked Nav</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="chapter"/>
  </spine>
</package>`,
      "OEBPS/nav.xhtml": `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head><title>Linked Nav</title></head>
  <body><nav epub:type="toc"><ol><li><a href="chapter.xhtml">Chapter</a></li></ol></nav></body>
</html>`,
      "OEBPS/chapter.xhtml": `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter</title></head><body><h1>Chapter</h1><a href="nav.xhtml">Contents</a></body></html>`
    },
    filePath
  );
}

async function createEpub3WithNcxFallback(filePath) {
  await writeEpubArchive(
    {
      mimetype: "application/epub+zip",
      "META-INF/container.xml": `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
      "OEBPS/package.opf": `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:ncx-fallback</dc:identifier>
    <dc:title>NCX Fallback</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="chapter"/>
  </spine>
</package>`,
      "OEBPS/nav.xhtml": `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head><title>NCX Fallback</title></head>
  <body><nav epub:type="toc"><ol><li><a href="chapter.xhtml">Chapter</a></li></ol></nav></body>
</html>`,
      "OEBPS/toc.ncx": `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head></head>
  <docTitle><text>NCX Fallback</text></docTitle>
  <navMap><navPoint id="chapter" playOrder="1"><navLabel><text>Chapter</text></navLabel><content src="chapter.xhtml"/></navPoint></navMap>
</ncx>`,
      "OEBPS/chapter.xhtml": `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter</title></head><body><h1>Chapter</h1></body></html>`
    },
    filePath
  );
}

async function createEpub3WithEncryptedFont(filePath, algorithm = "http://www.w3.org/2001/04/xmlenc#aes128-cbc") {
  await writeEpubArchive(
    {
      mimetype: "application/epub+zip",
      "META-INF/container.xml": `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
      "META-INF/encryption.xml": `<?xml version="1.0" encoding="UTF-8"?>
<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#">
    <EncryptionMethod Algorithm="${algorithm}"/>
    <CipherData>
      <CipherReference URI="OEBPS/fonts/font.otf"/>
    </CipherData>
  </EncryptedData>
</encryption>`,
      "OEBPS/package.opf": `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:encrypted-font</dc:identifier>
    <dc:title>Encrypted Font</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
    <item id="font" href="fonts/font.otf" media-type="font/otf"/>
  </manifest>
  <spine>
    <itemref idref="chapter"/>
  </spine>
</package>`,
      "OEBPS/chapter.xhtml": `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter</title></head><body><h1>Chapter</h1></body></html>`,
      "OEBPS/fonts/font.otf": new Uint8Array([1, 2, 3, 4])
    },
    filePath
  );
}

async function createEpub3WithObfuscatedFont(filePath) {
  await createEpub3WithEncryptedFont(filePath, "http://www.idpf.org/2008/embedding");
}

async function createEpub3WithObfuscatedFontAndIsbnUniqueIdentifier(filePath) {
  await writeEpubArchive(
    {
      mimetype: "application/epub+zip",
      "META-INF/container.xml": `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
      "META-INF/encryption.xml": `<?xml version="1.0" encoding="UTF-8"?>
<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#">
    <EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/>
    <CipherData>
      <CipherReference URI="OEBPS/fonts/font.otf"/>
    </CipherData>
  </EncryptedData>
</encryption>`,
      "OEBPS/package.opf": `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="isbn">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:identifier id="isbn" opf:scheme="ISBN">9781234567890</dc:identifier>
    <dc:title>Obfuscated Unique ISBN</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
    <item id="font" href="fonts/font.otf" media-type="font/otf"/>
  </manifest>
  <spine>
    <itemref idref="chapter"/>
  </spine>
</package>`,
      "OEBPS/chapter.xhtml": `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter</title></head><body><h1>Chapter</h1></body></html>`,
      "OEBPS/fonts/font.otf": new Uint8Array([1, 2, 3, 4])
    },
    filePath
  );
}

async function createEpub3WithEscapedEncryptedFont(filePath) {
  await writeEpubArchive(
    {
      mimetype: "application/epub+zip",
      "META-INF/container.xml": `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
      "META-INF/encryption.xml": `<?xml version="1.0" encoding="UTF-8"?>
<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#">
    <EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/>
    <CipherData>
      <CipherReference URI="OEBPS/fonts/font%231.otf"/>
    </CipherData>
  </EncryptedData>
</encryption>`,
      "OEBPS/package.opf": `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:escaped-encrypted-font</dc:identifier>
    <dc:title>Escaped Encrypted Font</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
    <item id="font" href="fonts/font%231.otf" media-type="font/otf"/>
  </manifest>
  <spine>
    <itemref idref="chapter"/>
  </spine>
</package>`,
      "OEBPS/chapter.xhtml": `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter</title></head><body><h1>Chapter</h1></body></html>`,
      "OEBPS/fonts/font#1.otf": new Uint8Array([1, 2, 3, 4])
    },
    filePath
  );
}

async function createEpub3WithEncodedReservedHref(filePath) {
  await writeEpubArchive(
    {
      mimetype: "application/epub+zip",
      "META-INF/container.xml": `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
      "OEBPS/package.opf": `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:encoded-href</dc:identifier>
    <dc:title>Encoded Href</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="chapter" href="chapter%231.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="chapter"/>
  </spine>
</package>`,
      "OEBPS/chapter#1.xhtml": `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter Hash</title></head><body><h1>Chapter Hash</h1></body></html>`
    },
    filePath
  );
}

async function createEpub3WithIsbnUniqueIdentifierAndCreatorTranslator(filePath) {
  await writeEpubArchive(
    {
      mimetype: "application/epub+zip",
      "META-INF/container.xml": `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
      "OEBPS/package.opf": `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="isbn">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:identifier id="isbn" opf:scheme="ISBN">9781234567890</dc:identifier>
    <dc:title>Unique ISBN</dc:title>
    <dc:language>en</dc:language>
    <dc:creator opf:role="trl">Old Translator</dc:creator>
  </metadata>
  <manifest>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="chapter"/>
  </spine>
</package>`,
      "OEBPS/chapter.xhtml": `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter</title></head><body><h1>Chapter</h1></body></html>`
    },
    filePath
  );
}

async function createEpub3WithNonIsbnEpubkitIsbnUniqueIdentifier(filePath) {
  await writeEpubArchive(
    {
      mimetype: "application/epub+zip",
      "META-INF/container.xml": `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
      "OEBPS/package.opf": `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="epubkit-isbn">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="epubkit-isbn">catalog-id</dc:identifier>
    <dc:title>Catalog Unique Identifier</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="chapter"/>
  </spine>
</package>`,
      "OEBPS/chapter.xhtml": `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter</title></head><body><h1>Chapter</h1></body></html>`
    },
    filePath
  );
}

async function createEpub3WithCoverOutsideOpfDir(filePath) {
  await writeEpubArchive(
    {
      mimetype: "application/epub+zip",
      "META-INF/container.xml": `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
      "OEBPS/package.opf": `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:outside-cover</dc:identifier>
    <dc:title>Outside Cover</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
    <item id="cover-image" href="../Images/cover.png" media-type="image/png" properties="cover-image"/>
  </manifest>
  <spine>
    <itemref idref="chapter"/>
  </spine>
</package>`,
      "OEBPS/chapter.xhtml": `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter</title></head><body><h1>Chapter</h1></body></html>`,
      "Images/cover.png": tinyPng
    },
    filePath
  );
}

async function createEpub3WithEscapedCoverHref(filePath) {
  await writeEpubArchive(
    {
      mimetype: "application/epub+zip",
      "META-INF/container.xml": `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
      "OEBPS/package.opf": `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:escaped-cover</dc:identifier>
    <dc:title>Escaped Cover</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
    <item id="cover-image" href="images/cover%231.png" media-type="image/png" properties="cover-image"/>
  </manifest>
  <spine>
    <itemref idref="chapter"/>
  </spine>
</package>`,
      "OEBPS/chapter.xhtml": `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter</title></head><body><h1>Chapter</h1></body></html>`,
      "OEBPS/images/cover#1.png": new Uint8Array([1, 2, 3, 4])
    },
    filePath
  );
}

async function createEpub3WithOrdinaryImageOnly(filePath) {
  await writeEpubArchive(
    {
      mimetype: "application/epub+zip",
      "META-INF/container.xml": `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
      "OEBPS/package.opf": `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:no-cover</dc:identifier>
    <dc:title>No Cover</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
    <item id="fig1" href="images/figure.png" media-type="image/png"/>
  </manifest>
  <spine>
    <itemref idref="chapter"/>
  </spine>
</package>`,
      "OEBPS/chapter.xhtml": `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter</title></head><body><img src="images/figure.png"/></body></html>`,
      "OEBPS/images/figure.png": new Uint8Array([1, 2, 3, 4])
    },
    filePath
  );
}

async function createEpub3WithCoverImageIdOnSpine(filePath) {
  await writeEpubArchive(
    {
      mimetype: "application/epub+zip",
      "META-INF/container.xml": `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
      "OEBPS/package.opf": `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:cover-page-id</dc:identifier>
    <dc:title>Cover Page ID</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="cover-image" href="cover.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="cover-image"/>
  </spine>
</package>`,
      "OEBPS/cover.xhtml": `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Cover Page</title></head><body><h1>Cover Page</h1></body></html>`
    },
    filePath
  );
}

async function createEpub3WithStaleCoverManifest(filePath) {
  await writeEpubArchive(
    {
      mimetype: "application/epub+zip",
      "META-INF/container.xml": `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
      "OEBPS/package.opf": `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:stale-cover</dc:identifier>
    <dc:title>Stale Cover</dc:title>
    <dc:language>en</dc:language>
    <meta name="cover" content="cover-image"/>
  </metadata>
  <manifest>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
    <item id="cover-image" href="images/cover.png" media-type="image/png" properties="cover-image"/>
  </manifest>
  <spine>
    <itemref idref="chapter"/>
  </spine>
</package>`,
      "OEBPS/chapter.xhtml": `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter</title></head><body><h1>Chapter</h1></body></html>`
    },
    filePath
  );
}

async function createEpub3WithDiscoverImageOnly(filePath) {
  await writeEpubArchive(
    {
      mimetype: "application/epub+zip",
      "META-INF/container.xml": `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
      "OEBPS/package.opf": `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:discover-image</dc:identifier>
    <dc:title>Discover Image</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
    <item id="discover-map" href="images/discover.png" media-type="image/png"/>
  </manifest>
  <spine>
    <itemref idref="chapter"/>
  </spine>
</package>`,
      "OEBPS/chapter.xhtml": `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter</title></head><body><img src="images/discover.png"/></body></html>`,
      "OEBPS/images/discover.png": new Uint8Array([4, 3, 2, 1])
    },
    filePath
  );
}

async function createEpub2WithGuideCoverFragment(filePath) {
  await writeEpubArchive(
    {
      mimetype: "application/epub+zip",
      "META-INF/container.xml": `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
      "OPS/content.opf": `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:guide-fragment</dc:identifier>
    <dc:title>Guide Fragment</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
    <item id="page" href="jacket.xhtml" media-type="application/xhtml+xml"/>
    <item id="fig" href="images/figure.png" media-type="image/png"/>
    <item id="front-art" href="images/front.png" media-type="image/png"/>
  </manifest>
  <spine>
    <itemref idref="chapter"/>
  </spine>
  <guide>
    <reference type="cover" href="jacket.xhtml#cover"/>
  </guide>
</package>`,
      "OPS/chapter.xhtml": `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter</title></head><body><img src="images/figure.png"/></body></html>`,
      "OPS/jacket.xhtml": `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Jacket</title></head><body><img src="images/figure.png"/><div id="cover"><img src="images/front.png"/></div></body></html>`,
      "OPS/images/figure.png": new Uint8Array([1, 2, 3]),
      "OPS/images/front.png": new Uint8Array([9, 8, 7])
    },
    filePath
  );
}

async function createEpub2WithGuideCoverAndHeuristicCover(filePath) {
  await writeEpubArchive(
    {
      mimetype: "application/epub+zip",
      "META-INF/container.xml": `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
      "OPS/content.opf": `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:guide-before-heuristic</dc:identifier>
    <dc:title>Guide Before Heuristic</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
    <item id="cover-decoy" href="images/not-cover.png" media-type="image/png"/>
    <item id="front-art" href="images/front.png" media-type="image/png"/>
  </manifest>
  <spine>
    <itemref idref="chapter"/>
  </spine>
  <guide>
    <reference type="cover" href="images/front.png"/>
  </guide>
</package>`,
      "OPS/chapter.xhtml": `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter</title></head><body><img src="images/not-cover.png"/></body></html>`,
      "OPS/images/not-cover.png": new Uint8Array([1, 2, 3]),
      "OPS/images/front.png": new Uint8Array([9, 8, 7])
    },
    filePath
  );
}

async function createEpub2WithGuideCoverImageFragment(filePath) {
  await writeEpubArchive(
    {
      mimetype: "application/epub+zip",
      "META-INF/container.xml": `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
      "OPS/content.opf": `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:guide-image-fragment</dc:identifier>
    <dc:title>Guide Image Fragment</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
    <item id="page" href="jacket.xhtml" media-type="application/xhtml+xml"/>
    <item id="fig" href="images/figure.png" media-type="image/png"/>
    <item id="front-art" href="images/front.png" media-type="image/png"/>
  </manifest>
  <spine>
    <itemref idref="chapter"/>
  </spine>
  <guide>
    <reference type="cover" href="jacket.xhtml#cover-img"/>
  </guide>
</package>`,
      "OPS/chapter.xhtml": `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter</title></head><body><img src="images/figure.png"/></body></html>`,
      "OPS/jacket.xhtml": `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Jacket</title></head><body><img src="images/figure.png"/><img id="cover-img" src="images/front.png"/></body></html>`,
      "OPS/images/figure.png": new Uint8Array([1, 2, 3]),
      "OPS/images/front.png": new Uint8Array([9, 8, 7])
    },
    filePath
  );
}

async function createEpub2WithGuideCoverDirectImage(filePath) {
  await writeEpubArchive(
    {
      mimetype: "application/epub+zip",
      "META-INF/container.xml": `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
      "OPS/content.opf": `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:guide-direct-image</dc:identifier>
    <dc:title>Guide Direct Image</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
    <item id="fig" href="images/figure.png" media-type="image/png"/>
    <item id="front-art" href="images/front.png" media-type="image/png"/>
  </manifest>
  <spine>
    <itemref idref="chapter"/>
  </spine>
  <guide>
    <reference type="cover" href="images/front.png"/>
  </guide>
</package>`,
      "OPS/chapter.xhtml": `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter</title></head><body><img src="images/figure.png"/></body></html>`,
      "OPS/images/figure.png": new Uint8Array([1, 2, 3]),
      "OPS/images/front.png": new Uint8Array([9, 8, 7])
    },
    filePath
  );
}

async function createEpub2WithMetaCoverPageAndGuideImage(filePath) {
  await writeEpubArchive(
    {
      mimetype: "application/epub+zip",
      "META-INF/container.xml": `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
      "OPS/content.opf": `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:meta-cover-page</dc:identifier>
    <dc:title>Meta Cover Page</dc:title>
    <dc:language>en</dc:language>
    <meta name="cover" content="cover-page"/>
  </metadata>
  <manifest>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
    <item id="cover-page" href="jacket.xhtml" media-type="application/xhtml+xml"/>
    <item id="front-art" href="images/front.png" media-type="image/png"/>
  </manifest>
  <spine>
    <itemref idref="chapter"/>
  </spine>
  <guide>
    <reference type="cover" href="jacket.xhtml"/>
  </guide>
</package>`,
      "OPS/chapter.xhtml": `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter</title></head><body><h1>Chapter</h1></body></html>`,
      "OPS/jacket.xhtml": `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Jacket</title></head><body><img src="images/front.png"/></body></html>`,
      "OPS/images/front.png": new Uint8Array([9, 8, 7])
    },
    filePath
  );
}

async function createMergedRestoreFixture(filePath) {
  await writeEpubArchive(
    {
      mimetype: "application/epub+zip",
      "META-INF/container.xml": `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
      "EPUB/package.opf": `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:restore-fixture</dc:identifier>
    <dc:title>Restore Fixture</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest/>
  <spine/>
</package>`,
      "EPUB/epubkit/manifest.json": JSON.stringify(
        {
          tool: "epubkit",
          version: 1,
          originals: [
            { fileName: "bad:name.epub", archivePath: "EPUB/epubkit/originals/001.epub" },
            { fileName: "bad?name.epub", archivePath: "EPUB/epubkit/originals/002.epub" }
          ]
        },
        null,
        2
      ),
      "EPUB/epubkit/originals/001.epub": "first original",
      "EPUB/epubkit/originals/002.epub": "second original"
    },
    filePath
  );
}

async function createEpubWithMultipleRootfiles(filePath) {
  await writeEpubArchive(
    {
      mimetype: "application/epub+zip",
      "META-INF/container.xml": `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="META-INF/not-package.xml" media-type="application/xml"/>
    <rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
      "META-INF/not-package.xml": `<?xml version="1.0" encoding="UTF-8"?><not-package/>`,
      "OEBPS/package.opf": minimalPackageOpf("Package Rootfile")
    },
    filePath
  );
}

async function createEpubWithGenericRootfile(filePath) {
  await writeEpubArchive(
    {
      mimetype: "application/epub+zip",
      "META-INF/container.xml": `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OPS/content.opf"/>
  </rootfiles>
</container>`,
      "OPS/content.opf": minimalPackageOpf("Generic Rootfile")
    },
    filePath
  );
}

function minimalPackageOpf(title) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:${title.replace(/\W+/g, "-")}</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest/>
  <spine/>
</package>`;
}

function archiveText(epub, filePath) {
  const data = epub.files.get(filePath);
  assert.ok(data, `Expected ${filePath} in archive`);
  return Buffer.from(data).toString("utf8");
}

function assertTextOrder(text, first, second) {
  const firstIndex = text.indexOf(first);
  const secondIndex = text.indexOf(second);
  assert.notEqual(firstIndex, -1, `Expected ${first}`);
  assert.notEqual(secondIndex, -1, `Expected ${second}`);
  assert.ok(firstIndex < secondIndex, `Expected ${first} before ${second}`);
}

function firstZipEntryName(archive) {
  assert.equal(archive[0], 0x50);
  assert.equal(archive[1], 0x4b);
  assert.equal(archive[2], 0x03);
  assert.equal(archive[3], 0x04);
  const nameLength = archive[26] | (archive[27] << 8);
  return Buffer.from(archive.subarray(30, 30 + nameLength)).toString("utf8");
}

import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeEpubArchive } from "../dist/index.js";

export async function tempDir(prefix = "epubkit-") {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

export const tinyPng = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82
]);

export async function createEpub3(filePath, options = {}) {
  const title = options.title ?? "Example Book";
  const author = options.author ?? "Example Author";
  const language = options.language ?? "en";
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
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:identifier id="book-id">urn:uuid:test-${title.replace(/\W+/g, "-")}</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:creator opf:role="aut" opf:file-as="${author.split(" ").reverse().join(", ")}">${author}</dc:creator>
    <dc:subject>Fiction</dc:subject>
    <dc:description><![CDATA[Line one
Line two]]></dc:description>
    <dc:publisher>Fixture Press</dc:publisher>
    <dc:language>${language}</dc:language>
    <dc:rights>All rights reserved</dc:rights>
    <dc:identifier id="isbn" opf:scheme="ISBN">9781234567890</dc:identifier>
    <dc:date opf:event="publication">2024-01-02</dc:date>
    <meta property="dcterms:modified">2024-01-03T00:00:00Z</meta>
    <meta name="cover" content="cover-image"/>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
    <item id="style" href="style.css" media-type="text/css"/>
    <item id="cover-image" href="images/cover.png" media-type="image/png" properties="cover-image"/>
  </manifest>
  <spine>
    <itemref idref="chapter"/>
  </spine>
</package>`,
      "OEBPS/nav.xhtml": `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head><title>${title}</title></head>
  <body><nav epub:type="toc"><ol><li><a href="chapter.xhtml">Chapter One</a></li></ol></nav></body>
</html>`,
      "OEBPS/chapter.xhtml": `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Chapter One</title><link href="style.css" rel="stylesheet" type="text/css"/></head>
  <body><h1>${options.heading ?? "Chapter One"}</h1><p>${title}</p><img src="images/cover.png"/></body>
</html>`,
      "OEBPS/style.css": "body { font-family: serif; }",
      "OEBPS/images/cover.png": tinyPng
    },
    filePath
  );
}

export async function createEpub2(filePath, options = {}) {
  const title = options.title ?? "Example EPUB 2";
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
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:identifier id="book-id">urn:uuid:epub2</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:creator opf:role="aut">Author Two</dc:creator>
    <dc:language>en</dc:language>
    <meta name="cover" content="cover"/>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
    <item id="cover" href="cover.jpg" media-type="image/jpeg"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="chapter"/>
  </spine>
</package>`,
      "OPS/toc.ncx": `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head></head>
  <docTitle><text>${title}</text></docTitle>
  <navMap><navPoint id="chapter" playOrder="1"><navLabel><text>Chapter</text></navLabel><content src="chapter.xhtml"/></navPoint></navMap>
</ncx>`,
      "OPS/chapter.xhtml": `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>EPUB 2 Chapter</title></head><body><h1>EPUB 2 Chapter</h1></body></html>`,
      "OPS/cover.jpg": new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
    },
    filePath
  );
}

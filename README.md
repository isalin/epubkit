# epubkit

[![npm version](https://img.shields.io/npm/v/@isalin/epubkit.svg)](https://www.npmjs.com/package/@isalin/epubkit)
[![CI](https://github.com/isalin/epubkit/actions/workflows/ci.yml/badge.svg)](https://github.com/isalin/epubkit/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/node/v/@isalin/epubkit.svg)](https://www.npmjs.com/package/@isalin/epubkit)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

`epubkit` is a TypeScript EPUB library and Node.js `epub` command-line tool for inspecting EPUB archives, editing EPUB metadata, merging EPUB 2 and EPUB 3 files, unpacking merged books, and managing cover images.

Use it as an EPUB metadata editor, EPUB merge tool, EPUB cover image utility, EPUB inspector, or JavaScript/TypeScript API for EPUB automation.

## Contents

- [Features](#features)
- [Use Cases](#use-cases)
- [Install](#install)
- [CLI](#cli)
- [Library](#library)
- [API Overview](#api-overview)
- [FAQ](#faq)
- [Project Docs](#project-docs)
- [Safety Notes](#safety-notes)
- [Development](#development)

## Features

- Read EPUB metadata, package information, manifest counts, spine counts, NAV/NCX paths, and cover paths.
- Edit metadata in `.epub` archives or standalone `.opf` package files.
- Merge multiple EPUB 2 or EPUB 3 files into one EPUB with a generated table of contents.
- Unpack EPUBs produced by `epubkit merge` back into their original source files.
- Extract, set, replace, and repair EPUB cover image metadata.
- Use the same EPUB tools from the `epub` CLI or from TypeScript and JavaScript.

## Use Cases

- Edit EPUB metadata from the command line or a Node.js script.
- Merge EPUB files into a combined edition with generated navigation.
- Extract, replace, or repair EPUB cover images and cover metadata.
- Inspect EPUB structure, package paths, manifest entries, spine entries, and navigation files.
- Automate ebook workflows with a typed TypeScript EPUB library.
- Update standalone OPF package metadata without rebuilding a full EPUB archive.

## Install

```sh
npm install @isalin/epubkit
```

For the CLI as a global command:

```sh
npm install -g @isalin/epubkit
```

`epubkit` requires Node.js 20 or newer. The CLI binary is named `epub`.

## CLI

Run `epub` without arguments to show command help.

### Inspect EPUB Files

```sh
epub info book.epub
epub meta book.epub
epub meta book.epub --json
```

`info` shows structural EPUB information. `meta` reads title, contributors, subjects, description, publisher, dates, language, rights, and ISBN metadata.

### Edit EPUB Metadata

```sh
epub meta book.epub -t "New Title"
epub meta book.epub -a "Ada Lovelace--Lovelace, Ada"
epub meta book.epub -r "Example Translator--Translator, Example"
epub meta book.epub -s "Fiction//Adventure" -l en
epub meta book.epub --publisher "Example Press"
epub meta book.epub --description "A short book description."
epub meta book.epub --isbn 9780000000001
epub meta book.epub --rights "All rights reserved"
epub meta book.epub --published 2026-07-04 --modified 2026-07-04T12:00:00Z
```

Contributor values use `Display Name--Sort Name`. Authors, translators, and subjects can be passed with repeated options or separated with `//`.

The metadata editor also works on standalone OPF files:

```sh
epub meta content.opf -t "Updated Package Title"
```

### Merge EPUB Files

```sh
epub merge volume-1.epub volume-2.epub -o combined.epub
epub merge volume-1.epub volume-2.epub -o combined.epub -t "Combined Edition" -l en
epub merge volume-1.epub volume-2.epub -o combined.epub --preserve-order
epub merge volume-1.epub volume-2.epub -o combined.epub --volumes "Book One//Book Two"
epub merge volume-1.epub volume-2.epub -o combined.epub --volume-labels-from-files
epub merge volume-1.epub volume-2.epub -o combined.epub --prefix "Part " --suffix ":"
```

You can also write a derived output name into an existing directory:

```sh
mkdir -p merged
epub merge volume-1.epub volume-2.epub -d merged -n combined-edition
```

### Unpack Merged EPUBs

```sh
epub unpack combined.epub -d restored
epub unpack combined.epub -d restored --force
```

`unpack` restores the original EPUB files stored inside an EPUB created by `epubkit merge`.

### Work With EPUB Covers

```sh
epub cover get book.epub -o cover.jpg
epub cover get book.epub -o cover.jpg --force
epub cover set book.epub cover.jpg
epub cover set book.epub cover.jpg -o updated.epub
epub cover replace book.epub new-cover.jpg
epub cover replace book.epub new-cover.jpg -o updated.epub
epub cover fix book.epub
```

`set` adds or updates cover metadata. `replace` requires an existing cover and swaps the image. `fix` repairs cover metadata for an image that is already present in the EPUB.

## Library

```js
import { readInfo, readMetadata, updateMetadata } from "@isalin/epubkit";

const info = await readInfo("book.epub");
const metadata = await readMetadata("book.epub");

await updateMetadata("book.epub", {
  title: "Updated",
  authors: [{ name: "Ada Lovelace", fileAs: "Lovelace, Ada" }],
  subjects: ["Fiction", "Adventure"],
  language: "en"
});
```

Merge and unpack EPUB files:

```js
import { mergeEpubs, unpackMergedEpub } from "@isalin/epubkit";

await mergeEpubs(["volume-1.epub", "volume-2.epub"], {
  output: "combined.epub",
  title: "Combined Edition",
  language: "en",
  preserveOrder: true,
  volumeLabels: ["Book One", "Book Two"]
});

await unpackMergedEpub("combined.epub", {
  outputDir: "restored"
});
```

Extract and replace EPUB cover images:

```js
import { extractCover, replaceCover } from "@isalin/epubkit";

await extractCover("book.epub", { output: "cover.jpg" });

await replaceCover("book.epub", "new-cover.jpg", {
  output: "updated.epub"
});
```

The package also exports helpers for reading and writing EPUB archives, reading standalone OPF files, detecting covers, applying metadata patches, and working with public TypeScript types such as `EpubMetadata`, `MetadataPatch`, `MergeOptions`, and `CoverInfo`.

## API Overview

- `readInfo`, `readEpub`, and `readStandaloneOpf` inspect EPUB archives and OPF package files.
- `readMetadata`, `readMetadataFromOpf`, `updateMetadata`, and `applyMetadataPatch` read and edit ebook metadata.
- `mergeEpubs` and `unpackMergedEpub` combine EPUB files and restore EPUBs created by `epubkit merge`.
- `detectCover`, `extractCover`, `setCover`, `replaceCover`, and `repairCover` manage EPUB cover images and cover metadata.
- `readArchive`, `readArchiveFile`, `writeArchive`, and `writeArchiveFile` provide lower-level ZIP archive helpers.

## FAQ

### How do I edit EPUB metadata from the command line?

Use `epub meta` with metadata options:

```sh
epub meta book.epub -t "New Title" -a "Author Name" -l en
```

### How do I merge multiple EPUB files?

Use `epub merge` and pass each input EPUB followed by an output path:

```sh
epub merge volume-1.epub volume-2.epub -o combined.epub
```

### Can I use epubkit from TypeScript?

Yes. `@isalin/epubkit` ships TypeScript declarations and exports typed APIs for metadata, EPUB inspection, cover handling, archive helpers, merge options, and EPUB result types.

### Does epubkit work with OPF files?

Yes. `epub meta` and the library metadata helpers can read or update standalone `.opf` package files.

### Does epubkit support EPUB 2 and EPUB 3?

Yes. `epubkit` can inspect and merge EPUB 2 and EPUB 3 files. EPUBs in a single merge must use the same EPUB version.

### Can I replace an EPUB cover image?

Yes. Use `epub cover replace book.epub new-cover.jpg`, or call `replaceCover()` from JavaScript or TypeScript.

## Project Docs

- [Changelog](CHANGELOG.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

## Safety Notes

- Existing output files are not overwritten unless `--force` or `force: true` is used.
- Merge output cannot overwrite one of the input EPUB files.
- EPUBs in a single merge must use the same EPUB version.
- `unpack` only works with restore data written by `epubkit merge`.

## Development

```sh
npm install
npm test
npm run build
```

Publishing is handled by the manual GitHub Actions workflow through npm trusted publishing and the protected `npm-publish` GitHub Environment. Do not add npm publish tokens to this repository.

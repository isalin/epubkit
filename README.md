# epubkit

`epubkit` is a TypeScript EPUB library and Node.js `epub` command-line tool for inspecting, editing, merging, unpacking, and managing EPUB files.

Use it as an EPUB metadata editor, EPUB merge tool, EPUB cover image utility, or a small JavaScript/TypeScript API for EPUB automation.

## Features

- Read EPUB metadata, package information, manifest counts, spine counts, NAV/NCX paths, and cover paths.
- Edit metadata in `.epub` archives or standalone `.opf` package files.
- Merge multiple EPUB 2 or EPUB 3 files into one EPUB with a generated table of contents.
- Unpack EPUBs produced by `epubkit merge` back into their original source files.
- Extract, set, replace, and repair EPUB cover image metadata.
- Use the same EPUB tools from the `epub` CLI or from TypeScript and JavaScript.

## Install

```sh
npm install epubkit
```

For the CLI as a global command:

```sh
npm install -g epubkit
```

`epubkit` requires Node.js 20 or newer.

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
epub cover replace book.epub new-cover.jpg
epub cover replace book.epub new-cover.jpg -o updated.epub
epub cover fix book.epub
```

`set` adds or updates cover metadata. `replace` requires an existing cover and swaps the image. `fix` repairs cover metadata for an image that is already present in the EPUB.

## Library

```js
import { readInfo, readMetadata, updateMetadata } from "epubkit";

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
import { mergeEpubs, unpackMergedEpub } from "epubkit";

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
import { extractCover, replaceCover } from "epubkit";

await extractCover("book.epub", { output: "cover.jpg" });

await replaceCover("book.epub", "new-cover.jpg", {
  output: "updated.epub"
});
```

The package also exports helpers for reading and writing EPUB archives, reading standalone OPF files, detecting covers, applying metadata patches, and working with public TypeScript types such as `EpubMetadata`, `MetadataPatch`, `MergeOptions`, and `CoverInfo`.

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

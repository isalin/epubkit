# epubkit

`epubkit` is a TypeScript library and `epub` command-line tool for working with EPUB files.

## Install

```sh
npm install epubkit
```

## CLI

```sh
epub
epub merge a.epub b.epub -o out.epub
epub meta book.epub
epub meta book.epub -t "New Title" -a "Display Name--Sort Name"
epub info book.epub
epub unpack merged.epub -d restored
epub cover get book.epub -o cover.jpg
epub cover set book.epub cover.jpg
epub cover replace book.epub cover.jpg
epub cover fix book.epub
```

Run `epub` without arguments to show command help.

## Library

```js
import { mergeEpubs, readInfo, readMetadata, updateMetadata } from "epubkit";

await mergeEpubs(["a.epub", "b.epub"], { output: "out.epub", title: "Combined" });

const info = await readInfo("out.epub");
const metadata = await readMetadata("out.epub");

await updateMetadata("out.epub", {
  title: "Updated",
  authors: [{ name: "Example Author", fileAs: "Author, Example" }]
});
```

## Development

```sh
npm install
npm test
npm run build
```

Publishing is handled by the manual GitHub Actions workflow. Configure the `NPM_TOKEN` repository secret before running it.

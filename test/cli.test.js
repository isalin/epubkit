import assert from "node:assert/strict";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { detectCover, readEpub } from "../dist/index.js";
import { createEpub3, tempDir, tinyPng } from "./helpers.js";

const exec = promisify(execFile);
const cli = path.resolve("dist/cli.js");

async function run(args, options = {}) {
  return exec(process.execPath, [cli, ...args], options);
}

test("prints command help when called without arguments", async () => {
  const { stdout } = await run([]);
  assert.match(stdout, /Usage:/);
  assert.match(stdout, /epub merge/);
  assert.match(stdout, /Commands:/);
});

test("prints subcommand help summaries", async () => {
  const merge = await run(["merge"]);
  assert.match(merge.stdout, /epubkit merge/);
  assert.match(merge.stdout, /epub merge <a\.epub> <b\.epub>/);
  assert.match(merge.stdout, /--volume-labels-from-files/);
  assert.match(merge.stdout, /--prefix <text>/);
  assert.match(merge.stdout, /--suffix <text>/);
  assert.match(merge.stdout, /--sort/);
  assert.match(merge.stdout, /input order is the default/);

  const meta = await run(["meta", "--help"]);
  assert.match(meta.stdout, /epubkit meta/);
  assert.match(meta.stdout, /epub meta <book\.epub\|content\.opf>/);
  assert.match(meta.stdout, /--json/);

  const info = await run(["info", "--help"]);
  assert.match(info.stdout, /epubkit info/);
  assert.match(info.stdout, /epub info <book\.epub>/);

  const unpack = await run(["unpack", "--help"]);
  assert.match(unpack.stdout, /epubkit unpack/);
  assert.match(unpack.stdout, /epub unpack <merged\.epub>/);

  const cover = await run(["cover"]);
  assert.match(cover.stdout, /epubkit cover/);
  assert.match(cover.stdout, /epub cover get <book\.epub>/);
  assert.match(cover.stdout, /epub cover set <book\.epub> <image> \[-o updated\.epub\] \[-f\]/);
  assert.match(cover.stdout, /replace  Replace an existing cover image/);
  assert.match(cover.stdout, /For get, write the cover image to this path/);
  assert.match(cover.stdout, /For set, replace, and fix, write the updated EPUB to this path/);

  const coverHelp = await run(["cover", "--help"]);
  assert.match(coverHelp.stdout, /epubkit cover/);
  assert.match(coverHelp.stdout, /epub cover fix <book\.epub>/);
});

test("subcommand help does not mask partial invocations", async () => {
  await assert.rejects(
    () => run(["merge", "one.epub"]),
    (error) => {
      assert.match(error.stderr, /merge requires at least two EPUB files/);
      return true;
    }
  );
});

test("published declarations compile for Node-only TypeScript consumers", async () => {
  const dir = await tempDir();
  const project = path.join(dir, "consumer");
  await mkdir(path.join(project, "node_modules", "@isalin"), { recursive: true });
  await symlink(path.resolve("."), path.join(project, "node_modules", "@isalin", "epubkit"), "dir");
  await writeFile(path.join(project, "package.json"), JSON.stringify({ type: "module" }, null, 2));
  await writeFile(
    path.join(project, "index.ts"),
    `import { readEpub, readMetadataFromOpf } from "@isalin/epubkit";

async function inspect(file: string): Promise<string | undefined> {
  const epub = await readEpub(file);
  return readMetadataFromOpf(epub.opfDoc).title;
}

void inspect("book.epub");
`
  );
  await writeFile(
    path.join(project, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          lib: ["ES2022"],
          types: ["node"],
          typeRoots: [path.resolve("node_modules/@types")],
          strict: true,
          noEmit: true
        }
      },
      null,
      2
    )
  );

  await exec(process.execPath, [path.resolve("node_modules/typescript/bin/tsc"), "-p", project]);
});

test("reads and edits metadata through the CLI", async () => {
  const dir = await tempDir();
  const book = path.join(dir, "cli-meta.epub");
  await createEpub3(book, { title: "CLI Before", author: "Old Author" });

  const before = await run(["meta", book]);
  assert.match(before.stdout, /Title: CLI Before/);
  assert.match(before.stdout, /Author: Old Author/);

  await run(["meta", book, "-t", "CLI After", "-a", "New Author--Author, New", "-s", "A//B", "-l", "fr"]);
  const after = await run(["meta", book, "--json"]);
  const metadata = JSON.parse(after.stdout);
  assert.equal(metadata.title, "CLI After");
  assert.equal(metadata.authors[0].fileAs, "Author, New");
  assert.deepEqual(metadata.subjects, ["A", "B"]);
  assert.equal(metadata.language, "fr");

  await run(["meta", book, "-a", "", "-s", ""]);
  const removed = JSON.parse((await run(["meta", book, "--json"])).stdout);
  assert.deepEqual(removed.authors, []);
  assert.deepEqual(removed.subjects, []);
});

test("preserves CLI metadata value order across aliases", async () => {
  const dir = await tempDir();
  const book = path.join(dir, "cli-meta-order.epub");
  await createEpub3(book, { title: "CLI Order" });

  await run([
    "meta",
    book,
    "--author",
    "First Author",
    "-a",
    "Second Author",
    "--translator",
    "First Translator",
    "-r",
    "Second Translator",
    "--subject",
    "First Subject",
    "-s",
    "Second Subject"
  ]);

  const metadata = JSON.parse((await run(["meta", book, "--json"])).stdout);
  assert.deepEqual(metadata.authors.map((author) => author.name), ["First Author", "Second Author"]);
  assert.deepEqual(metadata.translators.map((translator) => translator.name), ["First Translator", "Second Translator"]);
  assert.deepEqual(metadata.subjects, ["First Subject", "Second Subject"]);
});

test("uses the latest CLI scalar value across aliases", async () => {
  const dir = await tempDir();
  const book = path.join(dir, "cli-meta-scalar.epub");
  const a = path.join(dir, "merge-a.epub");
  const b = path.join(dir, "merge-b.epub");
  const oldOut = path.join(dir, "old-output.epub");
  const newOut = path.join(dir, "new-output.epub");
  await createEpub3(book, { title: "Before" });
  await createEpub3(a, { title: "A" });
  await createEpub3(b, { title: "B" });

  await run(["meta", book, "-t", "Old", "--title", "New"]);
  let metadata = JSON.parse((await run(["meta", book, "--json"])).stdout);
  assert.equal(metadata.title, "New");

  await run(["meta", book, "--title", "Older", "-t", "Newest"]);
  metadata = JSON.parse((await run(["meta", book, "--json"])).stdout);
  assert.equal(metadata.title, "Newest");

  await run(["merge", a, b, "-o", oldOut, "--output", newOut, "-t", "Output Alias Merge"]);
  assert.match((await run(["info", newOut])).stdout, /Title: Output Alias Merge/);
  await assert.rejects(() => readFile(oldOut), /ENOENT/);
});

test("merges, inspects, and unpacks through the CLI", async () => {
  const dir = await tempDir();
  const a = path.join(dir, "a.epub");
  const b = path.join(dir, "b.epub");
  const out = path.join(dir, "out.epub");
  await createEpub3(a, { title: "A" });
  await createEpub3(b, { title: "B" });

  await run(["merge", a, b, "-o", out, "-t", "CLI Merge"]);
  const info = await run(["info", out]);
  assert.match(info.stdout, /Title: CLI Merge/);
  assert.match(info.stdout, /Version: EPUB 3/);

  const unpackDir = path.join(dir, "restored");
  const unpack = await run(["unpack", out, "-d", unpackDir]);
  assert.match(unpack.stdout, /a\.epub/);
  assert.deepEqual(await readFile(path.join(unpackDir, "a.epub")), await readFile(a));
  assert.deepEqual(await readFile(path.join(unpackDir, "b.epub")), await readFile(b));
});

test("sorts merge inputs naturally through the CLI when requested", async () => {
  const dir = await tempDir();
  const earlyDir = path.join(dir, "a");
  const lateDir = path.join(dir, "z");
  await mkdir(earlyDir);
  await mkdir(lateDir);
  const ten = path.join(earlyDir, "book-10.epub");
  const two = path.join(lateDir, "book-2.epub");
  const out = path.join(dir, "sorted.epub");
  await createEpub3(ten, { title: "Ten", heading: "Ten Heading" });
  await createEpub3(two, { title: "Two", heading: "Two Heading" });

  await run(["merge", ten, two, "-o", out, "-t", "Sorted CLI Merge", "--sort"]);

  const merged = await readEpub(out);
  assert.match(archiveText(merged, "EPUB/volumes/001/OEBPS/chapter.xhtml"), /Two/);
  assert.match(archiveText(merged, "EPUB/volumes/002/OEBPS/chapter.xhtml"), /Ten/);
});

test("rejects conflicting merge order flags through the CLI", async () => {
  const dir = await tempDir();
  const a = path.join(dir, "a.epub");
  const b = path.join(dir, "b.epub");
  const out = path.join(dir, "out.epub");
  await createEpub3(a, { title: "A" });
  await createEpub3(b, { title: "B" });

  await assert.rejects(
    () => run(["merge", a, b, "-o", out, "--sort", "--preserve-order"]),
    (error) => {
      assert.match(error.stderr, /Use either --sort or --preserve-order, not both/);
      return true;
    }
  );
});

test("writes derived merge output inside the requested directory", async () => {
  const dir = await tempDir();
  const outDir = path.join(dir, "merged-output");
  const a = path.join(dir, "alpha-1.epub");
  const b = path.join(dir, "alpha-2.epub");
  await mkdir(outDir);
  await createEpub3(a, { title: "A" });
  await createEpub3(b, { title: "B" });

  await run(["merge", a, b, "-d", outDir, "-t", "Dir Merge"], { cwd: dir });

  const out = path.join(outDir, "Dir Merge.epub");
  assert.match((await run(["info", out])).stdout, /Title: Dir Merge/);
  await assert.rejects(() => readFile(path.join(dir, "Dir Merge.epub")), /ENOENT/);
});

test("sanitizes named merge output before joining the requested directory", async () => {
  const dir = await tempDir();
  const outDir = path.join(dir, "named-output");
  const a = path.join(dir, "named-a.epub");
  const b = path.join(dir, "named-b.epub");
  await mkdir(outDir);
  await createEpub3(a, { title: "A" });
  await createEpub3(b, { title: "B" });

  await run(["merge", a, b, "-d", outDir, "-n", "../escape", "-t", "Named Escape"], { cwd: dir });

  const out = path.join(outDir, ".. escape.epub");
  assert.match((await run(["info", out])).stdout, /Title: Named Escape/);
  await assert.rejects(() => readFile(path.join(dir, "escape.epub")), /ENOENT/);
});

test("does not nest explicit merge output under requested directory", async () => {
  const dir = await tempDir();
  const outDir = path.join(dir, "merged-output");
  const a = path.join(dir, "explicit-a.epub");
  const b = path.join(dir, "explicit-b.epub");
  const out = path.join(dir, "explicit-out.epub");
  await mkdir(outDir);
  await createEpub3(a, { title: "A" });
  await createEpub3(b, { title: "B" });

  await run(["merge", a, b, "-d", outDir, "-o", out, "-t", "Explicit Output"], { cwd: dir });

  assert.match((await run(["info", out])).stdout, /Title: Explicit Output/);
  await assert.rejects(() => readFile(path.join(outDir, out)), /ENOENT/);
});

test("extracts a cover through the CLI", async () => {
  const dir = await tempDir();
  const book = path.join(dir, "cover.epub");
  const out = path.join(dir, "cover.png");
  await createEpub3(book, { title: "Cover CLI" });

  const result = await run(["cover", "get", book, "-o", out]);
  assert.match(result.stdout, /cover\.png/);
  assert.ok((await readFile(out)).byteLength > 0);
});

test("cover extraction through the CLI refuses existing output unless forced", async () => {
  const dir = await tempDir();
  const book = path.join(dir, "cover-force.epub");
  const out = path.join(dir, "cover.png");
  await createEpub3(book, { title: "Cover Force CLI" });
  await writeFile(out, "existing output");

  await assert.rejects(
    () => run(["cover", "get", book, "-o", out]),
    (error) => {
      assert.match(error.stderr, /Refusing to overwrite existing file/);
      return true;
    }
  );
  assert.equal(await readFile(out, "utf8"), "existing output");

  await run(["cover", "get", book, "-o", out, "-f"]);
  assert.deepEqual(await readFile(out), Buffer.from(tinyPng));
});

test("cover replace through the CLI writes requested output without changing source", async () => {
  const dir = await tempDir();
  const book = path.join(dir, "cover-replace-source.epub");
  const replacement = path.join(dir, "replacement.png");
  const out = path.join(dir, "cover-replace-output.epub");
  const replacementBytes = new Uint8Array([7, 6, 5, 4]);
  await createEpub3(book, { title: "Cover Replace Source" });
  await writeFile(replacement, replacementBytes);
  const before = await readFile(book);

  await run(["cover", "replace", book, replacement, "-o", out]);

  assert.deepEqual(await readFile(book), before);
  assert.deepEqual(Buffer.from(detectCover(await readEpub(out))?.data ?? []), Buffer.from(replacementBytes));
});

test("cover replace through the CLI refuses existing output unless forced", async () => {
  const dir = await tempDir();
  const book = path.join(dir, "cover-replace-force.epub");
  const replacement = path.join(dir, "replacement.png");
  const out = path.join(dir, "existing-output.epub");
  await createEpub3(book, { title: "Cover Replace Force" });
  await writeFile(replacement, new Uint8Array([1, 3, 5, 7]));
  await writeFile(out, "existing output");
  const before = await readFile(book);

  await assert.rejects(
    () => run(["cover", "replace", book, replacement, "-o", out]),
    (error) => {
      assert.match(error.stderr, /Refusing to overwrite existing file/);
      return true;
    }
  );
  assert.equal(await readFile(out, "utf8"), "existing output");
  assert.deepEqual(await readFile(book), before);
});

function archiveText(epub, filePath) {
  const data = epub.files.get(filePath);
  assert.ok(data, `Expected ${filePath} in archive`);
  return Buffer.from(data).toString("utf8");
}

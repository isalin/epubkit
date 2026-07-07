#!/usr/bin/env node
import path from "node:path";
import { extractCover, repairCover, replaceCover, setCover } from "./cover.js";
import { readInfo } from "./epub.js";
import { changedMetadataFields, readMetadata, updateMetadata } from "./metadata.js";
import { mergeEpubs, unpackMergedEpub } from "./merge.js";
import { MetadataPatch } from "./types.js";
import { commonFilenamePrefix, ensureExt, formatList, parseContributor, sanitizeFilename, splitMultiValue } from "./utils.js";

type Parsed = {
  positionals: string[];
  options: Map<string, string | boolean | string[]>;
  optionValues: Array<{ name: string; value: string }>;
};

const HELP = `epubkit

Usage:
  epub
  epub merge <a.epub> <b.epub> ... -o <out.epub>
  epub meta <book.epub|content.opf> [options]
  epub info <book.epub>
  epub unpack <merged.epub> [-d dir] [-f]
  epub cover get <book.epub> [-o cover.ext] [-f]
  epub cover set <book.epub> <image>
  epub cover replace <book.epub> <image>
  epub cover fix <book.epub>

Commands:
  merge     Merge multiple EPUB files.
  meta      Read or edit metadata.
  info      Show structural EPUB information.
  unpack    Extract EPUBs produced by epubkit merge.
  cover     Get, set, replace, or repair cover images.
`;

const MERGE_HELP = `epubkit merge

Usage:
  epub merge <a.epub> <b.epub> ... -o <out.epub>
  epub merge <a.epub> <b.epub> ... -d <dir> [-n name]

Options:
  -o, --output <file>      Write the merged EPUB to this path.
  -d, --dir <dir>         Write a derived output file into this directory.
  -n, --name <name>       Use this output filename with --dir.
  -t, --title <title>     Set the merged EPUB title.
  -l, --language <lang>   Set the merged EPUB language.
  -v, --volumes <labels>  Use //-separated volume labels.
  -V, --volume-labels-from-files
                          Use input filenames as volume labels.
  -p, --prefix <text>     Set the generated volume label prefix.
  -s, --suffix <text>     Set the generated volume label suffix.
  -O, --preserve-order    Keep input order instead of sorting by reading order.
  -f, --force             Overwrite an existing output file.
  -q, --quiet             Suppress the written-file message.
`;

const META_HELP = `epubkit meta

Usage:
  epub meta <book.epub|content.opf>
  epub meta <book.epub|content.opf> [options]

Options:
  --json                    Print metadata as JSON.
  -t, --title <title>       Set title.
  -a, --author <value>      Set author. Use Name--Sort Name for file-as.
  -r, --translator <value>  Set translator. Use Name--Sort Name for file-as.
  -s, --subject <value>     Set subjects. Repeat or separate with //.
  -p, --publisher <value>   Set publisher.
  -l, --language <lang>     Set language.
  -d, --description <text>  Set description.
  -i, --isbn <isbn>         Set ISBN.
  -x, --rights <text>       Set rights.
  -u, --published <date>    Set published date.
  -m, --modified <date>     Set modified date.
  -q, --quiet               Suppress update messages.
`;

const INFO_HELP = `epubkit info

Usage:
  epub info <book.epub>

Summary:
  Shows title, EPUB version, language, contributors, OPF path, file counts,
  spine counts, navigation paths, and cover path when present.
`;

const UNPACK_HELP = `epubkit unpack

Usage:
  epub unpack <merged.epub> [-d dir] [-f]

Options:
  -d, --dir <dir>  Write restored EPUB files into this directory.
  -f, --force      Overwrite existing restored files.
`;

const COVER_HELP = `epubkit cover

Usage:
  epub cover get <book.epub> [-o cover.ext] [-f]
  epub cover set <book.epub> <image> [-o updated.epub] [-f]
  epub cover replace <book.epub> <image> [-o updated.epub] [-f]
  epub cover fix <book.epub> [-o updated.epub] [-f]

Actions:
  get      Extract the detected cover image.
  set      Add or update cover metadata for an image.
  replace  Replace an existing cover image.
  fix      Repair cover metadata for an existing image.

Options:
  -o, --output <path>  For get, write the cover image to this path.
                       For set, replace, and fix, write the updated EPUB to this path.
  -f, --force          Overwrite an existing output file.
`;

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === "-h" || command === "--help") {
    console.log(HELP.trimEnd());
    return;
  }
  if (command === "merge") return runMerge(rest);
  if (command === "meta") return runMeta(rest);
  if (command === "info") return runInfo(rest);
  if (command === "unpack") return runUnpack(rest);
  if (command === "cover") return runCover(rest);
  throw new Error(`Unknown command: ${command}\n\n${HELP}`);
}

async function runMerge(args: string[]): Promise<void> {
  if (isCommandHelpRequest(args)) {
    console.log(MERGE_HELP.trimEnd());
    return;
  }
  const parsed = parseArgs(args);
  const output = optString(parsed, "o", "output");
  const title = optString(parsed, "t", "title");
  const language = optString(parsed, "l", "language");
  const outputName = optString(parsed, "n", "name");
  const outputDir = optString(parsed, "d", "dir");
  const volumeLabelsValue = optString(parsed, "v", "volumes");
  const volumeLabelsFromFiles = hasOpt(parsed, "V", "volume-labels-from-files");
  if (volumeLabelsValue && volumeLabelsFromFiles) throw new Error("Use either -v or -V, not both");
  const defaultOutput = outputDir ? ensureExt(sanitizeFilename(title || commonFilenamePrefix(parsed.positionals)), ".epub") : undefined;
  const derivedOutput = outputName ? ensureExt(sanitizeFilename(outputName.replace(/\.epub$/i, "")), ".epub") : defaultOutput;
  const finalOutput = output || (derivedOutput ? (outputDir ? path.join(outputDir, derivedOutput) : derivedOutput) : undefined);
  const result = await mergeEpubs(parsed.positionals, {
    output: finalOutput,
    title,
    language,
    force: hasOpt(parsed, "f", "force"),
    preserveOrder: hasOpt(parsed, "O", "preserve-order"),
    volumeLabels: volumeLabelsValue ? volumeLabelsValue.split("//").map((item) => item.trim()).filter(Boolean) : undefined,
    volumeLabelsFromFiles,
    volumePrefix: optString(parsed, "p", "prefix"),
    volumeSuffix: optString(parsed, "s", "suffix"),
    quiet: hasOpt(parsed, "q", "quiet")
  });
  if (!hasOpt(parsed, "q", "quiet")) console.error(`Wrote ${result}`);
}

async function runMeta(args: string[]): Promise<void> {
  if (isCommandHelpRequest(args)) {
    console.log(META_HELP.trimEnd());
    return;
  }
  const parsed = parseArgs(args);
  const source = parsed.positionals[0];
  if (!source) throw new Error("meta requires an EPUB or OPF path");
  const patch = metadataPatchFromOptions(parsed);
  if (Object.keys(patch).length > 0) {
    const updated = await updateMetadata(source, patch);
    if (!hasOpt(parsed, "q", "quiet")) console.error(`Updated ${changedMetadataFields(patch).join(", ")}`);
    if (hasOpt(parsed, "json")) console.log(JSON.stringify(updated, null, 2));
    return;
  }
  const metadata = await readMetadata(source);
  if (hasOpt(parsed, "json")) {
    console.log(JSON.stringify(metadata, null, 2));
    return;
  }
  printMetadata(metadata);
}

async function runInfo(args: string[]): Promise<void> {
  if (isCommandHelpRequest(args)) {
    console.log(INFO_HELP.trimEnd());
    return;
  }
  const file = args[0];
  if (!file) throw new Error("info requires an EPUB path");
  const info = await readInfo(file);
  console.log(`Title: ${info.metadata.title ?? ""}`);
  console.log(`Version: EPUB ${info.version}`);
  console.log(`Language: ${info.metadata.language ?? ""}`);
  console.log(`Authors: ${formatList(info.metadata.authors.map((author) => author.name))}`);
  console.log(`OPF: ${info.opfPath}`);
  console.log(`Files: ${info.fileCount}`);
  console.log(`Manifest items: ${info.manifestCount}`);
  console.log(`Spine items: ${info.spineCount}`);
  if (info.navPath) console.log(`NAV: ${info.navPath}`);
  if (info.ncxPath) console.log(`NCX: ${info.ncxPath}`);
  if (info.coverPath) console.log(`Cover: ${info.coverPath}`);
}

async function runUnpack(args: string[]): Promise<void> {
  if (isCommandHelpRequest(args)) {
    console.log(UNPACK_HELP.trimEnd());
    return;
  }
  const parsed = parseArgs(args);
  const source = parsed.positionals[0];
  if (!source) throw new Error("unpack requires a merged EPUB path");
  const written = await unpackMergedEpub(source, {
    outputDir: optString(parsed, "d", "dir"),
    force: hasOpt(parsed, "f", "force")
  });
  for (const file of written) console.log(file);
}

async function runCover(args: string[]): Promise<void> {
  if (isCommandHelpRequest(args)) {
    console.log(COVER_HELP.trimEnd());
    return;
  }
  const [action, ...rest] = args;
  const parsed = parseArgs(rest);
  const book = parsed.positionals[0];
  if (!action || !book) throw new Error("cover requires an action and EPUB path");
  const coverOptions = { output: optString(parsed, "o", "output"), force: hasOpt(parsed, "f", "force") };
  if (action === "get") {
    console.log(await extractCover(book, coverOptions));
    return;
  }
  if (action === "set") {
    const image = parsed.positionals[1];
    if (!image) throw new Error("cover set requires an image path");
    const cover = await setCover(book, image, coverOptions);
    console.log(cover.path);
    return;
  }
  if (action === "replace") {
    const image = parsed.positionals[1];
    if (!image) throw new Error("cover replace requires an image path");
    const cover = await replaceCover(book, image, coverOptions);
    console.log(cover.path);
    return;
  }
  if (action === "fix") {
    const cover = await repairCover(book, coverOptions);
    console.log(cover.path);
    return;
  }
  throw new Error(`Unknown cover action: ${action}`);
}

function isCommandHelpRequest(args: string[]): boolean {
  return args.length === 0 || (args.length === 1 && (args[0] === "-h" || args[0] === "--help"));
}

function parseArgs(args: string[]): Parsed {
  const positionals: string[] = [];
  const options = new Map<string, string | boolean | string[]>();
  const optionValues: Array<{ name: string; value: string }> = [];
  const valueOptions = new Set([
    "o",
    "output",
    "t",
    "title",
    "l",
    "language",
    "n",
    "name",
    "d",
    "dir",
    "v",
    "volumes",
    "p",
    "prefix",
    "s",
    "suffix",
    "a",
    "author",
    "r",
    "translator",
    "publisher",
    "subject",
    "description",
    "isbn",
    "rights",
    "published",
    "modified",
    "x",
    "u",
    "m",
    "i"
  ]);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === "--") {
      positionals.push(...args.slice(i + 1));
      break;
    }
    if (!arg.startsWith("-") || arg === "-") {
      positionals.push(arg);
      continue;
    }
    const name = arg.replace(/^-+/, "");
    if (valueOptions.has(name)) {
      const value = args[++i];
      if (value == null) throw new Error(`Missing value for ${arg}`);
      optionValues.push({ name, value });
      addOption(options, name, value);
    } else {
      options.set(name, true);
    }
  }
  return { positionals, options, optionValues };
}

function addOption(options: Map<string, string | boolean | string[]>, name: string, value: string): void {
  const existing = options.get(name);
  if (Array.isArray(existing)) existing.push(value);
  else if (typeof existing === "string") options.set(name, [existing, value]);
  else options.set(name, value);
}

function optString(parsed: Parsed, ...names: string[]): string | undefined {
  const wanted = new Set(names);
  for (let i = parsed.optionValues.length - 1; i >= 0; i -= 1) {
    const option = parsed.optionValues[i]!;
    if (wanted.has(option.name)) return option.value;
  }
  return undefined;
}

function optStrings(parsed: Parsed, ...names: string[]): string[] {
  const wanted = new Set(names);
  return parsed.optionValues.filter((option) => wanted.has(option.name)).map((option) => option.value);
}

function hasOpt(parsed: Parsed, ...names: string[]): boolean {
  return names.some((name) => parsed.options.has(name));
}

function metadataPatchFromOptions(parsed: Parsed): MetadataPatch {
  const patch: MetadataPatch = {};
  setPatch(patch, "title", optString(parsed, "t", "title"));
  const authorValues = optStrings(parsed, "a", "author");
  if (authorValues.length > 0) patch.authors = authorValues.flatMap(splitMultiValue).map(parseContributor);
  const translatorValues = optStrings(parsed, "r", "translator");
  if (translatorValues.length > 0) patch.translators = translatorValues.flatMap(splitMultiValue).map(parseContributor);
  const subjectValues = optStrings(parsed, "s", "subject");
  if (subjectValues.length > 0) patch.subjects = subjectValues.flatMap(splitMultiValue);
  setPatch(patch, "publisher", optString(parsed, "p", "publisher"));
  setPatch(patch, "language", optString(parsed, "l", "language"));
  setPatch(patch, "description", optString(parsed, "d", "description"));
  setPatch(patch, "isbn", optString(parsed, "i", "isbn"));
  setPatch(patch, "rights", optString(parsed, "x", "rights"));
  setPatch(patch, "published", optString(parsed, "u", "published"));
  setPatch(patch, "modified", optString(parsed, "m", "modified"));
  return patch;
}

function setPatch<K extends keyof MetadataPatch>(patch: MetadataPatch, key: K, value: string | undefined): void {
  if (value !== undefined) patch[key] = value as MetadataPatch[K];
}

function printMetadata(metadata: Awaited<ReturnType<typeof readMetadata>>): void {
  const rows = [
    ["Title", metadata.title],
    ["Author", formatList(metadata.authors.map((author) => author.fileAs ? `${author.name} (${author.fileAs})` : author.name))],
    ["Translator", formatList(metadata.translators.map((translator) => translator.fileAs ? `${translator.name} (${translator.fileAs})` : translator.name))],
    ["Subject", formatList(metadata.subjects)],
    ["Description", metadata.description?.replaceAll("\n", "\\n")],
    ["Publisher", metadata.publisher],
    ["Published", metadata.published],
    ["Modified", metadata.modified],
    ["Created", metadata.created],
    ["Language", metadata.language],
    ["Rights", metadata.rights],
    ["ISBN", metadata.isbn]
  ];
  for (const [label, value] of rows) {
    if (value) console.log(`${label}: ${value}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

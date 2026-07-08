# Changelog

All notable changes to `@isalin/epubkit` are documented here.

## 1.0.3 - 2026-07-08

- Changed EPUB merge ordering to use the listed input order by default, with `--sort` and the `sort` API option available for natural filename ordering.
- Added validation for conflicting merge order options and kept `--preserve-order` as a compatibility no-op because preserving input order is now the default.
- Added detailed help output for the `merge`, `meta`, `info`, `unpack`, and `cover` CLI subcommands.
- Documented merge ordering, sorted merges, merge label prefix/suffix flags, and `epub cover set -o` output usage.
- Hardened the npm release workflow with manual tag creation, tag/package/lockfile/changelog checks, changelog-derived release notes, draft GitHub release handling, and npm republish detection.

## 1.0.1 - 2026-07-07

- Improved npm and GitHub discoverability metadata for EPUB CLI, parser, metadata, merge, cover, OPF, JavaScript, and TypeScript searches.
- Added repository trust docs for contributing, security reporting, and release history.
- Added a social preview image asset for GitHub repository sharing.

## 1.0.0 - 2026-07-07

- Published the first stable release of `@isalin/epubkit`.
- Added the `epub` Node.js CLI for inspecting EPUB files, editing metadata, merging EPUBs, unpacking merged EPUBs, and managing cover images.
- Added TypeScript and JavaScript APIs for EPUB archives, OPF metadata, EPUB merge/unpack workflows, and cover detection/replacement.

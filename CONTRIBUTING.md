# Contributing

Thanks for helping improve `epubkit`, a TypeScript EPUB library and Node.js CLI for EPUB metadata, merge, cover, inspection, and automation workflows.

## Development Setup

```sh
npm install
npm test
```

Useful commands:

```sh
npm run build
npm run lint
npm test
```

`epubkit` requires Node.js 20 or newer.

## Pull Requests

- Keep changes focused on one bug fix, feature, or documentation improvement.
- Add or update tests for behavior changes.
- Run `npm test` before opening a pull request.
- Mention EPUB version details when a change depends on EPUB 2, EPUB 3, OPF, NAV, NCX, encryption, or cover metadata behavior.

## Issues

For bugs, include:

- `epubkit` version
- Node.js version
- Operating system
- CLI command or API call used
- A minimal EPUB/OPF sample or reproduction steps when possible

For feature requests, describe the EPUB workflow, command shape, or TypeScript API that would make the use case easier.

## Test Fixtures

Prefer small synthetic EPUB/OPF fixtures that isolate the behavior under test. Avoid committing copyrighted books or large binary samples.

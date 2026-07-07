# Security Policy

## Supported Versions

Security fixes are supported for the current `1.x` release line.

## Reporting a Vulnerability

If GitHub private vulnerability reporting is available for this repository, use it to report security issues.

If private reporting is unavailable, open a GitHub issue with minimal public detail and ask for a private follow-up channel. Do not include exploit code, private EPUB files, credentials, or sensitive unpublished content in a public issue.

Useful report details include:

- Affected `@isalin/epubkit` version
- Node.js version
- Operating system
- Whether the issue affects the CLI, library API, or both
- Minimal reproduction steps that do not disclose sensitive content

Security-relevant areas include EPUB archive extraction, metadata rewriting, cover output paths, merge/unpack output paths, symlink handling, and encrypted or obfuscated EPUB resources.

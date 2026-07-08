import fs from "node:fs";
import { execFileSync } from "node:child_process";

const releaseNotesPath = process.env.RELEASE_NOTES_PATH || "/tmp/release-notes.md";
const githubOutput = process.env.GITHUB_OUTPUT;
const releaseTag = process.env.RELEASE_TAG || "";
const refName = process.env.GITHUB_REF_NAME || "";
const tag = releaseTag || refName;
const refType = process.env.GITHUB_REF_TYPE || "";
const eventName = process.env.GITHUB_EVENT_NAME || "";
const repository = process.env.GITHUB_REPOSITORY || "";
const githubToken = process.env.GITHUB_TOKEN || "";
const skipRemoteChecks = process.env.SKIP_REMOTE_CHECKS === "true";

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

function readJson(path) {
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch (error) {
    fail(`Could not read ${path}: ${error.message}`);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function currentHeadSha() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return process.env.GITHUB_SHA || "";
  }
}

function extractReleaseNotes(version) {
  let changelog;
  try {
    changelog = fs.readFileSync("CHANGELOG.md", "utf8");
  } catch (error) {
    fail(`Could not read CHANGELOG.md: ${error.message}`);
  }

  const heading = new RegExp(`^##\\s+\\[?${escapeRegExp(version)}\\]?(?:\\s+-\\s+.*)?\\s*$`, "m");
  const match = heading.exec(changelog);
  if (!match) fail(`CHANGELOG.md must contain a "## ${version}" section`);

  const sectionStart = match.index + match[0].length;
  const remainder = changelog.slice(sectionStart).replace(/^\r?\n/, "");
  const nextHeading = /^##\s+/m.exec(remainder);
  const notes = (nextHeading ? remainder.slice(0, nextHeading.index) : remainder).trim();

  if (!notes) fail(`CHANGELOG.md section for ${version} must not be empty`);
  if (/^(?:TODO|TBD|N\/A|None)$/i.test(notes)) {
    fail(`CHANGELOG.md section for ${version} must contain release notes`);
  }

  return notes;
}

async function fetchStatus(url, headers = {}) {
  let response;
  try {
    response = await fetch(url, { headers });
  } catch (error) {
    fail(`Could not fetch ${url}: ${error.message}`);
  }
  return response;
}

async function readNpmVersionState(packageName, version) {
  const url = `https://registry.npmjs.org/${encodeURIComponent(packageName)}`;
  const response = await fetchStatus(url, { accept: "application/json" });

  if (response.status === 404) return { published: false };
  if (!response.ok) fail(`Could not check npm registry for ${packageName}: HTTP ${response.status}`);

  const metadata = await response.json();
  return { published: Boolean(metadata.versions?.[version]) };
}

async function readGitHubReleaseState(tagName) {
  if (!repository) fail("GITHUB_REPOSITORY is required to check GitHub releases");

  const headers = {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28"
  };
  if (githubToken) headers.authorization = `Bearer ${githubToken}`;

  for (let page = 1; page <= 10; page += 1) {
    const url = `https://api.github.com/repos/${repository}/releases?per_page=100&page=${page}`;
    const response = await fetchStatus(url, headers);
    if (!response.ok) fail(`Could not check GitHub releases for ${repository}: HTTP ${response.status}`);

    const releases = await response.json();
    if (!Array.isArray(releases)) fail(`Could not parse GitHub releases for ${repository}`);

    const release = releases.find((item) => item.tag_name === tagName);
    if (release) return { exists: true, draft: Boolean(release.draft) };
    if (releases.length < 100) break;
  }

  return { exists: false, draft: false };
}

const pkg = readJson("package.json");
const lock = readJson("package-lock.json");
const version = pkg.version;
const lockVersion = lock.version;
const lockPackageVersion = lock.packages?.[""]?.version;
const sha = currentHeadSha();

if (eventName === "workflow_dispatch") {
  if (!releaseTag) fail("Manual release runs must provide RELEASE_TAG");
  if (refType !== "tag" || refName !== releaseTag) {
    fail("Manual release runs must be dispatched from the same Git tag as RELEASE_TAG so npm provenance matches the published package");
  }
} else {
  if (refType !== "tag") fail("Release workflow must run on a Git tag");
  if (releaseTag && releaseTag !== refName) fail(`RELEASE_TAG ${releaseTag} does not match workflow tag ${refName}`);
}
if (!/^v\d+\.\d+\.\d+$/.test(tag)) fail(`Release tag must look like vX.Y.Z, got "${tag}"`);
if (!sha) fail("Could not determine the checked-out release commit SHA");
if (!version) fail("package.json must contain a version");
if (tag.slice(1) !== version) fail(`Tag ${tag} does not match package.json version ${version}`);
if (lockVersion !== version) fail(`package-lock.json version ${lockVersion} does not match package.json version ${version}`);
if (lockPackageVersion !== version) {
  fail(`package-lock.json root package version ${lockPackageVersion} does not match package.json version ${version}`);
}

const releaseNotes = extractReleaseNotes(version);
let npmState = { published: false };
let githubReleaseState = { exists: false, draft: false };

if (!skipRemoteChecks) {
  npmState = await readNpmVersionState(pkg.name, version);
  githubReleaseState = await readGitHubReleaseState(tag);
  if (githubReleaseState.exists && !githubReleaseState.draft) {
    fail(`GitHub Release ${tag} is already published`);
  }
}

fs.writeFileSync(releaseNotesPath, `${releaseNotes}\n`);

if (githubOutput) {
  fs.appendFileSync(githubOutput, `version=${version}\n`);
  fs.appendFileSync(githubOutput, `tag=${tag}\n`);
  fs.appendFileSync(githubOutput, `sha=${sha}\n`);
  fs.appendFileSync(githubOutput, `npm_published=${npmState.published}\n`);
  fs.appendFileSync(githubOutput, `github_release_exists=${githubReleaseState.exists}\n`);
  fs.appendFileSync(githubOutput, `github_release_draft=${githubReleaseState.draft}\n`);
}

console.log(`Prepared release notes for ${tag}`);

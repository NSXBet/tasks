import { createHash } from "node:crypto";
import { chmod, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { booleanFlag, type ParsedArgs } from "./args.js";
import { output, VERSION } from "./presentation.js";

/**
 * Bare `tk update` (no issue id) — self-update for the installed `tk` binary.
 *
 * Resolution order:
 *  - Homebrew install (binary under a Cellar) → `brew upgrade nsxbet/tap/tasks`;
 *    a legacy `tk`-formula install is told how to migrate to the renamed formula.
 *  - Compiled release binary → download the platform asset from GitHub
 *    releases, verify it against the release's `checksums.txt`, and atomically
 *    replace the running binary (write beside it, chmod, rename — the running
 *    process keeps its inode until exit).
 *  - Anything else (source checkout, shim) → refuse with instructions.
 *
 * With an issue id (`tk update <id> [flags]`) the workspace-bound issue-update
 * command runs instead; the CLI dispatches the bare form before workspace
 * resolution, so self-update works outside any .tasks/ workspace.
 */

const GITHUB_REPO = "NSXBet/tasks";
const TAP_FORMULA = "nsxbet/tap/tasks";
/** Formula name before the tasks/tk rename; installs through it must migrate. */
const LEGACY_FORMULA = "tk";
const RELEASES_API = `https://api.github.com/repos/${GITHUB_REPO}/releases`;
const HTTP_USER_AGENT = "tasks-cli";

/** Release ref baked into compiled binaries via `bun build --define`; absent in source runs. */
declare const TK_BUILD_REF: string | undefined;

const fail = (message: string): never => { throw new Error(message); };

interface ReleaseAsset { readonly name: string; readonly browser_download_url: string }
interface ReleaseInfo { readonly tag_name: string; readonly prerelease: boolean; readonly assets: readonly ReleaseAsset[] }

/** Where the running binary came from; decides how self-update proceeds. */
export type InstallMethod =
  | { readonly kind: "homebrew"; readonly formula: string }
  | { readonly kind: "binary" }
  | { readonly kind: "unknown" };

/** Release asset name for a platform/arch pair (`tk-darwin-arm64`, `tk-linux-x64`, …). */
export const binaryTarget = (platform: string, arch: string): string => {
  const os = platform === "darwin" || platform === "linux" ? platform : null;
  const cpu = arch === "arm64" || arch === "x64" ? arch : null;
  if (os === null || cpu === null) fail(`unsupported platform: ${platform}-${arch} (releases cover darwin and linux on arm64 and x64)`);
  return `tk-${os}-${cpu}`;
};

/** Formula name extracted from a Cellar path, or null when not a Homebrew install. */
export const brewFormulaFromExecPath = (execPath: string): string | null => /\/Cellar\/([^/]+)\//.exec(execPath)?.[1] ?? null;

/**
 * Compiled `bun build --compile` binaries run from a virtual filesystem
 * (`/$bunfs/…`); source runs have a real `Bun.main`. Both expose
 * `Bun.embeddedFiles` (empty in source), so that is not a discriminator —
 * and in a source run `process.execPath` is the bun binary itself, which a
 * naive self-replace would corrupt.
 */
const isCompiledBinary = (): boolean => Bun.main.startsWith("/$bunfs/");

export const installMethod = (execPath: string): InstallMethod => {
  const formula = brewFormulaFromExecPath(execPath);
  if (formula !== null) return { kind: "homebrew", formula };
  return isCompiledBinary() ? { kind: "binary" } : { kind: "unknown" };
};

/** `shasum -a 256` output lines (`<sha256>  <filename>`) as a filename → hash map. */
export const parseChecksums = (content: string): ReadonlyMap<string, string> => {
  const entries: Array<readonly [string, string]> = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    const [hash, name] = trimmed.split(/\s+/);
    if (hash !== undefined && hash !== "" && name !== undefined) entries.push([name, hash]);
  }
  return new Map(entries);
};

/** Numeric core of a version tag (`v1.2.3…` → [1, 2, 3]); non-semver tags parse as null. */
const parseVersion = (tag: string): readonly [number, number, number] | null => {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(tag);
  return match === null ? null : [Number(match[1]), Number(match[2]), Number(match[3])];
};

/** -1 / 0 / 1 as a compared to b, by major.minor.patch tuple. */
export const compareVersions = (a: readonly [number, number, number], b: readonly [number, number, number]): number => {
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index]! < b[index]! ? -1 : 1;
  }
  return 0;
};

/**
 * True when the installed build is at or past `releaseTag`. Stable builds
 * compare semver; nightly builds compare against their baked build ref
 * (nightly tags share the semver core with the stable they follow, so semver
 * alone could never see a newer nightly).
 */
export const isUpToDate = (releaseTag: string, channel: "stable" | "nightly"): boolean => {
  if (channel === "nightly" && typeof TK_BUILD_REF === "string") return releaseTag === TK_BUILD_REF;
  const current = parseVersion(VERSION);
  const candidate = parseVersion(releaseTag);
  if (current === null || candidate === null) return releaseTag === VERSION;
  return compareVersions(candidate, current) <= 0;
};

const isRelease = (value: unknown): value is ReleaseInfo =>
  typeof value === "object" && value !== null && "tag_name" in value && "assets" in value;

const fetchJson = async (url: string): Promise<unknown> => {
  const response = await fetch(url, { headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": HTTP_USER_AGENT } });
  if (!response.ok) fail(`GitHub API request failed: ${response.status} ${response.statusText} (${url})`);
  return (await response.json()) as unknown;
};

/**
 * Newest release to update into. The stable channel uses the GitHub "latest"
 * release (pre-releases excluded); the nightly channel takes the newest
 * release of any kind.
 */
export const latestRelease = async (channel: "stable" | "nightly"): Promise<ReleaseInfo> => {
  if (channel === "stable") {
    const release = await fetchJson(`${RELEASES_API}/latest`);
    if (isRelease(release)) return release;
    return fail("no stable release found");
  }
  const releases = await fetchJson(`${RELEASES_API}?per_page=10`);
  if (Array.isArray(releases)) {
    const newest = releases.find(isRelease);
    if (newest !== undefined) return newest;
  }
  return fail("no releases found");
};

const assetUrl = (release: ReleaseInfo, name: string): string => {
  const asset = release.assets.find((candidate) => candidate.name === name);
  return asset?.browser_download_url ?? fail(`release ${release.tag_name} has no asset ${name}`);
};

/** Command `tk update` shells out to when the binary came from Homebrew. */
export const brewUpgradeCommand = (formula: string): readonly string[] => ["brew", "upgrade", formula];

const streamSha256 = async (path: string): Promise<string> => {
  const hash = createHash("sha256");
  for await (const chunk of Bun.file(path).stream()) hash.update(chunk);
  return hash.digest("hex");
};

const downloadTo = async (url: string, destination: string): Promise<void> => {
  const response = await fetch(url, { headers: { "User-Agent": HTTP_USER_AGENT } });
  if (!response.ok) fail(`download failed: ${response.status} ${response.statusText} (${url})`);
  await Bun.write(destination, response);
};

/**
 * Download the release asset, verify it against the release's checksums.txt,
 * and atomically replace `execPath`.
 */
const installDownloadedBinary = async (release: ReleaseInfo, target: string, execPath: string): Promise<void> => {
  const staging = join(dirname(execPath), `.tk-update-${process.pid}`);
  const checksums = join(dirname(execPath), `.tk-update-checksums-${process.pid}`);
  try {
    await downloadTo(assetUrl(release, "checksums.txt"), checksums);
    const published = parseChecksums(await Bun.file(checksums).text()).get(target) ?? fail(`checksums.txt has no entry for ${target}`);
    await downloadTo(assetUrl(release, target), staging);
    const actual = await streamSha256(staging);
    if (actual !== published.toLowerCase()) fail(`checksum mismatch for ${target}\n  expected ${published}\n  actual   ${actual}`);
    await chmod(staging, 0o755);
    try {
      await rename(staging, execPath);
    } catch (error) {
      const code = error instanceof Error && "code" in error ? String(error.code) : "";
      if (code === "EACCES" || code === "EPERM") fail(`cannot replace ${execPath}: permission denied. Re-run with sudo, or reinstall to a writable directory (install.sh defaults to ~/.local/bin).`);
      throw error;
    }
  } finally {
    await rm(staging, { force: true });
    await rm(checksums, { force: true });
  }
};
export const UPDATER_HELP = `tk update — self-update the installed binary
  tk update                Update to the latest stable release
  tk update --latest       Include nightly pre-releases
  tk update --check        Report current vs latest without updating
  tk update --json         Machine-readable result

Installed via Homebrew: runs 'brew upgrade ${TAP_FORMULA}'.
Installed via install.sh: downloads and verifies the release binary.
With an issue id, 'tk update <id>' is the issue-update command instead.
`;

export const runSelfUpdate = async (args: ParsedArgs, json: boolean): Promise<void> => {
  if (booleanFlag(args, "readonly")) fail("readonly mode blocks writes");
  const includePrereleases = booleanFlag(args, "latest");
  const channel: "stable" | "nightly" = includePrereleases ? "nightly" : "stable";
  const method = installMethod(process.execPath);
  const release = await latestRelease(channel);

  if (booleanFlag(args, "check")) {
    const upToDate = isUpToDate(release.tag_name, channel);
    const value = { current: VERSION, latest: release.tag_name, channel, method: method.kind, update_available: !upToDate };
    if (json) output(value, true);
    else console.log(upToDate ? `tk ${VERSION} — up to date (latest ${channel} release ${release.tag_name})` : `tk ${VERSION} → ${release.tag_name} available (run 'tk update' to install)`);
    return;
  }

  if (method.kind === "homebrew") {
    if (method.formula === LEGACY_FORMULA) fail(`this tk was installed through the legacy Homebrew formula "${LEGACY_FORMULA}", which is retired. Migrate first:\n  brew uninstall ${LEGACY_FORMULA}\n  brew install ${TAP_FORMULA}`);
    const upgrade = Bun.spawnSync([...brewUpgradeCommand(TAP_FORMULA)], { stdio: ["ignore", "inherit", "inherit"] });
    if (upgrade.exitCode !== 0) fail(`brew upgrade ${TAP_FORMULA} failed with exit code ${upgrade.exitCode}`);
    if (json) output({ method: "brew", formula: TAP_FORMULA, updated: true }, true);
    else console.log(`✓ tk updated via Homebrew (${TAP_FORMULA})`);
    return;
  }

  if (method.kind !== "binary") fail("tk update needs a compiled tk binary; this looks like a source checkout or shim. Rebuild with 'bun build --compile', or install via install.sh or Homebrew.");

  const target = binaryTarget(process.platform, process.arch);
  await installDownloadedBinary(release, target, process.execPath);
  if (json) output({ method: "binary", previous: VERSION, version: release.tag_name, updated: true }, true);
  else console.log(`✓ Updated tk ${VERSION} → ${release.tag_name}\n  installed: ${process.execPath}\n  restart running sessions to pick up the new binary`);
};

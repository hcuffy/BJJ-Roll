// Expo SDK version check for CI (HEN-272). Wraps `expo install --check --json`, which expo-doctor also runs.
// Expo always expects the newest SDK patch, but new versions wait 14 days (pnpm `minimumReleaseAge`, Dependabot cooldown).
// So a patch behind is a warning; a major or minor mismatch, a prerelease or an unreadable report fails.
// Run: `pnpm --filter @bjj-roll/mobile run doctor` (Node strips the types; only `node:` imports here).
import { spawnSync } from "node:child_process";

export interface VersionMismatch {
  packageName: string;
  expectedVersionOrRange: string;
  actualVersion: string;
}

export interface ExpoVersionCheckResult {
  ok: boolean;
  blocking: VersionMismatch[];
  patchDrift: VersionMismatch[];
  error?: string;
}

interface PlainVersion {
  major: number;
  minor: number;
  patch: number;
}

const plainVersionPattern = /^[~^]?(\d+)\.(\d+)\.(\d+)$/;

function parsePlainVersion(versionText: string): PlainVersion | undefined {
  const match = plainVersionPattern.exec(versionText.trim());
  if (!match) {
    return undefined;
  }
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function isPatchBehind(mismatch: VersionMismatch): boolean {
  const expected = parsePlainVersion(mismatch.expectedVersionOrRange);
  const actual = parsePlainVersion(mismatch.actualVersion);
  if (!expected || !actual) {
    return false;
  }
  return expected.major === actual.major && expected.minor === actual.minor && actual.patch < expected.patch;
}

function isVersionMismatch(value: unknown): value is VersionMismatch {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.packageName === "string" && typeof candidate.expectedVersionOrRange === "string" && typeof candidate.actualVersion === "string"
  );
}

function failed(error: string): ExpoVersionCheckResult {
  return { ok: false, blocking: [], patchDrift: [], error };
}

export function checkExpoVersionReport(reportText: string): ExpoVersionCheckResult {
  let report: unknown;
  try {
    report = JSON.parse(reportText);
  } catch {
    return failed("`expo install --check --json` did not print JSON");
  }
  if (typeof report !== "object" || report === null) {
    return failed("`expo install --check --json` printed an unexpected report");
  }
  const { dependencies, upToDate } = report as Record<string, unknown>;
  if (!Array.isArray(dependencies) || !dependencies.every(isVersionMismatch)) {
    return failed("`expo install --check --json` printed an unexpected dependency list");
  }
  if (upToDate !== true && dependencies.length === 0) {
    return failed("`expo install --check --json` reported out of date without listing packages");
  }
  const patchDrift = dependencies.filter(isPatchBehind);
  const blocking = dependencies.filter((mismatch) => !isPatchBehind(mismatch));
  return { ok: blocking.length === 0, blocking, patchDrift };
}

function describeMismatch(mismatch: VersionMismatch): string {
  return `${mismatch.packageName}: expected ${mismatch.expectedVersionOrRange}, found ${mismatch.actualVersion}`;
}

function runExpoVersionCheck(): number {
  const installCheck = spawnSync("expo", ["install", "--check", "--json"], { encoding: "utf8", env: { ...process.env, CI: "1" } });
  const result = checkExpoVersionReport(installCheck.stdout ?? "");
  for (const mismatch of result.patchDrift) {
    console.warn(`Patch behind Expo SDK (allowed until the 14-day update lands): ${describeMismatch(mismatch)}`);
  }
  for (const mismatch of result.blocking) {
    console.error(`Version mismatch with Expo SDK: ${describeMismatch(mismatch)}`);
  }
  if (result.error) {
    console.error(result.error);
    console.error(installCheck.stderr);
  }
  if (!result.ok) {
    return 1;
  }
  console.warn("Expo SDK versions: no major or minor mismatch.");
  return 0;
}

if (import.meta.main) {
  process.exitCode = runExpoVersionCheck();
}

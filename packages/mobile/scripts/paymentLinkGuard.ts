// Payment link guard for CI (HEN-278). Fails when mobile source, app config or assets contain an outside payment,
// tip or donation link (Apple App Review 3.1.1, Google Play Payments policy).
// Patterns: release/paymentLinkDenyList.txt. False positives: release/paymentLinkAllowList.txt. Docs: docs/release.md.
// Run: `pnpm --filter @bjj-roll/mobile run payment-guard` (Node strips the types; only `node:` imports here).
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface ScannedFile {
  path: string;
  text: string;
}

export interface AllowListEntry {
  path: string;
  matchedText: string;
  reason: string;
}

export interface PaymentLinkHit {
  path: string;
  line: number;
  pattern: string;
  matchedText: string;
}

const denyListPath = "release/paymentLinkDenyList.txt";
const allowListPath = "release/paymentLinkAllowList.txt";
// Not shipped in the app: dependencies, build output, generated native projects and tests (which hold deny-listed fixtures).
const skippedDirectories = new Set(["node_modules", "dist", ".expo", "ios", "android", "__tests__"]);
const skippedFiles = new Set([denyListPath, allowListPath]);

function contentLines(listText: string): string[] {
  return listText
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

export function parseDenyList(listText: string): RegExp[] {
  return contentLines(listText).map((patternSource) => new RegExp(patternSource, "giu"));
}

export function parseAllowList(listText: string): AllowListEntry[] {
  return contentLines(listText).map((line) => {
    const [entryPath = "", matchedText = "", ...reasonParts] = line.split("|").map((part) => part.trim());
    const reason = reasonParts.join("|").trim();
    if (entryPath === "" || matchedText === "" || reason === "") {
      throw new Error(`Allow-list entry needs "<path> | <matched text> | <reason>": ${line}`);
    }
    return { path: entryPath, matchedText, reason };
  });
}

function isAllowed(hit: PaymentLinkHit, allowList: AllowListEntry[]): boolean {
  return allowList.some((entry) => entry.path === hit.path && entry.matchedText.toLowerCase() === hit.matchedText.toLowerCase());
}

interface LineMatch {
  start: number;
  end: number;
  pattern: string;
  matchedText: string;
}

// Two patterns can match the same link (a PayPal donate page also matches the generic donate URL). Report the longest match once.
function withoutNestedMatches(lineMatches: LineMatch[]): LineMatch[] {
  const longestFirst = [...lineMatches].sort((left, right) => left.start - right.start || right.end - left.end);
  const kept: LineMatch[] = [];
  for (const lineMatch of longestFirst) {
    if (!kept.some((keptMatch) => keptMatch.start <= lineMatch.start && lineMatch.end <= keptMatch.end)) {
      kept.push(lineMatch);
    }
  }
  return kept;
}

export function findPaymentLinks(files: ScannedFile[], denyPatterns: RegExp[], allowList: AllowListEntry[]): PaymentLinkHit[] {
  const hits: PaymentLinkHit[] = [];
  for (const file of files) {
    const lines = file.text.split(/\r?\n/u);
    for (const [lineIndex, lineText] of lines.entries()) {
      const lineHits = withoutNestedMatches(
        denyPatterns.flatMap((pattern) =>
          [...lineText.matchAll(pattern)].map((match) => ({
            start: match.index,
            end: match.index + match[0].length,
            pattern: pattern.source,
            matchedText: match[0],
          })),
        ),
      );
      for (const lineHit of lineHits) {
        const hit = { path: file.path, line: lineIndex + 1, pattern: lineHit.pattern, matchedText: lineHit.matchedText };
        if (!isAllowed(hit, allowList)) {
          hits.push(hit);
        }
      }
    }
  }
  return hits;
}

function listFiles(mobileRoot: string, relativeDirectory = ""): string[] {
  const entries = readdirSync(path.join(mobileRoot, relativeDirectory), { withFileTypes: true });
  return entries.flatMap((entry) => {
    const relativePath = relativeDirectory === "" ? entry.name : `${relativeDirectory}/${entry.name}`;
    if (entry.isDirectory()) {
      return skippedDirectories.has(entry.name) ? [] : listFiles(mobileRoot, relativePath);
    }
    return entry.isFile() && !skippedFiles.has(relativePath) ? [relativePath] : [];
  });
}

export function scanMobilePackage(mobileRoot: string): PaymentLinkHit[] {
  const denyPatterns = parseDenyList(readFileSync(path.join(mobileRoot, denyListPath), "utf8"));
  const allowList = parseAllowList(readFileSync(path.join(mobileRoot, allowListPath), "utf8"));
  // Assets (images, fonts) are read as latin1 so any URL text inside them is still visible.
  const files = listFiles(mobileRoot).map((relativePath) => ({
    path: relativePath,
    text: readFileSync(path.join(mobileRoot, relativePath), "latin1"),
  }));
  return findPaymentLinks(files, denyPatterns, allowList);
}

if (import.meta.main) {
  const mobileRoot = fileURLToPath(new URL("..", import.meta.url));
  const hits = scanMobilePackage(mobileRoot);
  for (const hit of hits) {
    console.error(`Outside payment link: ${hit.path}:${hit.line} matches /${hit.pattern}/ ("${hit.matchedText}")`);
  }
  if (hits.length > 0) {
    console.error(`${hits.length} payment link(s) found. Remove them, or add a false positive to ${allowListPath} with a reason.`);
    process.exitCode = 1;
  } else {
    console.warn("Payment link guard: no outside payment links in packages/mobile.");
  }
}

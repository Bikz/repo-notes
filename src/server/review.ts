import { lstat, readFile } from "node:fs/promises";
import { posix as pathPosix } from "node:path";
import type {
  DocReviewCategory,
  DocReviewIssue,
  DocReviewPayload,
  DocReviewSeverity,
  NoteSummary,
  WorkspaceIndex,
} from "../shared/types";
import { assertNoSymlinkInWorkspacePath, resolveWorkspaceFilePath } from "./safety";

interface ReviewOptions {
  repoName?: string;
  nowMs?: number;
  largeFileBytes?: number;
  staleAfterDays?: number;
  maxReturnedIssues?: number;
  maxConcurrency?: number;
}

interface IssueDraft {
  category: DocReviewCategory;
  severity: DocReviewSeverity;
  note: NoteSummary;
  message: string;
  line?: number;
  target?: string;
  relatedCount?: number;
}

const defaultLargeFileBytes = 50 * 1024;
const defaultStaleAfterDays = 180;
const defaultMaxReturnedIssues = 250;
const dayMs = 24 * 60 * 60 * 1000;
const todoPattern = /\b(TODO|FIXME|TBD|XXX)\b\s*[:-]/i;
const markdownLinkPattern = /!?\[[^\]]*]\(([^)]+)\)/g;
const duplicateTitleExemptions = new Set([
  "agents",
  "changelog",
  "claude",
  "contributing",
  "license",
  "notes",
  "readme",
]);

export async function reviewWorkspaceDocs(
  rootPath: string,
  index: WorkspaceIndex,
  options: ReviewOptions = {},
): Promise<DocReviewPayload> {
  const nowMs = options.nowMs ?? Date.now();
  const largeFileBytes = options.largeFileBytes ?? defaultLargeFileBytes;
  const staleAfterDays = options.staleAfterDays ?? defaultStaleAfterDays;
  const maxReturnedIssues = options.maxReturnedIssues ?? defaultMaxReturnedIssues;
  const limit = createLimiter(options.maxConcurrency ?? 32);
  const scopedNotes = index.notes.filter((note) => !options.repoName || note.repoName === options.repoName);
  const reposReviewed = new Set(scopedNotes.map((note) => note.repoName)).size;
  const issues: DocReviewIssue[] = [];

  await Promise.all(
    scopedNotes.map((note) =>
      limit(async () => {
        for (const issue of metadataIssuesForNote(note, nowMs, largeFileBytes, staleAfterDays)) {
          issues.push(issueFromDraft(issue));
        }

        const content = await readIndexedNoteContent(rootPath, note).catch(
          (error: unknown) => {
            if (isUnreadableIndexedNote(error)) {
              issues.push(
                issueFromDraft({
                  category: "missing-file",
                  severity: "high",
                  note,
                  message: "This indexed document no longer exists or cannot be read safely. Refresh the index.",
                }),
              );
              return null;
            }

            throw error;
          },
        );
        if (content === null) {
          return;
        }

        if (content.trim().length === 0) {
          issues.push(
            issueFromDraft({
              category: "empty-doc",
              severity: "high",
              note,
              message: "This document is empty.",
            }),
          );
        }

        for (const issue of todoIssuesForNote(note, content)) {
          issues.push(issueFromDraft(issue));
        }

        if (note.kind === "markdown") {
          for (const issue of await brokenLinkIssuesForNote(rootPath, note, content)) {
            issues.push(issueFromDraft(issue));
          }
        }
      }),
    ),
  );

  for (const issue of duplicateTitleIssues(scopedNotes)) {
    issues.push(issueFromDraft(issue));
  }

  const sortedIssues = issues.sort(compareIssues);
  const severityCounts = countSeverities(sortedIssues);

  return {
    generatedAtMs: nowMs,
    scope: {
      repoName: options.repoName,
      label: options.repoName ?? "All repos",
    },
    reposReviewed,
    notesReviewed: scopedNotes.length,
    issueCount: sortedIssues.length,
    returnedIssueCount: Math.min(sortedIssues.length, maxReturnedIssues),
    severityCounts,
    issues: sortedIssues.slice(0, maxReturnedIssues),
  };
}

function metadataIssuesForNote(
  note: NoteSummary,
  nowMs: number,
  largeFileBytes: number,
  staleAfterDays: number,
): IssueDraft[] {
  const issues: IssueDraft[] = [];

  if (note.byteSize >= largeFileBytes) {
    issues.push({
      category: "large-file",
      severity: "low",
      note,
      message: `This document is ${formatBytes(note.byteSize)}. Consider splitting it if it covers multiple decisions.`,
    });
  }

  const ageDays = Math.floor((nowMs - note.updatedAtMs) / dayMs);
  if (ageDays >= staleAfterDays) {
    issues.push({
      category: "stale-doc",
      severity: "low",
      note,
      message: `This document has not changed in ${ageDays} days.`,
    });
  }

  return issues;
}

function todoIssuesForNote(note: NoteSummary, content: string): IssueDraft[] {
  const issues: IssueDraft[] = [];
  const lines = content.split(/\r?\n/);

  for (let index = 0; index < lines.length && issues.length < 5; index += 1) {
    if (todoPattern.test(lines[index] ?? "")) {
      issues.push({
        category: "todo-marker",
        severity: "medium",
        note,
        line: index + 1,
        message: "This document contains an unresolved TODO, FIXME, TBD, or XXX marker.",
      });
    }
  }

  return issues;
}

async function brokenLinkIssuesForNote(rootPath: string, note: NoteSummary, content: string): Promise<IssueDraft[]> {
  const issues: IssueDraft[] = [];
  const matches = content.matchAll(markdownLinkPattern);

  for (const match of matches) {
    const rawTarget = match[1];
    if (!rawTarget) {
      continue;
    }

    const target = normalizeMarkdownLinkTarget(rawTarget);
    if (!target || isExternalTarget(target)) {
      continue;
    }

    const targetPath = pathWithoutAnchorOrQuery(target);
    if (!targetPath) {
      continue;
    }

    const rootRelativeTarget = resolveMarkdownLink(note, targetPath);
    try {
      await assertNoSymlinkInWorkspacePath(rootPath, rootRelativeTarget);
      const targetStat = await lstat(resolveWorkspaceFilePath(rootPath, rootRelativeTarget));
      if (!targetStat.isFile() && !targetStat.isDirectory()) {
        throw new Error("Link target is not a file or directory.");
      }
    } catch {
      issues.push({
        category: "broken-link",
        severity: "high",
        note,
        line: lineNumberAt(content, match.index ?? 0),
        target: rootRelativeTarget,
        message: "This Markdown link points to a missing local file or directory.",
      });
    }
  }

  return issues;
}

async function readIndexedNoteContent(rootPath: string, note: NoteSummary) {
  await assertNoSymlinkInWorkspacePath(rootPath, note.rootRelativePath);
  return readFile(resolveWorkspaceFilePath(rootPath, note.rootRelativePath), "utf8");
}

function isUnreadableIndexedNote(error: unknown) {
  return (
    error instanceof Error &&
    (("code" in error && error.code === "ENOENT") || error.message.toLowerCase().includes("symlink"))
  );
}

function duplicateTitleIssues(notes: NoteSummary[]): IssueDraft[] {
  const groups = new Map<string, NoteSummary[]>();

  for (const note of notes) {
    const normalizedTitle = note.title.trim().toLowerCase();
    if (!normalizedTitle || duplicateTitleExemptions.has(normalizedTitle)) {
      continue;
    }

    const key = `${note.repoName}:${normalizedTitle}`;
    groups.set(key, [...(groups.get(key) ?? []), note]);
  }

  return Array.from(groups.values())
    .filter((group) => group.length > 1)
    .map((group) => ({
      category: "duplicate-title" as const,
      severity: "low" as const,
      note: group[0],
      relatedCount: group.length,
      message: `${group.length} documents in this repo share the same title.`,
    }));
}

function normalizeMarkdownLinkTarget(rawTarget: string) {
  const trimmed = rawTarget.trim();
  const bracketed = trimmed.match(/^<([^>]+)>/);
  const firstToken = bracketed?.[1] ?? trimmed.split(/\s+/)[0] ?? "";

  try {
    return decodeURIComponent(firstToken);
  } catch {
    return firstToken;
  }
}

function isExternalTarget(target: string) {
  return target.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(target);
}

function pathWithoutAnchorOrQuery(target: string) {
  return target.split("#")[0]?.split("?")[0]?.trim() ?? "";
}

function resolveMarkdownLink(note: NoteSummary, targetPath: string) {
  const normalizedTarget = targetPath.replaceAll("\\", "/");
  const basePath = normalizedTarget.startsWith("/")
    ? pathPosix.join(note.repoName, normalizedTarget.slice(1))
    : pathPosix.join(pathPosix.dirname(note.rootRelativePath), normalizedTarget);

  return pathPosix.normalize(basePath);
}

function issueFromDraft(issue: IssueDraft): DocReviewIssue {
  return {
    id: [
      issue.category,
      issue.note.rootRelativePath,
      issue.line ?? "file",
      issue.target ?? issue.relatedCount ?? "issue",
    ].join(":"),
    category: issue.category,
    severity: issue.severity,
    repoName: issue.note.repoName,
    rootRelativePath: issue.note.rootRelativePath,
    title: issue.note.title,
    message: issue.message,
    line: issue.line,
    target: issue.target,
    relatedCount: issue.relatedCount,
  };
}

function lineNumberAt(content: string, offset: number) {
  return content.slice(0, offset).split(/\r?\n/).length;
}

function countSeverities(issues: DocReviewIssue[]): Record<DocReviewSeverity, number> {
  return issues.reduce(
    (counts, issue) => {
      counts[issue.severity] += 1;
      return counts;
    },
    { high: 0, medium: 0, low: 0 },
  );
}

function compareIssues(left: DocReviewIssue, right: DocReviewIssue) {
  const severityDelta = severityRank[left.severity] - severityRank[right.severity];
  if (severityDelta !== 0) {
    return severityDelta;
  }

  if (left.repoName !== right.repoName) {
    return left.repoName.localeCompare(right.repoName);
  }

  return left.rootRelativePath.localeCompare(right.rootRelativePath);
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 102.4) / 10} KB`;
  }

  return `${Math.round(bytes / 104857.6) / 10} MB`;
}

const severityRank: Record<DocReviewSeverity, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

type Limiter = <T>(operation: () => Promise<T>) => Promise<T>;

function createLimiter(maxConcurrency: number): Limiter {
  let activeCount = 0;
  const waiting: Array<() => void> = [];

  function release() {
    activeCount -= 1;
    waiting.shift()?.();
  }

  return async function limit<T>(operation: () => Promise<T>) {
    if (activeCount >= maxConcurrency) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }

    activeCount += 1;
    try {
      return await operation();
    } finally {
      release();
    }
  };
}

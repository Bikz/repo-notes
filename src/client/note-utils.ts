import type {
  DocReviewCategory,
  DocReviewIssue,
  DocReviewSeverity,
  DocSearchPayload,
  DocSearchResult,
  GitChangesPayload,
  GitChangeStatus,
  NoteSummary,
  RepoSummary,
} from "../shared/types";

export type NoteSortMode = "path" | "updated";
export type SessionViewMode = "preview" | "edit" | "split";
export type ReviewSeverityFilter = DocReviewSeverity | "all";
export type ReviewCategoryFilter = DocReviewCategory | "all";
export type AppShortcut = "save" | "focus-search" | "new-note" | "close-panel" | "format-bold" | "format-link";
export type CreateTemplateId = "blank" | "prd" | "rfc" | "decision" | "runbook";
export type MarkdownFormatAction = "heading" | "bold" | "list" | "link" | "code";

export interface CreateDraftFields {
  repoName: string;
  templateId?: CreateTemplateId;
  repoRelativePath: string;
  content: string;
}

export interface CreateTemplateDefinition {
  id: CreateTemplateId;
  label: string;
  defaultPath: string;
  content: string;
}

export interface MarkdownFormatResult {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

interface ShortcutKeyEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  isComposing?: boolean;
}

export interface NoteLineTarget {
  rootRelativePath: string;
  line?: number;
}

export interface PreviewLinkTarget {
  note: NoteSummary;
  anchor?: string;
}

export interface NoteGroup {
  title: string;
  detail?: string;
  notes: NoteSummary[];
}

export interface NoteOutlineItem {
  id: string;
  line: number;
  level: number;
  title: string;
}

export interface NoteHistoryState {
  entries: string[];
  index: number;
}

export interface WorkspaceSessionState {
  rootPath: string;
  repoFilter: string;
  selectedPath: string;
  noteSort: NoteSortMode;
  viewMode: SessionViewMode;
  areSourcesVisible: boolean;
}

export const createNoteTemplates: CreateTemplateDefinition[] = [
  {
    id: "blank",
    label: "Blank note",
    defaultPath: "notes/new-note.md",
    content: "# New note\n\n",
  },
  {
    id: "prd",
    label: "Product requirements",
    defaultPath: "docs/prd/new-prd.md",
    content: [
      "# Product requirements",
      "",
      "## Problem",
      "",
      "What customer or team problem should this solve?",
      "",
      "## Goals",
      "",
      "- ",
      "",
      "## Non-goals",
      "",
      "- ",
      "",
      "## Users",
      "",
      "- ",
      "",
      "## Requirements",
      "",
      "- ",
      "",
      "## Open questions",
      "",
      "- ",
      "",
    ].join("\n"),
  },
  {
    id: "rfc",
    label: "RFC",
    defaultPath: "docs/rfcs/new-rfc.md",
    content: [
      "# RFC",
      "",
      "## Summary",
      "",
      "What are we proposing?",
      "",
      "## Context",
      "",
      "What constraints, history, or current behavior matters?",
      "",
      "## Proposal",
      "",
      "- ",
      "",
      "## Alternatives",
      "",
      "- ",
      "",
      "## Rollout",
      "",
      "- ",
      "",
      "## Risks",
      "",
      "- ",
      "",
    ].join("\n"),
  },
  {
    id: "decision",
    label: "Decision record",
    defaultPath: "docs/decisions/new-decision.md",
    content: [
      "# Decision record",
      "",
      "## Context",
      "",
      "What situation led to this decision?",
      "",
      "## Decision",
      "",
      "What did we decide?",
      "",
      "## Consequences",
      "",
      "- ",
      "",
      "## Follow-ups",
      "",
      "- ",
      "",
    ].join("\n"),
  },
  {
    id: "runbook",
    label: "Runbook",
    defaultPath: "docs/runbooks/new-runbook.md",
    content: [
      "# Runbook",
      "",
      "## Purpose",
      "",
      "When should someone use this runbook?",
      "",
      "## Prerequisites",
      "",
      "- ",
      "",
      "## Steps",
      "",
      "1. ",
      "",
      "## Verification",
      "",
      "- ",
      "",
      "## Rollback",
      "",
      "- ",
      "",
      "## Owners",
      "",
      "- ",
      "",
    ].join("\n"),
  },
];

export function createTemplateById(id: CreateTemplateId) {
  return createNoteTemplates.find((template) => template.id === id) ?? createNoteTemplates[0];
}

export function applyCreateTemplate(
  draft: CreateDraftFields,
  templateId: CreateTemplateId,
): CreateDraftFields & { templateId: CreateTemplateId } {
  const template = createTemplateById(templateId);
  return {
    repoName: draft.repoName,
    templateId: template.id,
    repoRelativePath: template.defaultPath,
    content: template.content,
  };
}

export function applyMarkdownFormat(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  action: MarkdownFormatAction,
): MarkdownFormatResult {
  const start = clampSelectionOffset(Math.min(selectionStart, selectionEnd), value.length);
  const end = clampSelectionOffset(Math.max(selectionStart, selectionEnd), value.length);
  const selectedText = value.slice(start, end);

  switch (action) {
    case "heading":
      return prefixCurrentLines(value, start, end, "## ", true);
    case "list":
      return prefixCurrentLines(value, start, end, "- ");
    case "bold":
      return replaceSelection(value, start, end, selectedText || "strong text", "**", "**");
    case "link": {
      const text = selectedText || "link text";
      const inserted = `[${text}](url)`;
      const nextValue = replaceRange(value, start, end, inserted);
      const urlStart = start + text.length + 3;
      return {
        value: nextValue,
        selectionStart: urlStart,
        selectionEnd: urlStart + 3,
      };
    }
    case "code":
      if (selectedText.includes("\n")) {
        return replaceSelection(value, start, end, selectedText || "code", "```\n", "\n```");
      }
      return replaceSelection(value, start, end, selectedText || "code", "`", "`");
  }
}

export function filterNotes(notes: NoteSummary[], repoFilter: string, query: string) {
  const normalizedQuery = query.trim().toLowerCase();

  return notes.filter((note) => {
    const repoMatches = repoFilter === "all" || note.repoName === repoFilter;
    const queryMatches =
      normalizedQuery.length === 0 ||
      note.title.toLowerCase().includes(normalizedQuery) ||
      note.repoRelativePath.toLowerCase().includes(normalizedQuery) ||
      note.repoName.toLowerCase().includes(normalizedQuery);

    return repoMatches && queryMatches;
  });
}

function clampSelectionOffset(offset: number, length: number) {
  if (!Number.isFinite(offset)) {
    return 0;
  }

  return Math.min(Math.max(Math.floor(offset), 0), length);
}

function replaceRange(value: string, start: number, end: number, replacement: string) {
  return `${value.slice(0, start)}${replacement}${value.slice(end)}`;
}

function replaceSelection(
  value: string,
  start: number,
  end: number,
  selectedText: string,
  prefix: string,
  suffix: string,
): MarkdownFormatResult {
  const inserted = `${prefix}${selectedText}${suffix}`;
  return {
    value: replaceRange(value, start, end, inserted),
    selectionStart: start + prefix.length,
    selectionEnd: start + prefix.length + selectedText.length,
  };
}

function prefixCurrentLines(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  prefix: string,
  shiftSelectionStart = false,
): MarkdownFormatResult {
  const lineStart = value.lastIndexOf("\n", Math.max(0, selectionStart - 1)) + 1;
  const selectedEnd = selectionEnd > selectionStart && value[selectionEnd - 1] === "\n" ? selectionEnd - 1 : selectionEnd;
  const nextLineBreak = value.indexOf("\n", selectedEnd);
  const lineEnd = nextLineBreak === -1 ? value.length : nextLineBreak;
  const target = value.slice(lineStart, lineEnd);
  const lines = target.length === 0 ? [""] : target.split("\n");
  const prefixed = lines.map((line) => (line.startsWith(prefix) ? line : `${prefix}${line}`)).join("\n");
  const nextValue = replaceRange(value, lineStart, lineEnd, prefixed);
  const addedLength = prefixed.length - target.length;

  return {
    value: nextValue,
    selectionStart: selectionStart + (shiftSelectionStart ? prefix.length : 0),
    selectionEnd: selectionEnd + addedLength,
  };
}

export function sortNotes(notes: NoteSummary[], mode: NoteSortMode) {
  return [...notes].sort((left, right) => {
    if (mode === "updated" && left.updatedAtMs !== right.updatedAtMs) {
      return right.updatedAtMs - left.updatedAtMs;
    }

    return compareNotePaths(left, right);
  });
}

export const initialReviewIssueCount = 8;

export function resolveCreateRepoName(currentRepoName: string, repos: RepoSummary[], preferredRepoName = "") {
  if (repos.some((repo) => repo.name === preferredRepoName)) {
    return preferredRepoName;
  }

  if (repos.some((repo) => repo.name === currentRepoName)) {
    return currentRepoName;
  }

  return repos[0]?.name ?? "";
}

export function resolvePreferredCreateRepoName(repoFilter: string, selectedRepoName = "") {
  return repoFilter === "all" ? selectedRepoName : repoFilter;
}

export function nextReviewIssueLimit(currentLimit: number, returnedIssueCount: number) {
  return Math.min(returnedIssueCount, currentLimit + initialReviewIssueCount);
}

export function pushNoteHistory(history: NoteHistoryState, rootRelativePath: string): NoteHistoryState {
  const currentPath = history.entries[history.index];
  if (!rootRelativePath || currentPath === rootRelativePath) {
    return history;
  }

  const currentEntries = history.index >= 0 ? history.entries.slice(0, history.index + 1) : [];
  const entries = [...currentEntries, rootRelativePath];
  return {
    entries,
    index: entries.length - 1,
  };
}

export function noteHistoryTarget(history: NoteHistoryState, direction: -1 | 1) {
  const targetIndex = history.index + direction;
  return targetIndex >= 0 && targetIndex < history.entries.length ? history.entries[targetIndex] : null;
}

export function moveNoteHistory(history: NoteHistoryState, direction: -1 | 1): NoteHistoryState {
  const targetPath = noteHistoryTarget(history, direction);
  if (!targetPath) {
    return history;
  }

  return {
    entries: history.entries,
    index: history.index + direction,
  };
}

export function searchResultLimitMessage(
  search: Pick<DocSearchPayload, "resultCount" | "returnedResultCount" | "scope">,
) {
  if (search.returnedResultCount >= search.resultCount) {
    return "";
  }

  const nextAction = search.scope.repoName
    ? "Narrow the search to inspect more."
    : "Narrow the search or select a repo to inspect more.";
  return `Showing first ${search.returnedResultCount} of ${search.resultCount} matches. ${nextAction}`;
}

export function gitChangeStatusLabel(status: GitChangeStatus) {
  switch (status) {
    case "modified":
      return "Modified";
    case "added":
      return "Added";
    case "deleted":
      return "Deleted";
    case "renamed":
      return "Renamed";
    case "copied":
      return "Copied";
    case "untracked":
      return "Untracked";
    case "typechange":
      return "Type changed";
    case "conflicted":
      return "Conflict";
  }
}

export function gitChangesLimitMessage(
  changes: Pick<GitChangesPayload, "changeCount" | "returnedChangeCount" | "scope">,
) {
  if (changes.returnedChangeCount >= changes.changeCount) {
    return "";
  }

  const nextAction = changes.scope.repoName
    ? "Narrow the repo's changes outside Repo Notes to inspect fewer files."
    : "Select a repo to inspect fewer changes.";
  return `Showing first ${changes.returnedChangeCount} of ${changes.changeCount} changed docs. ${nextAction}`;
}

export function appShortcutForKey(event: ShortcutKeyEvent): AppShortcut | null {
  if (event.isComposing) {
    return null;
  }

  if (event.key === "Escape" && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
    return "close-panel";
  }

  const hasCommandModifier = event.metaKey || event.ctrlKey;
  if (!hasCommandModifier || event.shiftKey || event.altKey) {
    return null;
  }

  switch (event.key.toLowerCase()) {
    case "s":
      return "save";
    case "f":
      return "focus-search";
    case "n":
      return "new-note";
    case "b":
      return "format-bold";
    case "k":
      return "format-link";
    default:
      return null;
  }
}

export function isCreateDraftDirty(draft: CreateDraftFields) {
  const template = createTemplateById(draft.templateId ?? "blank");
  return draft.repoRelativePath.trim() !== template.defaultPath || draft.content !== template.content;
}

export function isSaveConflictError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  if ("status" in error && error.status === 409) {
    return true;
  }

  return error.message.toLowerCase().includes("changed on disk");
}

export function restoreWorkspaceSession(
  session: unknown,
  rootPath: string,
  repos: RepoSummary[],
  notes: NoteSummary[],
): Omit<WorkspaceSessionState, "rootPath"> | null {
  if (!isWorkspaceSessionLike(session) || session.rootPath !== rootPath) {
    return null;
  }

  let repoFilter = "all";
  if (
    typeof session.repoFilter === "string" &&
    (session.repoFilter === "all" || repos.some((repo) => repo.name === session.repoFilter))
  ) {
    repoFilter = session.repoFilter;
  }
  const selectedNote = notes.find((note) => note.rootRelativePath === session.selectedPath);
  const selectedPath = selectedNote?.rootRelativePath ?? "";
  if (selectedNote && repoFilter !== "all" && selectedNote.repoName !== repoFilter) {
    repoFilter = selectedNote.repoName;
  }

  return {
    repoFilter,
    selectedPath,
    noteSort: isNoteSortMode(session.noteSort) ? session.noteSort : "path",
    viewMode: isSessionViewMode(session.viewMode) ? session.viewMode : "preview",
    areSourcesVisible: typeof session.areSourcesVisible === "boolean" ? session.areSourcesVisible : true,
  };
}

export function filterReviewIssues(
  issues: DocReviewIssue[],
  severityFilter: ReviewSeverityFilter,
  categoryFilter: ReviewCategoryFilter,
) {
  return issues.filter((issue) => {
    const severityMatches = severityFilter === "all" || issue.severity === severityFilter;
    const categoryMatches = categoryFilter === "all" || issue.category === categoryFilter;
    return severityMatches && categoryMatches;
  });
}

export function lineStartOffsetForLine(content: string, line?: number) {
  if (line === undefined || !Number.isFinite(line) || line <= 1) {
    return 0;
  }

  const targetLine = Math.floor(line);
  let currentLine = 1;

  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === "\n") {
      currentLine += 1;
      if (currentLine === targetLine) {
        return index + 1;
      }
    }
  }

  return content.length;
}

export function lineTargetForSearchResult(result?: DocSearchResult | null): NoteLineTarget | null {
  if (!result || result.matchKind !== "content" || result.line === undefined || result.line < 1) {
    return null;
  }

  return {
    rootRelativePath: result.note.rootRelativePath,
    line: result.line,
  };
}

export function extractMarkdownOutline(content: string): NoteOutlineItem[] {
  const outline: NoteOutlineItem[] = [];
  const usedSlugs = new Map<string, number>();
  let isInFence = false;

  content.split(/\r?\n/).forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) {
      isInFence = !isInFence;
      return;
    }

    if (isInFence) {
      return;
    }

    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) {
      return;
    }

    const title = match[2]?.trim();
    if (!title) {
      return;
    }

    const baseSlug = slugForHeading(title);
    const seenCount = usedSlugs.get(baseSlug) ?? 0;
    usedSlugs.set(baseSlug, seenCount + 1);

    outline.push({
      id: `heading-${index + 1}-${seenCount === 0 ? baseSlug : `${baseSlug}-${seenCount + 1}`}`,
      line: index + 1,
      level: match[1]?.length ?? 1,
      title,
    });
  });

  return outline;
}

export function resolvePreviewLinkTarget(
  currentNote: NoteSummary,
  notes: NoteSummary[],
  href: string,
): PreviewLinkTarget | null {
  const trimmedHref = href.trim();
  if (!trimmedHref || isExternalPreviewHref(trimmedHref) || trimmedHref.startsWith("/")) {
    return null;
  }

  const [rawPath = "", rawAnchor] = trimmedHref.split("#", 2);
  const anchor = decodeUriComponentSafe(rawAnchor ?? "");

  if (!rawPath) {
    return anchor ? { note: currentNote, anchor } : null;
  }

  const decodedPath = decodeUriComponentSafe(rawPath.split("?")[0] ?? "");
  const targetRepoRelativePath = resolveRepoRelativeLinkPath(currentNote.repoRelativePath, decodedPath);
  if (!targetRepoRelativePath) {
    return null;
  }

  const rootRelativePath = `${currentNote.repoName}/${targetRepoRelativePath}`;
  const linkedNote = notes.find((note) => note.rootRelativePath === rootRelativePath);
  if (!linkedNote) {
    return null;
  }

  return anchor ? { note: linkedNote, anchor } : { note: linkedNote };
}

export function isExternalPreviewHref(href: string) {
  return href.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(href);
}

export function lineTargetForOutlineAnchor(
  outline: NoteOutlineItem[],
  anchor: string,
  rootRelativePath: string,
): NoteLineTarget | null {
  const normalizedAnchor = slugForHeading(decodeUriComponentSafe(anchor.replace(/^#/, "")));
  const outlineItem = outline.find((item) => slugForHeading(item.title) === normalizedAnchor);

  if (!outlineItem) {
    return null;
  }

  return {
    rootRelativePath,
    line: outlineItem.line,
  };
}

export function previewAssetApiPath(noteRootRelativePath: string, source: string) {
  const trimmedSource = source.trim();
  if (!trimmedSource || isExternalPreviewHref(trimmedSource) || trimmedSource.startsWith("/") || trimmedSource.startsWith("#")) {
    return null;
  }

  const sourcePath = trimmedSource.split("#", 1)[0]?.split("?", 1)[0] ?? "";
  if (!isSupportedPreviewImageSource(sourcePath)) {
    return null;
  }

  return `/api/assets?note=${encodeURIComponent(noteRootRelativePath)}&src=${encodeURIComponent(trimmedSource)}`;
}

export function groupNotesByRecency(notes: NoteSummary[], nowMs = Date.now()): NoteGroup[] {
  const buckets: NoteGroup[] = [
    { title: "Today", notes: [] },
    { title: "Previous 7 Days", notes: [] },
    { title: "Previous 30 Days", notes: [] },
    { title: "Older", notes: [] },
  ];
  const startOfTodayMs = startOfLocalDay(nowMs);

  for (const note of notes) {
    const updatedDayMs = startOfLocalDay(note.updatedAtMs);
    const ageDays = Math.floor((startOfTodayMs - updatedDayMs) / dayMs);

    if (ageDays <= 0) {
      buckets[0].notes.push(note);
    } else if (ageDays <= 7) {
      buckets[1].notes.push(note);
    } else if (ageDays <= 30) {
      buckets[2].notes.push(note);
    } else {
      buckets[3].notes.push(note);
    }
  }

  return buckets.filter((bucket) => bucket.notes.length > 0);
}

export function groupNotesByLocation(notes: NoteSummary[], repoFilter: string): NoteGroup[] {
  const groups = new Map<string, NoteGroup>();

  for (const note of notes) {
    const group = locationGroupForNote(note, repoFilter);
    const existingGroup = groups.get(group.key);

    if (existingGroup) {
      existingGroup.notes.push(note);
    } else {
      groups.set(group.key, {
        title: group.title,
        detail: group.detail,
        notes: [note],
      });
    }
  }

  return Array.from(groups.values());
}

function locationGroupForNote(note: NoteSummary, repoFilter: string): { key: string; title: string; detail?: string } {
  if (repoFilter === "all") {
    return {
      key: `repo:${note.repoName}`,
      title: note.repoName,
    };
  }

  const pathParts = note.repoRelativePath.split("/").filter(Boolean);
  if (pathParts.length <= 1) {
    return {
      key: "root",
      title: "Repository root",
    };
  }

  const folderPath = pathParts[0] ?? "";
  return {
    key: `folder:${folderPath}`,
    title: folderPath,
  };
}

function compareNotePaths(left: NoteSummary, right: NoteSummary) {
  if (left.repoName !== right.repoName) {
    return left.repoName.localeCompare(right.repoName);
  }

  const leftDepth = left.repoRelativePath.split("/").length;
  const rightDepth = right.repoRelativePath.split("/").length;

  if (leftDepth !== rightDepth) {
    return leftDepth - rightDepth;
  }

  return left.repoRelativePath.localeCompare(right.repoRelativePath);
}

function slugForHeading(title: string) {
  return title
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "") || "section";
}

function resolveRepoRelativeLinkPath(currentRepoRelativePath: string, hrefPath: string) {
  const currentParts = currentRepoRelativePath.split("/").filter(Boolean);
  currentParts.pop();

  const targetParts = [...currentParts];
  for (const part of hrefPath.split("/")) {
    if (!part || part === ".") {
      continue;
    }

    if (part === "..") {
      if (targetParts.length === 0) {
        return null;
      }
      targetParts.pop();
      continue;
    }

    targetParts.push(part);
  }

  return targetParts.length > 0 ? targetParts.join("/") : null;
}

function decodeUriComponentSafe(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isSupportedPreviewImageSource(sourcePath: string) {
  return /\.(avif|gif|jpe?g|png|svg|webp)$/i.test(sourcePath);
}

function isWorkspaceSessionLike(value: unknown): value is Partial<WorkspaceSessionState> {
  return value !== null && typeof value === "object";
}

function isNoteSortMode(value: unknown): value is NoteSortMode {
  return value === "path" || value === "updated";
}

function isSessionViewMode(value: unknown): value is SessionViewMode {
  return value === "preview" || value === "edit" || value === "split";
}

const dayMs = 24 * 60 * 60 * 1000;

function startOfLocalDay(timestamp: number) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

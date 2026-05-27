import { expect, test } from "bun:test";
import type { DocReviewIssue, DocSearchResult, NoteSummary, RepoSummary } from "../shared/types";
import {
  extractMarkdownOutline,
  filterReviewIssues,
  filterNotes,
  groupNotesByLocation,
  groupNotesByRecency,
  lineStartOffsetForLine,
  lineTargetForSearchResult,
  lineTargetForOutlineAnchor,
  moveNoteHistory,
  nextReviewIssueLimit,
  noteHistoryTarget,
  previewAssetApiPath,
  pushNoteHistory,
  resolvePreviewLinkTarget,
  isExternalPreviewHref,
  resolveCreateRepoName,
  resolvePreferredCreateRepoName,
  searchResultLimitMessage,
  sortNotes,
} from "./note-utils";

const notes: NoteSummary[] = [
  note("alpha", "docs/README.md", "README", 100),
  note("alpha", "notes/release-plan.md", "release plan", 300),
  note("beta", "docs/ops.txt", "ops", 200),
];

test("filterNotes matches repository and text across title, path, and repo", () => {
  expect(filterNotes(notes, "alpha", "release")).toEqual([notes[1]]);
  expect(filterNotes(notes, "all", "beta")).toEqual([notes[2]]);
  expect(filterNotes(notes, "all", "DOCS")).toEqual([notes[0], notes[2]]);
});

test("sortNotes supports path order and recently updated order", () => {
  expect(sortNotes(notes, "path").map((note) => note.rootRelativePath)).toEqual([
    "alpha/docs/README.md",
    "alpha/notes/release-plan.md",
    "beta/docs/ops.txt",
  ]);
  expect(sortNotes(notes, "updated").map((note) => note.rootRelativePath)).toEqual([
    "alpha/notes/release-plan.md",
    "beta/docs/ops.txt",
    "alpha/docs/README.md",
  ]);
});

test("resolveCreateRepoName keeps valid selections and replaces stale ones", () => {
  const repos: RepoSummary[] = [
    { name: "alpha", rootRelativePath: "alpha", isGitRepo: true, noteCount: 1 },
    { name: "beta", rootRelativePath: "beta", isGitRepo: true, noteCount: 1 },
  ];

  expect(resolveCreateRepoName("beta", repos)).toBe("beta");
  expect(resolveCreateRepoName("alpha", repos, "beta")).toBe("beta");
  expect(resolveCreateRepoName("alpha", repos, "missing")).toBe("alpha");
  expect(resolveCreateRepoName("stale", repos)).toBe("alpha");
  expect(resolveCreateRepoName("", [])).toBe("");
});

test("resolvePreferredCreateRepoName follows the active repo context before falling back to selected notes", () => {
  expect(resolvePreferredCreateRepoName("alpha", "beta")).toBe("alpha");
  expect(resolvePreferredCreateRepoName("all", "beta")).toBe("beta");
  expect(resolvePreferredCreateRepoName("all")).toBe("");
});

test("groupNotesByLocation groups all docs by repo and selected repos by top folder", () => {
  expect(groupNotesByLocation(notes, "all").map((group) => group.title)).toEqual(["alpha", "beta"]);
  expect(groupNotesByLocation(notes, "alpha").map((group) => group.title)).toEqual(["docs", "notes"]);
  expect(
    groupNotesByLocation([note("alpha", "README.md", "README", 400)], "alpha").map((group) => group.title),
  ).toEqual(["Repository root"]);
});

test("groupNotesByRecency creates Notes-style date sections", () => {
  const now = Date.UTC(2026, 4, 19, 12);
  const groupedNotes = groupNotesByRecency(
    [
      note("alpha", "today.md", "today", now),
      note("alpha", "week.md", "week", now - 3 * dayMs),
      note("alpha", "month.md", "month", now - 12 * dayMs),
      note("alpha", "old.md", "old", now - 60 * dayMs),
    ],
    now,
  );

  expect(groupedNotes.map((group) => group.title)).toEqual(["Today", "Previous 7 Days", "Previous 30 Days", "Older"]);
  expect(groupedNotes.map((group) => group.notes.map((item) => item.title))).toEqual([
    ["today"],
    ["week"],
    ["month"],
    ["old"],
  ]);
});

test("nextReviewIssueLimit pages through returned review issues", () => {
  expect(nextReviewIssueLimit(8, 20)).toBe(16);
  expect(nextReviewIssueLimit(16, 20)).toBe(20);
  expect(nextReviewIssueLimit(8, 8)).toBe(8);
});

test("note history supports back, forward, and branch replacement", () => {
  const first = pushNoteHistory({ entries: [], index: -1 }, "alpha/docs/one.md");
  const second = pushNoteHistory(first, "alpha/docs/two.md");
  const back = moveNoteHistory(second, -1);
  const branched = pushNoteHistory(back, "beta/docs/three.md");

  expect(first).toEqual({ entries: ["alpha/docs/one.md"], index: 0 });
  expect(pushNoteHistory(second, "alpha/docs/two.md")).toEqual(second);
  expect(noteHistoryTarget(second, -1)).toBe("alpha/docs/one.md");
  expect(noteHistoryTarget(back, 1)).toBe("alpha/docs/two.md");
  expect(branched).toEqual({ entries: ["alpha/docs/one.md", "beta/docs/three.md"], index: 1 });
  expect(moveNoteHistory(branched, 1)).toEqual(branched);
});

test("searchResultLimitMessage explains capped search results without implying pagination", () => {
  expect(searchResultLimitMessage(searchPayload(12, 12))).toBe("");
  expect(searchResultLimitMessage(searchPayload(900, 250))).toBe(
    "Showing first 250 of 900 matches. Narrow the search or select a repo to inspect more.",
  );
  expect(searchResultLimitMessage(searchPayload(40, 10, "alpha"))).toBe(
    "Showing first 10 of 40 matches. Narrow the search to inspect more.",
  );
});

test("filterReviewIssues narrows issues by severity and category", () => {
  const issues: DocReviewIssue[] = [
    issue("broken-link", "high"),
    issue("todo-marker", "medium"),
    issue("large-file", "low"),
  ];

  expect(filterReviewIssues(issues, "all", "all")).toEqual(issues);
  expect(filterReviewIssues(issues, "high", "all")).toEqual([issues[0]]);
  expect(filterReviewIssues(issues, "all", "todo-marker")).toEqual([issues[1]]);
  expect(filterReviewIssues(issues, "medium", "broken-link")).toEqual([]);
});

test("lineStartOffsetForLine maps 1-based lines to textarea offsets", () => {
  expect(lineStartOffsetForLine("one\ntwo\nthree")).toBe(0);
  expect(lineStartOffsetForLine("one\ntwo\nthree", 1)).toBe(0);
  expect(lineStartOffsetForLine("one\ntwo\nthree", 3)).toBe(8);
  expect(lineStartOffsetForLine("one\r\ntwo\r\nthree", 2)).toBe(5);
  expect(lineStartOffsetForLine("one\ntwo\nthree", 99)).toBe(13);
  expect(lineStartOffsetForLine("one\ntwo\nthree", 0)).toBe(0);
});

test("lineTargetForSearchResult only targets content matches with line numbers", () => {
  const searchedNote = note("alpha", "docs/README.md", "README", 100);
  const contentMatch: DocSearchResult = {
    note: searchedNote,
    matchKind: "content",
    line: 4,
    snippet: "Launch checklist",
  };

  expect(lineTargetForSearchResult(contentMatch)).toEqual({
    rootRelativePath: "alpha/docs/README.md",
    line: 4,
  });
  expect(lineTargetForSearchResult({ ...contentMatch, matchKind: "metadata" })).toBeNull();
  expect(lineTargetForSearchResult({ ...contentMatch, line: undefined })).toBeNull();
  expect(lineTargetForSearchResult({ ...contentMatch, line: 0 })).toBeNull();
  expect(lineTargetForSearchResult(undefined)).toBeNull();
});

test("extractMarkdownOutline returns ATX headings with line numbers outside fenced code", () => {
  expect(
    extractMarkdownOutline(
      [
        "# Product Brief",
        "",
        "```md",
        "## Not a section",
        "```",
        "## Goals ##",
        "### Launch scope",
        "#### Too deep but still useful",
        "#No heading",
      ].join("\n"),
    ),
  ).toEqual([
    { id: "heading-1-product-brief", line: 1, level: 1, title: "Product Brief" },
    { id: "heading-6-goals", line: 6, level: 2, title: "Goals" },
    { id: "heading-7-launch-scope", line: 7, level: 3, title: "Launch scope" },
    { id: "heading-8-too-deep-but-still-useful", line: 8, level: 4, title: "Too deep but still useful" },
  ]);
});

test("extractMarkdownOutline deduplicates generated ids", () => {
  expect(
    extractMarkdownOutline(
      [
        "## Overview",
        "## Overview",
        "### Overview!",
      ].join("\n"),
    ).map((heading) => heading.id),
  ).toEqual(["heading-1-overview", "heading-2-overview-2", "heading-3-overview-3"]);
});

test("resolvePreviewLinkTarget resolves same-repo markdown links against indexed notes", () => {
  const currentNote = note("alpha", "docs/guides/start.md", "start", 100);
  const linkedNote = note("alpha", "docs/reference/api.md", "api", 100);
  const parentNote = note("alpha", "docs/README.md", "README", 100);
  const allNotes = [currentNote, linkedNote, parentNote, note("beta", "docs/reference/api.md", "api", 100)];

  expect(resolvePreviewLinkTarget(currentNote, allNotes, "../reference/api.md#setup")).toEqual({
    note: linkedNote,
    anchor: "setup",
  });
  expect(resolvePreviewLinkTarget(currentNote, allNotes, "#goals")).toEqual({
    note: currentNote,
    anchor: "goals",
  });
  expect(resolvePreviewLinkTarget(currentNote, allNotes, "../README.md")).toEqual({ note: parentNote });
});

test("resolvePreviewLinkTarget rejects missing, cross-repo, absolute, and external targets", () => {
  const currentNote = note("alpha", "docs/start.md", "start", 100);
  const allNotes = [currentNote, note("beta", "docs/other.md", "other", 100)];

  expect(resolvePreviewLinkTarget(currentNote, allNotes, "missing.md")).toBeNull();
  expect(resolvePreviewLinkTarget(currentNote, allNotes, "../beta/docs/other.md")).toBeNull();
  expect(resolvePreviewLinkTarget(currentNote, allNotes, "/alpha/docs/start.md")).toBeNull();
  expect(resolvePreviewLinkTarget(currentNote, allNotes, "https://example.com/docs")).toBeNull();
});

test("isExternalPreviewHref identifies links that should leave Repo Notes navigation", () => {
  expect(isExternalPreviewHref("https://example.com")).toBe(true);
  expect(isExternalPreviewHref("mailto:team@example.com")).toBe(true);
  expect(isExternalPreviewHref("//example.com/docs")).toBe(true);
  expect(isExternalPreviewHref("../docs/start.md")).toBe(false);
  expect(isExternalPreviewHref("#goals")).toBe(false);
});

test("lineTargetForOutlineAnchor maps markdown anchors to outline line targets", () => {
  const outline = extractMarkdownOutline(["# Product Brief", "## Launch Scope", "## Launch Scope"].join("\n"));

  expect(lineTargetForOutlineAnchor(outline, "launch-scope", "alpha/docs/brief.md")).toEqual({
    rootRelativePath: "alpha/docs/brief.md",
    line: 2,
  });
  expect(lineTargetForOutlineAnchor(outline, "#product-brief", "alpha/docs/brief.md")).toEqual({
    rootRelativePath: "alpha/docs/brief.md",
    line: 1,
  });
  expect(lineTargetForOutlineAnchor(outline, "missing", "alpha/docs/brief.md")).toBeNull();
});

test("previewAssetApiPath builds API URLs for local image sources only", () => {
  expect(previewAssetApiPath("alpha/docs/README.md", "images/chart one.png")).toBe(
    "/api/assets?note=alpha%2Fdocs%2FREADME.md&src=images%2Fchart%20one.png",
  );
  expect(previewAssetApiPath("alpha/docs/README.md", "https://example.com/chart.png")).toBeNull();
  expect(previewAssetApiPath("alpha/docs/README.md", "data:image/png;base64,abc")).toBeNull();
  expect(previewAssetApiPath("alpha/docs/README.md", "/alpha/docs/image.png")).toBeNull();
  expect(previewAssetApiPath("alpha/docs/README.md", "#diagram")).toBeNull();
  expect(previewAssetApiPath("alpha/docs/README.md", "images/readme.txt")).toBeNull();
});

const dayMs = 24 * 60 * 60 * 1000;

function note(repoName: string, repoRelativePath: string, title: string, updatedAtMs: number): NoteSummary {
  return {
    id: `${repoName}/${repoRelativePath}`,
    repoName,
    repoRelativePath,
    rootRelativePath: `${repoName}/${repoRelativePath}`,
    extension: repoRelativePath.endsWith(".txt") ? ".txt" : ".md",
    kind: repoRelativePath.endsWith(".txt") ? "text" : "markdown",
    title,
    byteSize: 42,
    updatedAtMs,
  };
}

function issue(category: DocReviewIssue["category"], severity: DocReviewIssue["severity"]): DocReviewIssue {
  return {
    id: `${category}-${severity}`,
    category,
    severity,
    repoName: "alpha",
    rootRelativePath: `alpha/docs/${category}.md`,
    title: category,
    message: category,
  };
}

function searchPayload(resultCount: number, returnedResultCount: number, repoName?: string) {
  return {
    generatedAtMs: 1,
    query: "roadmap",
    scope: {
      repoName,
      label: repoName ?? "All repos",
    },
    searchedNotes: 100,
    resultCount,
    returnedResultCount,
    results: [],
  };
}

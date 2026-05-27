import { expect, test } from "bun:test";
import type { NoteSummary, RepoSummary } from "../shared/types";
import {
  filterNotes,
  groupNotesByLocation,
  groupNotesByRecency,
  nextReviewIssueLimit,
  resolveCreateRepoName,
  resolvePreferredCreateRepoName,
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

import type { NoteSummary, RepoSummary } from "../shared/types";

export type NoteSortMode = "path" | "updated";

export interface NoteGroup {
  title: string;
  notes: NoteSummary[];
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

export function sortNotes(notes: NoteSummary[], mode: NoteSortMode) {
  return [...notes].sort((left, right) => {
    if (mode === "updated" && left.updatedAtMs !== right.updatedAtMs) {
      return right.updatedAtMs - left.updatedAtMs;
    }

    return compareNotePaths(left, right);
  });
}

export function resolveCreateRepoName(currentRepoName: string, repos: RepoSummary[]) {
  if (repos.some((repo) => repo.name === currentRepoName)) {
    return currentRepoName;
  }

  return repos[0]?.name ?? "";
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

const dayMs = 24 * 60 * 60 * 1000;

function startOfLocalDay(timestamp: number) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

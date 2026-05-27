import type { NoteSummary, RepoSummary } from "../shared/types";

export type NoteSortMode = "path" | "updated";

export interface NoteGroup {
  title: string;
  detail?: string;
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

const dayMs = 24 * 60 * 60 * 1000;

function startOfLocalDay(timestamp: number) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

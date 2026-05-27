import type { NoteSummary, RepoSummary } from "../shared/types";

export type NoteSortMode = "path" | "updated";

export interface NoteGroup {
  title: string;
  notes: NoteSummary[];
}

export type DocTreeNode = DocTreeFolder | DocTreeFile;

export interface DocTreeFolder {
  type: "folder";
  name: string;
  path: string;
  noteCount: number;
  children: DocTreeNode[];
}

export interface DocTreeFile {
  type: "file";
  name: string;
  path: string;
  note: NoteSummary;
}

export interface RepoHierarchy {
  repo: RepoSummary;
  children: DocTreeNode[];
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

export function buildRepoHierarchy(notes: NoteSummary[], repos: RepoSummary[]): RepoHierarchy[] {
  const roots = new Map<string, MutableFolder>();

  for (const repo of repos) {
    roots.set(repo.name, createMutableFolder(repo.name, ""));
  }

  for (const note of notes) {
    if (!roots.has(note.repoName)) {
      roots.set(note.repoName, createMutableFolder(note.repoName, ""));
    }

    const root = roots.get(note.repoName);
    if (!root) {
      continue;
    }

    insertNote(root, note);
  }

  return Array.from(roots.entries())
    .map(([repoName, root]) => ({
      repo: repos.find((repo) => repo.name === repoName) ?? {
        name: repoName,
        rootRelativePath: repoName,
        isGitRepo: false,
        noteCount: root.noteCount,
      },
      children: toDocTreeNodes(root.children),
    }))
    .sort((left, right) => left.repo.name.localeCompare(right.repo.name));
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

interface MutableFolder {
  type: "folder";
  name: string;
  path: string;
  noteCount: number;
  children: Map<string, MutableFolder | DocTreeFile>;
}

function createMutableFolder(name: string, path: string): MutableFolder {
  return {
    type: "folder",
    name,
    path,
    noteCount: 0,
    children: new Map(),
  };
}

function insertNote(root: MutableFolder, note: NoteSummary) {
  const parts = note.repoRelativePath.split("/").filter(Boolean);
  let current = root;

  current.noteCount += 1;

  for (const [index, part] of parts.entries()) {
    const path = parts.slice(0, index + 1).join("/");
    const isFile = index === parts.length - 1;

    if (isFile) {
      current.children.set(part, {
        type: "file",
        name: part,
        path,
        note,
      });
      continue;
    }

    const existing = current.children.get(part);
    if (existing?.type === "folder") {
      current = existing;
    } else {
      const folder = createMutableFolder(part, path);
      current.children.set(part, folder);
      current = folder;
    }

    current.noteCount += 1;
  }
}

function toDocTreeNodes(children: Map<string, MutableFolder | DocTreeFile>): DocTreeNode[] {
  return Array.from(children.values())
    .map((node) => {
      if (node.type === "file") {
        return node;
      }

      return {
        type: "folder",
        name: node.name,
        path: node.path,
        noteCount: node.noteCount,
        children: toDocTreeNodes(node.children),
      } satisfies DocTreeFolder;
    })
    .sort((left, right) => {
      if (left.type !== right.type) {
        return left.type === "folder" ? -1 : 1;
      }

      return left.name.localeCompare(right.name);
    });
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

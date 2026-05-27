import { basename, extname } from "node:path";
import type {
  GitChangedNote,
  GitChangesPayload,
  GitChangeStatus,
  NoteSummary,
  RepoSummary,
  SupportedNoteExtension,
  WorkspaceIndex,
} from "../shared/types";
import {
  assertAllowedNotePath,
  assertSupportedNoteExtension,
  noteKindForExtension,
  resolveWorkspaceFilePath,
  resolveWorkspaceRoot,
} from "./safety";

interface GitChangesOptions {
  repoName?: string;
  maxChanges?: number;
}

interface RawGitChange {
  code: string;
  repoRelativePath: string;
  previousRepoRelativePath?: string;
}

const defaultMaxChanges = 250;

export async function getWorkspaceGitChanges(
  rootPath: string,
  index: WorkspaceIndex,
  options: GitChangesOptions = {},
): Promise<GitChangesPayload> {
  const root = resolveWorkspaceRoot(rootPath);
  const maxChanges = options.maxChanges ?? defaultMaxChanges;
  const repos = reposForScope(index.repos, options.repoName);
  const indexedNotes = new Map(index.notes.map((note) => [note.rootRelativePath, note]));
  const changes: GitChangedNote[] = [];
  let reposScanned = 0;

  for (const repo of repos) {
    if (!repo.isGitRepo) {
      continue;
    }

    reposScanned += 1;
    const repoPath = resolveWorkspaceFilePath(root, repo.name);
    const rawChanges = await gitStatus(repoPath);
    for (const rawChange of rawChanges) {
      const noteChange = noteChangeFromGitStatus(repo.name, rawChange, indexedNotes);
      if (noteChange) {
        changes.push(noteChange);
      }
    }
  }

  changes.sort(compareChanges);
  const returnedChanges = changes.slice(0, maxChanges);

  return {
    generatedAtMs: Date.now(),
    scope: options.repoName ? { repoName: options.repoName, label: options.repoName } : { label: "All repos" },
    repoCount: repos.length,
    reposScanned,
    changeCount: changes.length,
    returnedChangeCount: returnedChanges.length,
    isTruncated: returnedChanges.length < changes.length,
    changes: returnedChanges,
  };
}

function reposForScope(repos: RepoSummary[], repoName?: string) {
  if (!repoName) {
    return repos;
  }

  const repo = repos.find((candidate) => candidate.name === repoName);
  if (!repo) {
    throw new Error("Repository is not in the current workspace index.");
  }

  return [repo];
}

async function gitStatus(repoPath: string): Promise<RawGitChange[]> {
  const proc = Bun.spawn(["git", "-C", repoPath, "status", "--porcelain=v1", "-z", "--untracked-files=all"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, , exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    return [];
  }

  return parsePorcelainStatus(stdout);
}

function parsePorcelainStatus(output: string): RawGitChange[] {
  const records = output.split("\0");
  const changes: RawGitChange[] = [];

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) {
      continue;
    }

    const code = record.slice(0, 2);
    const repoRelativePath = normalizeGitPath(record.slice(3));
    if (!repoRelativePath) {
      continue;
    }

    let previousRepoRelativePath: string | undefined;
    if (code.includes("R") || code.includes("C")) {
      const previousRecord = records[index + 1];
      if (previousRecord) {
        previousRepoRelativePath = normalizeGitPath(previousRecord);
        index += 1;
      }
    }

    changes.push({
      code,
      repoRelativePath,
      previousRepoRelativePath,
    });
  }

  return changes;
}

function noteChangeFromGitStatus(
  repoName: string,
  change: RawGitChange,
  indexedNotes: Map<string, NoteSummary>,
): GitChangedNote | null {
  const notePath = notePathFromRepoRelativePath(repoName, change.repoRelativePath);
  const previousNotePath = change.previousRepoRelativePath
    ? notePathFromRepoRelativePath(repoName, change.previousRepoRelativePath)
    : null;
  const changedNotePath = notePath ?? previousNotePath;
  if (!changedNotePath) {
    return null;
  }

  const indexedNote = indexedNotes.get(changedNotePath.rootRelativePath) ?? null;
  return {
    id: Buffer.from(`${repoName}:${change.code}:${change.repoRelativePath}:${change.previousRepoRelativePath ?? ""}`).toString(
      "base64url",
    ),
    repoName,
    repoRelativePath: notePath?.repoRelativePath ?? changedNotePath.repoRelativePath,
    rootRelativePath: notePath?.rootRelativePath ?? changedNotePath.rootRelativePath,
    previousRepoRelativePath: previousNotePath?.repoRelativePath,
    previousRootRelativePath: previousNotePath?.rootRelativePath,
    status: statusForCode(change.code),
    staged: isStaged(change.code),
    unstaged: isUnstaged(change.code),
    isIndexed: indexedNote !== null,
    extension: changedNotePath.extension,
    kind: noteKindForExtension(changedNotePath.extension),
    title: indexedNote?.title ?? titleFromPath(changedNotePath.repoRelativePath),
  };
}

function notePathFromRepoRelativePath(repoName: string, repoRelativePath: string) {
  const normalizedPath = normalizeGitPath(repoRelativePath);
  try {
    const extension = assertSupportedNoteExtension(normalizedPath);
    assertAllowedNotePath(normalizedPath);
    return {
      repoRelativePath: normalizedPath,
      rootRelativePath: `${repoName}/${normalizedPath}`,
      extension,
    };
  } catch {
    return null;
  }
}

function statusForCode(code: string): GitChangeStatus {
  const [staged = " ", unstaged = " "] = code;

  if (code === "??") {
    return "untracked";
  }

  if (code.includes("U") || code === "AA" || code === "DD") {
    return "conflicted";
  }

  if (staged === "R" || unstaged === "R") {
    return "renamed";
  }

  if (staged === "C" || unstaged === "C") {
    return "copied";
  }

  if (staged === "D" || unstaged === "D") {
    return "deleted";
  }

  if (staged === "A" || unstaged === "A") {
    return "added";
  }

  if (staged === "T" || unstaged === "T") {
    return "typechange";
  }

  return "modified";
}

function isStaged(code: string) {
  const staged = code[0] ?? " ";
  return staged !== " " && staged !== "?";
}

function isUnstaged(code: string) {
  const unstaged = code[1] ?? " ";
  return unstaged !== " " || code === "??";
}

function normalizeGitPath(path: string) {
  return path.replaceAll("\\", "/").replaceAll(/^\.\//g, "");
}

function titleFromPath(filePath: string) {
  const extension = extname(filePath).toLowerCase() as SupportedNoteExtension;
  return basename(filePath, extension).replaceAll(/[-_]+/g, " ");
}

function compareChanges(left: GitChangedNote, right: GitChangedNote) {
  if (left.repoName !== right.repoName) {
    return left.repoName.localeCompare(right.repoName);
  }

  const statusDelta = statusRank(left.status) - statusRank(right.status);
  if (statusDelta !== 0) {
    return statusDelta;
  }

  return left.repoRelativePath.localeCompare(right.repoRelativePath);
}

function statusRank(status: GitChangeStatus) {
  switch (status) {
    case "modified":
      return 0;
    case "added":
    case "untracked":
      return 1;
    case "renamed":
    case "copied":
      return 2;
    case "deleted":
      return 3;
    case "typechange":
      return 4;
    case "conflicted":
      return 5;
  }
}

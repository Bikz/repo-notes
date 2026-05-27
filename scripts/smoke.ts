import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  DeleteNotePayload,
  DocBacklinksPayload,
  DeleteNoteRequest,
  DocReviewPayload,
  DocSearchPayload,
  GitChangesPayload,
  GitDiffPayload,
  MoveNoteRequest,
  NoteFilePayload,
  WorkspaceConfig,
  WorkspaceIndex,
} from "../src/shared/types";

const root = await mkdtemp(join(tmpdir(), "repo-notes-smoke-"));
const workspaceRoot = join(root, "workspace");
const configPath = join(root, "config", "config.json");
const port = await reservePort();
const baseUrl = `http://127.0.0.1:${port}`;
const server = Bun.spawn(["bun", "run", "src/server/index.ts"], {
  env: {
    ...process.env,
    PORT: String(port),
    REPO_NOTES_CONFIG_PATH: configPath,
  },
  stdout: "pipe",
  stderr: "pipe",
});

try {
  await seedWorkspace(workspaceRoot);
  await waitForHealth(baseUrl);

  const config = await requestJson<WorkspaceConfig>(`${baseUrl}/api/config`, {
    method: "PUT",
    body: JSON.stringify({ rootPath: workspaceRoot }),
  });
  assert(config.rootExists, "config root should exist");

  const index = await requestJson<WorkspaceIndex>(`${baseUrl}/api/index`);
  assert(index.repos.length === 1, "expected one indexed repository");
  assert(index.notes.length === 3, "expected three indexed notes");
  assert(index.notes.some((note) => note.rootRelativePath === "alpha/docs/README.md"), "README should be indexed");

  await writeFile(join(root, "outside.md"), "# Outside\n", "utf8");
  await symlink(join(root, "outside.md"), join(workspaceRoot, "alpha", "docs", "escaped.md"));
  await assertRejects(
    requestJson<NoteFilePayload>(`${baseUrl}/api/files?path=${encodeURIComponent("alpha/docs/escaped.md")}`),
    "symlink",
  );

  const review = await requestJson<DocReviewPayload>(`${baseUrl}/api/review?repo=alpha&force=1`);
  assert(review.notesReviewed === 3, "review should scan indexed notes");
  assert(review.issues.some((issue) => issue.category === "broken-link"), "review should flag broken local links");
  assert(review.issues.some((issue) => issue.category === "todo-marker"), "review should flag unresolved markers");

  const search = await requestJson<DocSearchPayload>(
    `${baseUrl}/api/search?repo=alpha&q=${encodeURIComponent("follow-up")}`,
  );
  assert(search.searchedNotes === 3, "search should scan indexed notes in the selected repo");
  assert(search.results.some((result) => result.note.rootRelativePath === "alpha/docs/README.md"), "search should find body matches");

  const backlinks = await requestJson<DocBacklinksPayload>(
    `${baseUrl}/api/backlinks?path=${encodeURIComponent("alpha/docs/page.html")}&force=1`,
  );
  assert(backlinks.target.rootRelativePath === "alpha/docs/page.html", "backlinks target should match");
  assert(
    backlinks.backlinks.some((backlink) => backlink.source.rootRelativePath === "alpha/docs/README.md"),
    "backlinks should report README as linking to the HTML page",
  );

  const readPayload = await requestJson<NoteFilePayload>(
    `${baseUrl}/api/files?path=${encodeURIComponent("alpha/docs/README.md")}`,
  );
  assert(readPayload.note.kind === "markdown", "README should render as markdown");

  const updatedPayload = await requestJson<NoteFilePayload>(`${baseUrl}/api/files`, {
    method: "PUT",
    body: JSON.stringify({
      rootRelativePath: "alpha/docs/README.md",
      content: "# Updated smoke note\n",
      expectedUpdatedAtMs: readPayload.note.updatedAtMs,
    }),
  });
  assert(updatedPayload.content === "# Updated smoke note\n", "update response should include new content");

  const movedPayload = await requestJson<NoteFilePayload>(`${baseUrl}/api/files`, {
    method: "PATCH",
    body: JSON.stringify({
      rootRelativePath: "alpha/docs/README.md",
      repoRelativePath: "docs/renamed-smoke-note.md",
      expectedUpdatedAtMs: updatedPayload.note.updatedAtMs,
    } satisfies MoveNoteRequest),
  });
  assert(movedPayload.note.rootRelativePath === "alpha/docs/renamed-smoke-note.md", "moved note path should match");
  await assertRejects(
    requestJson<NoteFilePayload>(`${baseUrl}/api/files?path=${encodeURIComponent("alpha/docs/README.md")}`),
    "ENOENT",
  );
  const movedIndex = await requestJson<WorkspaceIndex>(`${baseUrl}/api/index?force=1`);
  assert(
    movedIndex.notes.some((note) => note.rootRelativePath === "alpha/docs/renamed-smoke-note.md"),
    "moved note should be indexed at the new path",
  );
  const movedSearch = await requestJson<DocSearchPayload>(
    `${baseUrl}/api/search?repo=alpha&q=${encodeURIComponent("Updated smoke")}`,
  );
  assert(
    movedSearch.results.some((result) => result.note.rootRelativePath === "alpha/docs/renamed-smoke-note.md"),
    "search should find moved note content at the new path",
  );

  const createdPayload = await requestJson<NoteFilePayload>(`${baseUrl}/api/files`, {
    method: "POST",
    body: JSON.stringify({
      repoName: "alpha",
      repoRelativePath: "notes/new-smoke-note.md",
      content: "# New smoke note\n",
    }),
  });
  assert(createdPayload.note.rootRelativePath === "alpha/notes/new-smoke-note.md", "created note path should match");

  const createdContent = await readFile(join(workspaceRoot, "alpha", "notes", "new-smoke-note.md"), "utf8");
  assert(createdContent === "# New smoke note\n", "created file should be persisted on disk");

  const deletedPayload = await requestJson<DeleteNotePayload>(`${baseUrl}/api/files`, {
    method: "DELETE",
    body: JSON.stringify({
      rootRelativePath: "alpha/notes/new-smoke-note.md",
      expectedUpdatedAtMs: createdPayload.note.updatedAtMs,
    } satisfies DeleteNoteRequest),
  });
  assert(deletedPayload.note.rootRelativePath === "alpha/notes/new-smoke-note.md", "deleted note path should match");
  await assertRejects(
    requestJson<NoteFilePayload>(`${baseUrl}/api/files?path=${encodeURIComponent("alpha/notes/new-smoke-note.md")}`),
    "ENOENT",
  );
  const deletedIndex = await requestJson<WorkspaceIndex>(`${baseUrl}/api/index?force=1`);
  assert(
    !deletedIndex.notes.some((note) => note.rootRelativePath === "alpha/notes/new-smoke-note.md"),
    "deleted note should be removed from the index",
  );

  const gitChanges = await requestJson<GitChangesPayload>(`${baseUrl}/api/git/changes?repo=alpha&force=1`);
  assert(gitChanges.reposScanned === 1, "git changes should scan the selected git repo");
  assert(
    gitChanges.changes.some(
      (change) => change.rootRelativePath === "alpha/docs/README.md" && change.status === "deleted",
    ),
    "git changes should report the moved source path as deleted",
  );
  assert(
    gitChanges.changes.some(
      (change) => change.rootRelativePath === "alpha/docs/renamed-smoke-note.md" && change.status === "untracked",
    ),
    "git changes should report the moved destination path as untracked",
  );
  const gitDiff = await requestJson<GitDiffPayload>(
    `${baseUrl}/api/git/diff?path=${encodeURIComponent("alpha/docs/renamed-smoke-note.md")}&force=1`,
  );
  assert(gitDiff.status === "untracked", "git diff should report the moved destination status");
  assert(
    gitDiff.lines.some((line) => line.kind === "added" && line.text.includes("Updated smoke note")),
    "git diff should show bounded added content for the selected changed note",
  );

  console.log("Smoke passed: configured, indexed, reviewed, read, updated, moved, created, deleted, checked git-changed notes, and previewed a git diff in a disposable workspace.");
} finally {
  server.kill();
  await server.exited.catch(() => undefined);
  await rm(root, { recursive: true, force: true });
}

async function seedWorkspace(path: string) {
  await mkdir(join(path, "alpha", "docs"), { recursive: true });
  await mkdir(join(path, "alpha", "notes"), { recursive: true });
  await mkdir(join(path, "alpha", "node_modules", "pkg"), { recursive: true });
  await writeFile(
    join(path, "alpha", "docs", "README.md"),
    "# Smoke note\n\nSee [missing](missing.md) and [page](page.html).\nTODO: smoke follow-up.\n",
    "utf8",
  );
  await writeFile(join(path, "alpha", "docs", "page.html"), "<h1>Smoke page</h1>", "utf8");
  await writeFile(join(path, "alpha", "notes", "todo.txt"), "Smoke todo\n", "utf8");
  await writeFile(join(path, "alpha", "node_modules", "pkg", "ignored.md"), "# Ignored\n", "utf8");
  const repoPath = join(path, "alpha");
  await runGit(repoPath, ["init"]);
  await runGit(repoPath, ["config", "user.email", "repo-notes@example.com"]);
  await runGit(repoPath, ["config", "user.name", "Repo Notes"]);
  await runGit(repoPath, ["add", "."]);
  await runGit(repoPath, ["commit", "-m", "Initial smoke docs"]);
}

async function reservePort() {
  const probe = Bun.serve({
    port: 0,
    fetch() {
      return new Response("ok");
    },
  });
  const nextPort = probe.port;
  await probe.stop(true);
  return nextPort;
}

async function waitForHealth(url: string) {
  const deadline = Date.now() + 5000;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) {
        return;
      }
    } catch {
      await Bun.sleep(100);
    }
  }

  const stderr = await new Response(server.stderr).text().catch(() => "");
  throw new Error(`API did not become healthy. ${stderr}`);
}

async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init.headers,
    },
  });
  const payload = (await response.json().catch(() => null)) as T | { error?: unknown } | null;

  if (!response.ok) {
    const errorMessage =
      payload !== null &&
      typeof payload === "object" &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : `Request failed with ${response.status}`;
    throw new Error(errorMessage);
  }

  return payload as T;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function assertRejects(promise: Promise<unknown>, expectedMessage: string) {
  try {
    await promise;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert(message.includes(expectedMessage), `expected rejection to include ${expectedMessage}, got ${message}`);
    return;
  }

  throw new Error(`Expected promise to reject with ${expectedMessage}`);
}

async function runGit(cwd: string, args: string[]) {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${stdout}${stderr}`);
  }
}

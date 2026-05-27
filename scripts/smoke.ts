import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  DocReviewPayload,
  DocSearchPayload,
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

  console.log("Smoke passed: configured, indexed, reviewed, read, updated, and created notes in a disposable workspace.");
} finally {
  server.kill();
  await server.exited.catch(() => undefined);
  await rm(root, { recursive: true, force: true });
}

async function seedWorkspace(path: string) {
  await mkdir(join(path, "alpha", ".git"), { recursive: true });
  await mkdir(join(path, "alpha", "docs"), { recursive: true });
  await mkdir(join(path, "alpha", "notes"), { recursive: true });
  await mkdir(join(path, "alpha", "node_modules", "pkg"), { recursive: true });
  await writeFile(
    join(path, "alpha", "docs", "README.md"),
    "# Smoke note\n\nSee [missing](missing.md).\nTODO: smoke follow-up.\n",
    "utf8",
  );
  await writeFile(join(path, "alpha", "docs", "page.html"), "<h1>Smoke page</h1>", "utf8");
  await writeFile(join(path, "alpha", "notes", "todo.txt"), "Smoke todo\n", "utf8");
  await writeFile(join(path, "alpha", "node_modules", "pkg", "ignored.md"), "# Ignored\n", "utf8");
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

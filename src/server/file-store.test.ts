import { afterAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNoteFile, deleteNoteFile, moveNoteFile, readNoteFile, writeNoteFile } from "./file-store";

const roots: string[] = [];

async function createTempWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "repo-notes-files-"));
  roots.push(root);

  await mkdir(join(root, "alpha", ".git"), { recursive: true });
  await mkdir(join(root, "alpha", "docs"), { recursive: true });
  await writeFile(join(root, "alpha", "docs", "plan.md"), "# Plan\n");

  return root;
}

afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

test("readNoteFile returns note metadata and content", async () => {
  const root = await createTempWorkspace();

  const payload = await readNoteFile(root, "alpha/docs/plan.md");

  expect(payload.content).toBe("# Plan\n");
  expect(payload.note.rootRelativePath).toBe("alpha/docs/plan.md");
  expect(payload.note.kind).toBe("markdown");
});

test("writeNoteFile updates an existing note in place", async () => {
  const root = await createTempWorkspace();
  const before = await readNoteFile(root, "alpha/docs/plan.md");

  const payload = await writeNoteFile(root, {
    rootRelativePath: "alpha/docs/plan.md",
    content: "# Updated\n",
    expectedUpdatedAtMs: before.note.updatedAtMs,
  });

  expect(payload.content).toBe("# Updated\n");
  await expect(readFile(join(root, "alpha", "docs", "plan.md"), "utf8")).resolves.toBe("# Updated\n");
});

test("writeNoteFile rejects stale writes without overwriting the file", async () => {
  const root = await createTempWorkspace();

  await expect(
    writeNoteFile(root, {
      rootRelativePath: "alpha/docs/plan.md",
      content: "# Stale update\n",
      expectedUpdatedAtMs: 0,
    }),
  ).rejects.toThrow("changed on disk");
  await expect(readFile(join(root, "alpha", "docs", "plan.md"), "utf8")).resolves.toBe("# Plan\n");
});

test("createNoteFile creates a new supported file without overwriting", async () => {
  const root = await createTempWorkspace();

  const payload = await createNoteFile(root, {
    repoName: "alpha",
    repoRelativePath: "docs/new-note.txt",
    content: "New note\n",
  });

  expect(payload.note.rootRelativePath).toBe("alpha/docs/new-note.txt");
  expect(payload.content).toBe("New note\n");
  await expect(
    createNoteFile(root, {
      repoName: "alpha",
      repoRelativePath: "docs/new-note.txt",
      content: "Overwrite\n",
    }),
  ).rejects.toThrow("already exists");
});

test("moveNoteFile renames an existing note inside the same repository", async () => {
  const root = await createTempWorkspace();
  const before = await readNoteFile(root, "alpha/docs/plan.md");

  const payload = await moveNoteFile(root, {
    rootRelativePath: "alpha/docs/plan.md",
    repoRelativePath: "notes/renamed-plan.md",
    expectedUpdatedAtMs: before.note.updatedAtMs,
  });

  expect(payload.note.rootRelativePath).toBe("alpha/notes/renamed-plan.md");
  expect(payload.content).toBe("# Plan\n");
  await expect(readFile(join(root, "alpha", "docs", "plan.md"), "utf8")).rejects.toThrow();
  await expect(readFile(join(root, "alpha", "notes", "renamed-plan.md"), "utf8")).resolves.toBe("# Plan\n");
});

test("moveNoteFile rejects stale moves and existing destinations", async () => {
  const root = await createTempWorkspace();
  await mkdir(join(root, "alpha", "notes"), { recursive: true });
  await writeFile(join(root, "alpha", "notes", "existing.md"), "# Existing\n");
  const before = await readNoteFile(root, "alpha/docs/plan.md");

  await expect(
    moveNoteFile(root, {
      rootRelativePath: "alpha/docs/plan.md",
      repoRelativePath: "notes/stale-plan.md",
      expectedUpdatedAtMs: 0,
    }),
  ).rejects.toThrow("changed on disk");
  await expect(
    moveNoteFile(root, {
      rootRelativePath: "alpha/docs/plan.md",
      repoRelativePath: "notes/existing.md",
      expectedUpdatedAtMs: before.note.updatedAtMs,
    }),
  ).rejects.toThrow("already exists");
  await expect(readFile(join(root, "alpha", "docs", "plan.md"), "utf8")).resolves.toBe("# Plan\n");
  await expect(readFile(join(root, "alpha", "notes", "existing.md"), "utf8")).resolves.toBe("# Existing\n");
});

test("deleteNoteFile removes an existing note with current disk state", async () => {
  const root = await createTempWorkspace();
  const before = await readNoteFile(root, "alpha/docs/plan.md");

  const payload = await deleteNoteFile(root, {
    rootRelativePath: "alpha/docs/plan.md",
    expectedUpdatedAtMs: before.note.updatedAtMs,
  });

  expect(payload.note.rootRelativePath).toBe("alpha/docs/plan.md");
  await expect(readFile(join(root, "alpha", "docs", "plan.md"), "utf8")).rejects.toThrow();
  await expect(readNoteFile(root, "alpha/docs/plan.md")).rejects.toThrow();
});

test("deleteNoteFile rejects stale and symlinked notes without removing targets", async () => {
  const root = await createTempWorkspace();
  const outsideRoot = await mkdtemp(join(tmpdir(), "repo-notes-delete-outside-"));
  roots.push(outsideRoot);
  const outsideNotePath = join(outsideRoot, "secret.md");
  await writeFile(outsideNotePath, "# Outside\n");
  await symlink(outsideNotePath, join(root, "alpha", "docs", "outside.md"));

  await expect(
    deleteNoteFile(root, {
      rootRelativePath: "alpha/docs/plan.md",
      expectedUpdatedAtMs: 0,
    }),
  ).rejects.toThrow("changed on disk");
  await expect(
    deleteNoteFile(root, {
      rootRelativePath: "alpha/docs/outside.md",
      expectedUpdatedAtMs: 0,
    }),
  ).rejects.toThrow("symlink");
  await expect(readFile(join(root, "alpha", "docs", "plan.md"), "utf8")).resolves.toBe("# Plan\n");
  await expect(readFile(outsideNotePath, "utf8")).resolves.toBe("# Outside\n");
});

test("file operations reject traversal and unsupported extensions", async () => {
  const root = await createTempWorkspace();

  await expect(readNoteFile(root, "../secret.md")).rejects.toThrow("outside");
  await expect(
    createNoteFile(root, {
      repoName: "alpha",
      repoRelativePath: "notes/config.json",
      content: "{}",
    }),
  ).rejects.toThrow("Unsupported");
});

test("file operations reject ignored workspace directories", async () => {
  const root = await createTempWorkspace();
  await mkdir(join(root, "alpha", "node_modules", "pkg"), { recursive: true });
  await writeFile(join(root, "alpha", "node_modules", "pkg", "README.md"), "# Dependency\n");

  await expect(readNoteFile(root, "alpha/node_modules/pkg/README.md")).rejects.toThrow("ignored");
  await expect(
    writeNoteFile(root, {
      rootRelativePath: "alpha/node_modules/pkg/README.md",
      content: "# Updated\n",
      expectedUpdatedAtMs: 0,
    }),
  ).rejects.toThrow("ignored");
  await expect(
    createNoteFile(root, {
      repoName: "alpha",
      repoRelativePath: "dist/generated.md",
      content: "# Generated\n",
    }),
  ).rejects.toThrow("ignored");
});

test("file operations reject symlinked notes before reading or writing outside the workspace", async () => {
  const root = await createTempWorkspace();
  const outsideRoot = await mkdtemp(join(tmpdir(), "repo-notes-outside-"));
  roots.push(outsideRoot);
  const outsideNotePath = join(outsideRoot, "secret.md");
  await writeFile(outsideNotePath, "# Outside\n");
  await symlink(outsideNotePath, join(root, "alpha", "docs", "outside.md"));
  const outsideStat = await stat(outsideNotePath);

  await expect(readNoteFile(root, "alpha/docs/outside.md")).rejects.toThrow("symlink");
  await expect(
    writeNoteFile(root, {
      rootRelativePath: "alpha/docs/outside.md",
      content: "# Overwritten\n",
      expectedUpdatedAtMs: outsideStat.mtimeMs,
    }),
  ).rejects.toThrow("symlink");
  await expect(readFile(outsideNotePath, "utf8")).resolves.toBe("# Outside\n");
});

test("createNoteFile rejects symlinked parent directories before writing outside the selected repo", async () => {
  const root = await createTempWorkspace();
  const outsideRoot = await mkdtemp(join(tmpdir(), "repo-notes-create-outside-"));
  roots.push(outsideRoot);
  await rm(join(root, "alpha", "docs"), { recursive: true, force: true });
  await symlink(outsideRoot, join(root, "alpha", "docs"));

  await expect(
    createNoteFile(root, {
      repoName: "alpha",
      repoRelativePath: "docs/escaped.md",
      content: "# Escaped\n",
    }),
  ).rejects.toThrow("symlink");
  await expect(readFile(join(outsideRoot, "escaped.md"), "utf8")).rejects.toThrow();
});

test("moveNoteFile rejects traversal and symlinked destination parents", async () => {
  const root = await createTempWorkspace();
  await mkdir(join(root, "beta"), { recursive: true });
  const outsideRoot = await mkdtemp(join(tmpdir(), "repo-notes-move-outside-"));
  roots.push(outsideRoot);
  await symlink(outsideRoot, join(root, "alpha", "linked"));
  const before = await readNoteFile(root, "alpha/docs/plan.md");

  await expect(
    moveNoteFile(root, {
      rootRelativePath: "alpha/docs/plan.md",
      repoRelativePath: "../beta/hijack.md",
      expectedUpdatedAtMs: before.note.updatedAtMs,
    }),
  ).rejects.toThrow("selected repository");
  await expect(
    moveNoteFile(root, {
      rootRelativePath: "alpha/docs/plan.md",
      repoRelativePath: "linked/escaped.md",
      expectedUpdatedAtMs: before.note.updatedAtMs,
    }),
  ).rejects.toThrow("symlink");
  await expect(readFile(join(root, "alpha", "docs", "plan.md"), "utf8")).resolves.toBe("# Plan\n");
  await expect(readFile(join(outsideRoot, "escaped.md"), "utf8")).rejects.toThrow();
});

test("createNoteFile keeps new files inside the selected repository", async () => {
  const root = await createTempWorkspace();
  await mkdir(join(root, "beta"), { recursive: true });

  await expect(
    createNoteFile(root, {
      repoName: "alpha",
      repoRelativePath: "../beta/hijack.md",
      content: "# Hijack\n",
    }),
  ).rejects.toThrow("selected repository");
});

import { afterAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNoteFile, readNoteFile, writeNoteFile } from "./file-store";

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

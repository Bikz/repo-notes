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

  const payload = await writeNoteFile(root, {
    rootRelativePath: "alpha/docs/plan.md",
    content: "# Updated\n",
  });

  expect(payload.content).toBe("# Updated\n");
  await expect(readFile(join(root, "alpha", "docs", "plan.md"), "utf8")).resolves.toBe("# Updated\n");
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


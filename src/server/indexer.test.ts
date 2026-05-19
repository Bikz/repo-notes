import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanWorkspace } from "./indexer";

const roots: string[] = [];

async function createTempWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "repo-notes-indexer-"));
  roots.push(root);

  await mkdir(join(root, "alpha", ".git"), { recursive: true });
  await mkdir(join(root, "alpha", "docs"), { recursive: true });
  await mkdir(join(root, "alpha", "node_modules", "pkg"), { recursive: true });
  await mkdir(join(root, "alpha", "dist"), { recursive: true });
  await mkdir(join(root, "alpha", ".cache"), { recursive: true });
  await mkdir(join(root, "alpha", "deps", "vendored"), { recursive: true });
  await mkdir(join(root, "beta", ".git"), { recursive: true });
  await mkdir(join(root, "beta", "notes"), { recursive: true });

  await writeFile(join(root, "alpha", "README.md"), "# Alpha\n");
  await writeFile(join(root, "alpha", "docs", "plan.txt"), "Ship the thing.\n");
  await writeFile(join(root, "alpha", "docs", "page.html"), "<h1>Alpha page</h1>");
  await writeFile(join(root, "alpha", "node_modules", "pkg", "README.md"), "# Dependency\n");
  await writeFile(join(root, "alpha", "dist", "build-note.md"), "# Build output\n");
  await writeFile(join(root, "alpha", ".cache", "artifact.md"), "# Cache output\n");
  await writeFile(join(root, "alpha", "deps", "vendored", "README.md"), "# Vendored dep\n");
  await writeFile(join(root, "alpha", "image.png"), "not a note");
  await writeFile(join(root, "beta", "notes", "decision.markdown"), "# Decision\n");

  return root;
}

afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

test("scanWorkspace indexes supported note files across child repositories", async () => {
  const root = await createTempWorkspace();

  const index = await scanWorkspace(root);

  expect(index.rootPath).toBe(root);
  expect(index.repos.map((repo) => repo.name)).toEqual(["alpha", "beta"]);
  expect(index.notes.map((note) => note.rootRelativePath)).toEqual([
    "alpha/README.md",
    "alpha/docs/page.html",
    "alpha/docs/plan.txt",
    "beta/notes/decision.markdown",
  ]);
  expect(index.notes.every((note) => note.byteSize > 0)).toBe(true);
});

test("scanWorkspace skips generated and dependency directories", async () => {
  const root = await createTempWorkspace();

  const index = await scanWorkspace(root);

  expect(index.notes.some((note) => note.rootRelativePath.includes("node_modules"))).toBe(false);
  expect(index.notes.some((note) => note.rootRelativePath.includes("dist"))).toBe(false);
  expect(index.notes.some((note) => note.rootRelativePath.includes(".cache"))).toBe(false);
  expect(index.notes.some((note) => note.rootRelativePath.includes("deps"))).toBe(false);
});

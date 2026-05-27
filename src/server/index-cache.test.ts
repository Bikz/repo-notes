import { afterAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getWorkspaceIndex, refreshWorkspaceIndex } from "./index-cache";

const roots: string[] = [];

async function createTempWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "repo-notes-index-cache-"));
  roots.push(root);

  await mkdir(join(root, "alpha", ".git"), { recursive: true });
  await writeFile(join(root, "alpha", "README.md"), "# Alpha\n");

  return root;
}

afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

test("getWorkspaceIndex returns cached metadata until a forced refresh", async () => {
  const root = await createTempWorkspace();
  const stateDirectory = join(root, "state");

  const firstIndex = await refreshWorkspaceIndex(root, { stateDirectory });
  expect(firstIndex.cacheStatus).toBe("fresh");
  expect(firstIndex.notes.map((note) => note.rootRelativePath)).toEqual(["alpha/README.md"]);

  await writeFile(join(root, "alpha", "ROADMAP.md"), "# Roadmap\n");

  const cachedIndex = await getWorkspaceIndex(root, { stateDirectory });
  expect(cachedIndex.cacheStatus).toBe("cached");
  expect(cachedIndex.notes.map((note) => note.rootRelativePath)).toEqual(["alpha/README.md"]);

  const refreshedIndex = await getWorkspaceIndex(root, { force: true, stateDirectory });
  expect(refreshedIndex.cacheStatus).toBe("fresh");
  expect(refreshedIndex.notes.map((note) => note.rootRelativePath)).toEqual([
    "alpha/README.md",
    "alpha/ROADMAP.md",
  ]);
});

import { afterAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanWorkspace } from "./indexer";
import { searchWorkspaceDocs } from "./search";

const roots: string[] = [];

async function createSearchWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "repo-notes-search-"));
  roots.push(root);

  await mkdir(join(root, "alpha", "docs"), { recursive: true });
  await mkdir(join(root, "beta", "docs"), { recursive: true });
  await writeFile(
    join(root, "alpha", "docs", "roadmap.md"),
    ["# Roadmap", "", "The launch narrative needs a stronger customer promise.", "Keep this local."].join("\n"),
  );
  await writeFile(join(root, "alpha", "docs", "setup.md"), "# Setup\n\nInstall the app.\n");
  await writeFile(join(root, "beta", "docs", "notes.md"), "# Notes\n\nThe roadmap differs here.\n");

  return root;
}

afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

test("searchWorkspaceDocs finds body matches that are not in note metadata", async () => {
  const root = await createSearchWorkspace();
  const index = await scanWorkspace(root);

  const search = await searchWorkspaceDocs(root, index, {
    query: "customer promise",
    repoName: "alpha",
  });

  expect(search.scope).toEqual({ repoName: "alpha", label: "alpha" });
  expect(search.searchedNotes).toBe(2);
  expect(search.resultCount).toBe(1);
  expect(search.results[0]).toEqual(
    expect.objectContaining({
      matchKind: "content",
      line: 3,
      snippet: expect.stringContaining("customer promise"),
    }),
  );
  expect(search.results[0]?.note.rootRelativePath).toBe("alpha/docs/roadmap.md");
  expect(JSON.stringify(search)).not.toContain("Keep this local.");
});

test("searchWorkspaceDocs ranks metadata matches before content-only matches and caps returned results", async () => {
  const root = await createSearchWorkspace();
  const index = await scanWorkspace(root);

  const search = await searchWorkspaceDocs(root, index, {
    query: "roadmap",
    maxReturnedResults: 1,
  });

  expect(search.resultCount).toBeGreaterThan(1);
  expect(search.returnedResultCount).toBe(1);
  expect(search.results).toHaveLength(1);
  expect(search.results[0]?.note.rootRelativePath).toBe("alpha/docs/roadmap.md");
  expect(search.results[0]?.matchKind).toBe("metadata");
});

test("searchWorkspaceDocs skips unsafe symlinked indexed notes without reading outside the workspace", async () => {
  const root = await createSearchWorkspace();
  const index = await scanWorkspace(root);
  const outsideRoot = await mkdtemp(join(tmpdir(), "repo-notes-search-outside-"));
  roots.push(outsideRoot);
  await writeFile(join(outsideRoot, "external.md"), "# External\n\nsecret launch narrative\n");
  await rm(join(root, "alpha", "docs", "roadmap.md"));
  await symlink(join(outsideRoot, "external.md"), join(root, "alpha", "docs", "roadmap.md"));

  const search = await searchWorkspaceDocs(root, index, {
    query: "secret launch narrative",
    repoName: "alpha",
  });

  expect(search.resultCount).toBe(0);
  expect(JSON.stringify(search)).not.toContain("External");
});

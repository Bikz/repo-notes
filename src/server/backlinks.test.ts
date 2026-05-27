import { afterAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getWorkspaceBacklinks } from "./backlinks";
import { scanWorkspace } from "./indexer";

const roots: string[] = [];

async function createBacklinkWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "repo-notes-backlinks-"));
  roots.push(root);

  await mkdir(join(root, "alpha", "docs", "guides"), { recursive: true });
  await mkdir(join(root, "beta", "docs"), { recursive: true });
  await writeFile(join(root, "alpha", "docs", "target.md"), "# Target\n", "utf8");
  await writeFile(
    join(root, "alpha", "docs", "guides", "start.md"),
    [
      "# Start",
      "",
      "See [Target](../target.md#setup).",
      "Ignore ![Target image](../target.md).",
      "Ignore [external](https://example.com/target.md).",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(join(root, "alpha", "docs", "absolute.md"), "See [Target](/docs/target.md).\n", "utf8");
  await writeFile(join(root, "beta", "docs", "other.md"), "See [Target](../../alpha/docs/target.md).\n", "utf8");

  return root;
}

afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

test("getWorkspaceBacklinks finds same-repo markdown links to a target note", async () => {
  const root = await createBacklinkWorkspace();
  const index = await scanWorkspace(root);

  const backlinks = await getWorkspaceBacklinks(root, index, "alpha/docs/target.md");

  expect(backlinks.target.rootRelativePath).toBe("alpha/docs/target.md");
  expect(backlinks.backlinkCount).toBe(2);
  expect(backlinks.returnedBacklinkCount).toBe(2);
  expect(backlinks.isTruncated).toBe(false);
  expect(backlinks.backlinks.map((backlink) => backlink.source.rootRelativePath)).toEqual([
    "alpha/docs/absolute.md",
    "alpha/docs/guides/start.md",
  ]);
  expect(backlinks.backlinks.find((backlink) => backlink.source.rootRelativePath.endsWith("start.md"))).toMatchObject({
    line: 3,
  });
  expect(backlinks.backlinks.some((backlink) => backlink.source.rootRelativePath.startsWith("beta/"))).toBe(false);
});

test("getWorkspaceBacklinks caps returned backlinks", async () => {
  const root = await createBacklinkWorkspace();
  const index = await scanWorkspace(root);

  const backlinks = await getWorkspaceBacklinks(root, index, "alpha/docs/target.md", { maxReturnedBacklinks: 1 });

  expect(backlinks.backlinkCount).toBe(2);
  expect(backlinks.returnedBacklinkCount).toBe(1);
  expect(backlinks.isTruncated).toBe(true);
  expect(backlinks.backlinks).toHaveLength(1);
});

test("getWorkspaceBacklinks rejects unknown target notes", async () => {
  const root = await createBacklinkWorkspace();
  const index = await scanWorkspace(root);

  await expect(getWorkspaceBacklinks(root, index, "alpha/docs/missing.md")).rejects.toThrow("not in the current index");
});

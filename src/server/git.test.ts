import { afterAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getWorkspaceGitChanges, getWorkspaceGitDiff } from "./git";
import { scanWorkspace } from "./indexer";

const roots: string[] = [];

async function createGitWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "repo-notes-git-"));
  roots.push(root);
  const repoPath = join(root, "alpha");
  await mkdir(join(repoPath, "docs"), { recursive: true });
  await mkdir(join(repoPath, "node_modules", "pkg"), { recursive: true });
  await writeFile(join(repoPath, "docs", "README.md"), "# Readme\n\nOriginal body\n", "utf8");
  await writeFile(join(repoPath, "docs", "old.md"), "# Old\n", "utf8");
  await writeFile(join(repoPath, "docs", "script.ts"), "export const value = 1;\n", "utf8");
  await writeFile(join(repoPath, "node_modules", "pkg", "ignored.md"), "# Ignored\n", "utf8");

  await runGit(repoPath, ["init"]);
  await runGit(repoPath, ["config", "user.email", "repo-notes@example.com"]);
  await runGit(repoPath, ["config", "user.name", "Repo Notes"]);
  await runGit(repoPath, ["add", "."]);
  await runGit(repoPath, ["commit", "-m", "Initial docs"]);

  return { root, repoPath };
}

afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

test("getWorkspaceGitChanges reports changed note files without reading file contents", async () => {
  const { root, repoPath } = await createGitWorkspace();
  await writeFile(join(repoPath, "docs", "README.md"), "# Readme\n\nUpdated private body text\n", "utf8");
  await writeFile(join(repoPath, "docs", "new.md"), "# New\n", "utf8");
  await writeFile(join(repoPath, "docs", "script.ts"), "export const value = 2;\n", "utf8");
  await writeFile(join(repoPath, "node_modules", "pkg", "ignored.md"), "# Changed ignored\n", "utf8");
  await rm(join(repoPath, "docs", "old.md"));

  const index = await scanWorkspace(root);
  const changes = await getWorkspaceGitChanges(root, index, { repoName: "alpha" });

  expect(changes.scope).toEqual({ repoName: "alpha", label: "alpha" });
  expect(changes.repoCount).toBe(1);
  expect(changes.changeCount).toBe(3);
  expect(changes.returnedChangeCount).toBe(3);
  expect(changes.changes.map((change) => `${change.status}:${change.rootRelativePath}`)).toEqual([
    "modified:alpha/docs/README.md",
    "untracked:alpha/docs/new.md",
    "deleted:alpha/docs/old.md",
  ]);
  expect(changes.changes.find((change) => change.repoRelativePath === "docs/README.md")).toMatchObject({
    isIndexed: true,
    staged: false,
    unstaged: true,
  });
  expect(changes.changes.find((change) => change.repoRelativePath === "docs/old.md")).toMatchObject({
    isIndexed: false,
  });
  expect(JSON.stringify(changes)).not.toContain("Updated private body text");
  expect(JSON.stringify(changes)).not.toContain("script.ts");
  expect(JSON.stringify(changes)).not.toContain("node_modules");
});

test("getWorkspaceGitDiff returns a bounded explicit diff for a changed note", async () => {
  const { root, repoPath } = await createGitWorkspace();
  await writeFile(
    join(repoPath, "docs", "README.md"),
    ["# Readme", "", "Updated line one", "Updated line two", "Updated line three"].join("\n"),
    "utf8",
  );
  await writeFile(join(repoPath, "docs", "script.ts"), "export const value = 2;\n", "utf8");
  const index = await scanWorkspace(root);

  const diff = await getWorkspaceGitDiff(root, index, "alpha/docs/README.md", { maxLines: 9, maxBytes: 10_000 });

  expect(diff.rootRelativePath).toBe("alpha/docs/README.md");
  expect(diff.status).toBe("modified");
  expect(diff.lineCount).toBe(9);
  expect(diff.isTruncated).toBe(true);
  expect(diff.lines.some((line) => line.kind === "removed" && line.text.includes("Original body"))).toBe(true);
  expect(diff.lines.some((line) => line.kind === "added" && line.text.includes("Updated line one"))).toBe(true);
  expect(JSON.stringify(diff)).not.toContain("script.ts");
});

test("getWorkspaceGitDiff supports deleted and untracked notes without broadening scope", async () => {
  const { root, repoPath } = await createGitWorkspace();
  await rm(join(repoPath, "docs", "old.md"));
  await writeFile(join(repoPath, "docs", "new.md"), "# New\n\nDraft handoff note.\n", "utf8");
  const index = await scanWorkspace(root);

  const deletedDiff = await getWorkspaceGitDiff(root, index, "alpha/docs/old.md");
  const untrackedDiff = await getWorkspaceGitDiff(root, index, "alpha/docs/new.md");

  expect(deletedDiff.status).toBe("deleted");
  expect(deletedDiff.lines.some((line) => line.kind === "removed" && line.text.includes("# Old"))).toBe(true);
  expect(untrackedDiff.status).toBe("untracked");
  expect(untrackedDiff.lines.some((line) => line.kind === "added" && line.text.includes("Draft handoff note"))).toBe(true);
  await expect(getWorkspaceGitDiff(root, index, "alpha/docs/script.ts")).rejects.toThrow("Unsupported");
  await expect(getWorkspaceGitDiff(root, index, "../outside.md")).rejects.toThrow("outside");
});

test("getWorkspaceGitChanges skips non-git repos and rejects unknown repo scopes", async () => {
  const { root } = await createGitWorkspace();
  await mkdir(join(root, "notes-only", "docs"), { recursive: true });
  await writeFile(join(root, "notes-only", "docs", "loose.md"), "# Loose\n", "utf8");
  const index = await scanWorkspace(root);

  const allChanges = await getWorkspaceGitChanges(root, index);
  expect(allChanges.reposScanned).toBe(1);
  expect(allChanges.changes.every((change) => change.repoName === "alpha")).toBe(true);

  await expect(getWorkspaceGitChanges(root, index, { repoName: "missing" })).rejects.toThrow("not in the current workspace index");
});

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

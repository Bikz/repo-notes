import { afterAll, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanWorkspace } from "./indexer";
import { reviewWorkspaceDocs } from "./review";

const roots: string[] = [];

async function createReviewWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "repo-notes-review-"));
  roots.push(root);

  await mkdir(join(root, "alpha", "docs"), { recursive: true });
  await mkdir(join(root, "alpha", "notes"), { recursive: true });
  await mkdir(join(root, "beta"), { recursive: true });

  await writeFile(
    join(root, "alpha", "README.md"),
    [
      "# Alpha",
      "",
      "See [missing](docs/missing.md), [ok](docs/ok.md), and [external](https://example.com).",
      "TODO: tighten launch copy.",
      "",
    ].join("\n"),
  );
  await writeFile(join(root, "alpha", "docs", "ok.md"), "# Ok\n");
  await writeFile(join(root, "alpha", "docs", "empty.md"), "   \n");
  await writeFile(join(root, "alpha", "docs", "roadmap.md"), "# Roadmap\n");
  await writeFile(join(root, "alpha", "notes", "roadmap.txt"), "Roadmap notes\n");
  await writeFile(join(root, "beta", "README.md"), "FIXME: beta follow-up\n");

  const oldDate = new Date(Date.UTC(2025, 0, 1));
  await utimes(join(root, "alpha", "docs", "ok.md"), oldDate, oldDate);

  return root;
}

afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

test("reviewWorkspaceDocs reports local doc health issues without returning file content", async () => {
  const root = await createReviewWorkspace();
  const index = await scanWorkspace(root);

  const review = await reviewWorkspaceDocs(root, index, {
    repoName: "alpha",
    nowMs: Date.UTC(2026, 0, 1),
    largeFileBytes: 8,
  });

  expect(review.scope).toEqual({ repoName: "alpha", label: "alpha" });
  expect(review.reposReviewed).toBe(1);
  expect(review.notesReviewed).toBe(5);
  expect(review.issues.map((issue) => issue.category)).toContain("broken-link");
  expect(review.issues.map((issue) => issue.category)).toContain("todo-marker");
  expect(review.issues.map((issue) => issue.category)).toContain("empty-doc");
  expect(review.issues.map((issue) => issue.category)).toContain("duplicate-title");
  expect(review.issues.map((issue) => issue.category)).toContain("stale-doc");
  expect(review.issues.map((issue) => issue.category)).toContain("large-file");
  expect(review.issues.some((issue) => issue.target === "alpha/docs/ok.md")).toBe(false);
  expect(review.issues.some((issue) => issue.target?.includes("https://"))).toBe(false);
  expect(JSON.stringify(review)).not.toContain("tighten launch copy");
});

test("reviewWorkspaceDocs can review all repos and cap returned issues", async () => {
  const root = await createReviewWorkspace();
  const index = await scanWorkspace(root);

  const review = await reviewWorkspaceDocs(root, index, {
    nowMs: Date.UTC(2026, 0, 1),
    maxReturnedIssues: 2,
  });

  expect(review.scope).toEqual({ label: "All repos" });
  expect(review.reposReviewed).toBe(2);
  expect(review.issueCount).toBeGreaterThan(2);
  expect(review.returnedIssueCount).toBe(2);
  expect(review.issues).toHaveLength(2);
}
);

test("reviewWorkspaceDocs reports an unsafe symlinked indexed note without reading outside the workspace", async () => {
  const root = await createReviewWorkspace();
  const index = await scanWorkspace(root);
  const outsideRoot = await mkdtemp(join(tmpdir(), "repo-notes-review-outside-"));
  roots.push(outsideRoot);
  await writeFile(join(outsideRoot, "external.md"), "# External\n");
  await rm(join(root, "alpha", "docs", "ok.md"));
  await symlink(join(outsideRoot, "external.md"), join(root, "alpha", "docs", "ok.md"));

  const review = await reviewWorkspaceDocs(root, index, {
    repoName: "alpha",
    nowMs: Date.UTC(2026, 0, 1),
  });

  expect(review.issues).toContainEqual(
    expect.objectContaining({
      category: "missing-file",
      rootRelativePath: "alpha/docs/ok.md",
    }),
  );
});

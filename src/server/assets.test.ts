import { afterAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolvePreviewAsset } from "./assets";

const roots: string[] = [];

async function createAssetWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "repo-notes-assets-"));
  roots.push(root);

  await mkdir(join(root, "alpha", "docs", "images"), { recursive: true });
  await mkdir(join(root, "beta", "docs"), { recursive: true });
  await writeFile(join(root, "alpha", "docs", "guide.md"), "# Guide\n");
  await writeFile(join(root, "alpha", "docs", "images", "diagram.png"), "PNGDATA");
  await writeFile(join(root, "alpha", "docs", "images", "readme.txt"), "not an image");
  await writeFile(join(root, "beta", "docs", "secret.png"), "SECRET");

  return root;
}

afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

test("resolvePreviewAsset resolves relative image assets in the same repo", async () => {
  const root = await createAssetWorkspace();

  const asset = await resolvePreviewAsset(root, "alpha/docs/guide.md", "images/diagram.png");

  expect(asset.rootRelativePath).toBe("alpha/docs/images/diagram.png");
  expect(asset.contentType).toBe("image/png");
  expect(asset.byteSize).toBe(7);
  expect(asset.absolutePath.endsWith("alpha/docs/images/diagram.png")).toBe(true);
});

test("resolvePreviewAsset rejects unsupported, external, absolute, and cross-repo asset paths", async () => {
  const root = await createAssetWorkspace();

  await expect(resolvePreviewAsset(root, "alpha/docs/guide.md", "images/readme.txt")).rejects.toThrow("Unsupported");
  await expect(resolvePreviewAsset(root, "alpha/docs/guide.md", "https://example.com/image.png")).rejects.toThrow(
    "relative",
  );
  await expect(resolvePreviewAsset(root, "alpha/docs/guide.md", "/alpha/docs/images/diagram.png")).rejects.toThrow(
    "relative",
  );
  await expect(resolvePreviewAsset(root, "alpha/docs/guide.md", "../../beta/docs/secret.png")).rejects.toThrow(
    "selected repository",
  );
});

test("resolvePreviewAsset rejects symlinked assets before reading outside the workspace", async () => {
  const root = await createAssetWorkspace();
  const outsideRoot = await mkdtemp(join(tmpdir(), "repo-notes-assets-outside-"));
  roots.push(outsideRoot);
  await writeFile(join(outsideRoot, "external.png"), "EXTERNAL");
  await symlink(join(outsideRoot, "external.png"), join(root, "alpha", "docs", "images", "external.png"));

  await expect(resolvePreviewAsset(root, "alpha/docs/guide.md", "images/external.png")).rejects.toThrow("symlink");
});

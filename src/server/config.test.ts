import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadWorkspaceConfig, saveWorkspaceConfig } from "./config";

const roots: string[] = [];
const originalConfigPath = process.env.REPO_NOTES_CONFIG_PATH;

async function createTempRoot() {
  const root = await mkdtemp(join(tmpdir(), "repo-notes-config-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  if (originalConfigPath === undefined) {
    delete process.env.REPO_NOTES_CONFIG_PATH;
  } else {
    process.env.REPO_NOTES_CONFIG_PATH = originalConfigPath;
  }

  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("workspace config can use an explicit config path for disposable runs", async () => {
  const root = await createTempRoot();
  const workspaceRoot = join(root, "workspace");
  const configPath = join(root, "state", "config.json");
  await mkdir(workspaceRoot, { recursive: true });
  process.env.REPO_NOTES_CONFIG_PATH = configPath;

  const savedConfig = await saveWorkspaceConfig(workspaceRoot);
  const loadedConfig = await loadWorkspaceConfig();

  expect(savedConfig).toEqual({ rootPath: workspaceRoot, rootExists: true });
  expect(loadedConfig).toEqual(savedConfig);
  await expect(readFile(configPath, "utf8")).resolves.toContain(workspaceRoot);
});

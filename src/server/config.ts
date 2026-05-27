import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { WorkspaceConfig } from "../shared/types";
import { resolveWorkspaceRoot } from "./safety";

const defaultConfigPath = join(homedir(), ".repo-notes", "config.json");

interface StoredConfig {
  rootPath?: string;
}

export async function loadWorkspaceConfig(): Promise<WorkspaceConfig> {
  const stored = await readStoredConfig();
  const rootPath = resolveWorkspaceRoot(stored.rootPath ?? (await defaultWorkspaceRoot()));

  return {
    rootPath,
    rootExists: await directoryExists(rootPath),
  };
}

export async function saveWorkspaceConfig(rootPath: string): Promise<WorkspaceConfig> {
  const resolvedRoot = resolveWorkspaceRoot(rootPath);

  if (!(await directoryExists(resolvedRoot))) {
    throw new Error("Workspace root does not exist or is not a directory.");
  }

  const path = workspaceConfigPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ rootPath: resolvedRoot }, null, 2), "utf8");

  return {
    rootPath: resolvedRoot,
    rootExists: true,
  };
}

export function workspaceStateDirectory() {
  return dirname(workspaceConfigPath());
}

async function readStoredConfig(): Promise<StoredConfig> {
  try {
    return JSON.parse(await readFile(workspaceConfigPath(), "utf8")) as StoredConfig;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function defaultWorkspaceRoot() {
  const candidates = [join(homedir(), "Developer"), join(homedir(), "dev"), process.cwd()];

  for (const candidate of candidates) {
    if (await directoryExists(candidate)) {
      return candidate;
    }
  }

  return process.cwd();
}

async function directoryExists(path: string) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

function workspaceConfigPath() {
  return process.env.REPO_NOTES_CONFIG_PATH || defaultConfigPath;
}

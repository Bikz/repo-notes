import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { WorkspaceIndex } from "../shared/types";
import { workspaceStateDirectory } from "./config";
import { scanWorkspace } from "./indexer";
import { resolveWorkspaceRoot } from "./safety";

interface IndexCacheOptions {
  stateDirectory?: string;
}

interface GetWorkspaceIndexOptions extends IndexCacheOptions {
  backgroundRefresh?: boolean;
  force?: boolean;
}

const refreshes = new Map<string, Promise<WorkspaceIndex>>();

export async function getWorkspaceIndex(
  rootPath: string,
  options: GetWorkspaceIndexOptions = {},
): Promise<WorkspaceIndex> {
  const root = resolveWorkspaceRoot(rootPath);

  if (!options.force) {
    const cachedIndex = await readWorkspaceIndexCache(root, options);
    if (cachedIndex) {
      if (options.backgroundRefresh) {
        queueWorkspaceIndexRefresh(root, options);
      }
      return cachedIndex;
    }
  }

  return refreshWorkspaceIndex(root, options);
}

export function queueWorkspaceIndexRefresh(rootPath: string, options: IndexCacheOptions = {}) {
  void refreshWorkspaceIndex(rootPath, options).catch((error) => {
    console.error(error instanceof Error ? error.message : "Failed to refresh workspace index.");
  });
}

export async function refreshWorkspaceIndex(
  rootPath: string,
  options: IndexCacheOptions = {},
): Promise<WorkspaceIndex> {
  const root = resolveWorkspaceRoot(rootPath);
  const existingRefresh = refreshes.get(root);

  if (existingRefresh) {
    return existingRefresh;
  }

  const refresh = (async () => {
    const index = { ...(await scanWorkspace(root)), cacheStatus: "fresh" as const };
    await writeWorkspaceIndexCache(index, options);
    return index;
  })();

  refreshes.set(root, refresh);

  try {
    return await refresh;
  } finally {
    refreshes.delete(root);
  }
}

async function readWorkspaceIndexCache(
  rootPath: string,
  options: IndexCacheOptions,
): Promise<WorkspaceIndex | null> {
  try {
    const cachedIndex = JSON.parse(await readFile(indexCachePath(options), "utf8")) as WorkspaceIndex;
    if (cachedIndex.rootPath !== rootPath || !Array.isArray(cachedIndex.repos) || !Array.isArray(cachedIndex.notes)) {
      return null;
    }

    return { ...cachedIndex, cacheStatus: "cached" };
  } catch {
    return null;
  }
}

async function writeWorkspaceIndexCache(index: WorkspaceIndex, options: IndexCacheOptions) {
  const cachePath = indexCachePath(options);
  const payload: WorkspaceIndex = { ...index };
  delete payload.cacheStatus;

  await mkdir(indexStateDirectory(options), { recursive: true });
  await writeFile(cachePath, JSON.stringify(payload), "utf8");
}

function indexCachePath(options: IndexCacheOptions) {
  return join(indexStateDirectory(options), "index-cache.json");
}

function indexStateDirectory(options: IndexCacheOptions) {
  return options.stateDirectory ?? workspaceStateDirectory();
}

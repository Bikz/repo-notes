import { stat } from "node:fs/promises";
import { extname, posix } from "node:path";
import {
  assertAllowedNotePath,
  assertNoSymlinkInWorkspacePath,
  assertSupportedNoteExtension,
  resolveWorkspaceFilePath,
} from "./safety";

const supportedPreviewAssetTypes = new Map([
  [".avif", "image/avif"],
  [".gif", "image/gif"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
]);

const maxPreviewAssetBytes = 10 * 1024 * 1024;

export interface PreviewAsset {
  absolutePath: string;
  rootRelativePath: string;
  contentType: string;
  byteSize: number;
}

export async function resolvePreviewAsset(
  rootPath: string,
  noteRootRelativePath: string,
  source: string,
): Promise<PreviewAsset> {
  assertSupportedNoteExtension(noteRootRelativePath);
  assertAllowedNotePath(noteRootRelativePath);

  const normalizedSource = source.trim().replaceAll("\\", "/");
  if (!normalizedSource || isExternalAssetSource(normalizedSource) || normalizedSource.startsWith("/") || normalizedSource.startsWith("#")) {
    throw new Error("Preview asset source must be relative.");
  }

  const sourcePath = decodeUriComponentSafe(normalizedSource.split("#", 1)[0]?.split("?", 1)[0] ?? "");
  const extension = extname(sourcePath).toLowerCase();
  const contentType = supportedPreviewAssetTypes.get(extension);
  if (!contentType) {
    throw new Error(`Unsupported preview asset extension: ${extension || "(none)"}`);
  }

  const repoName = noteRootRelativePath.split("/")[0] ?? "";
  const rootRelativePath = posix.normalize(posix.join(posix.dirname(noteRootRelativePath), sourcePath));
  if (!rootRelativePath.startsWith(`${repoName}/`)) {
    throw new Error("Preview asset path must stay inside the selected repository.");
  }

  assertAllowedNotePath(rootRelativePath);
  await assertNoSymlinkInWorkspacePath(rootPath, rootRelativePath);

  const absolutePath = resolveWorkspaceFilePath(rootPath, rootRelativePath);
  const fileStat = await stat(absolutePath);
  if (!fileStat.isFile()) {
    throw new Error("Preview asset path is not a file.");
  }

  if (fileStat.size > maxPreviewAssetBytes) {
    throw new Error("Preview asset is too large to render.");
  }

  return {
    absolutePath,
    rootRelativePath,
    contentType,
    byteSize: Number(fileStat.size),
  };
}

function isExternalAssetSource(source: string) {
  return source.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(source);
}

function decodeUriComponentSafe(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

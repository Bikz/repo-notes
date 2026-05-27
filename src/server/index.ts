import { extname, isAbsolute, join, relative, resolve } from "node:path";
import {
  createNoteFile,
  deleteNoteFile,
  moveNoteFile,
  NoteWriteConflictError,
  readNoteFile,
  writeNoteFile,
} from "./file-store";
import { resolvePreviewAsset } from "./assets";
import { loadWorkspaceConfig, saveWorkspaceConfig } from "./config";
import { getWorkspaceGitChanges, getWorkspaceGitDiff } from "./git";
import { getWorkspaceIndex } from "./index-cache";
import { reviewWorkspaceDocs } from "./review";
import { queueSearchContentCacheWarmup, searchWorkspaceDocs } from "./search";
import type { CreateNoteRequest, DeleteNoteRequest, MoveNoteRequest, UpdateNoteRequest } from "../shared/types";

const port = Number(process.env.PORT ?? 4177);
const distPath = resolve(process.cwd(), "dist");

const server = Bun.serve({
  port,
  idleTimeout: 60,
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    try {
      const url = new URL(request.url);

      if (url.pathname.startsWith("/api/")) {
        return await handleApiRequest(request, url);
      }

      return await serveClient(url.pathname);
    } catch (error) {
      return jsonResponse(
        {
          error: error instanceof Error ? error.message : "Unknown error",
        },
        statusForError(error),
      );
    }
  },
});

console.log(`Repo Notes listening on http://127.0.0.1:${server.port}`);

async function handleApiRequest(request: Request, url: URL) {
  if (request.method === "GET" && url.pathname === "/api/health") {
    return jsonResponse({ ok: true });
  }

  if (request.method === "GET" && url.pathname === "/api/config") {
    return jsonResponse(await loadWorkspaceConfig());
  }

  if (request.method === "PUT" && url.pathname === "/api/config") {
    const body = (await request.json()) as { rootPath?: unknown };
    if (typeof body.rootPath !== "string") {
      throw new HttpError("rootPath is required.", 400);
    }
    return jsonResponse(await saveWorkspaceConfig(body.rootPath));
  }

  if (request.method === "GET" && url.pathname === "/api/index") {
    const config = await loadWorkspaceConfig();
    if (!config.rootExists) {
      throw new HttpError("Workspace root does not exist.", 400);
    }
    const index = await getWorkspaceIndex(config.rootPath, {
      backgroundRefresh: url.searchParams.get("background") === "1",
      force: url.searchParams.get("force") === "1",
    });
    queueSearchContentCacheWarmup(config.rootPath, index);
    return jsonResponse(index);
  }

  if (request.method === "GET" && url.pathname === "/api/review") {
    const config = await loadWorkspaceConfig();
    if (!config.rootExists) {
      throw new HttpError("Workspace root does not exist.", 400);
    }

    const repoName = url.searchParams.get("repo") ?? undefined;
    const index = await getWorkspaceIndex(config.rootPath, {
      backgroundRefresh: url.searchParams.get("background") === "1",
      force: url.searchParams.get("force") === "1",
    });

    return jsonResponse(await reviewWorkspaceDocs(config.rootPath, index, { repoName }));
  }

  if (request.method === "GET" && url.pathname === "/api/git/changes") {
    const config = await loadWorkspaceConfig();
    if (!config.rootExists) {
      throw new HttpError("Workspace root does not exist.", 400);
    }

    const repoName = url.searchParams.get("repo") ?? undefined;
    const index = await getWorkspaceIndex(config.rootPath, {
      backgroundRefresh: url.searchParams.get("background") === "1",
      force: url.searchParams.get("force") === "1",
    });

    return jsonResponse(await getWorkspaceGitChanges(config.rootPath, index, { repoName }));
  }

  if (request.method === "GET" && url.pathname === "/api/git/diff") {
    const config = await loadWorkspaceConfig();
    if (!config.rootExists) {
      throw new HttpError("Workspace root does not exist.", 400);
    }

    const rootRelativePath = url.searchParams.get("path");
    if (!rootRelativePath) {
      throw new HttpError("path is required.", 400);
    }

    const index = await getWorkspaceIndex(config.rootPath, {
      backgroundRefresh: url.searchParams.get("background") === "1",
      force: url.searchParams.get("force") === "1",
    });

    return jsonResponse(await getWorkspaceGitDiff(config.rootPath, index, rootRelativePath));
  }

  if (request.method === "GET" && url.pathname === "/api/search") {
    const config = await loadWorkspaceConfig();
    if (!config.rootExists) {
      throw new HttpError("Workspace root does not exist.", 400);
    }

    const query = url.searchParams.get("q") ?? "";
    const repoName = url.searchParams.get("repo") ?? undefined;
    const index = await getWorkspaceIndex(config.rootPath, {
      backgroundRefresh: url.searchParams.get("background") === "1",
      force: url.searchParams.get("force") === "1",
    });

    return jsonResponse(await searchWorkspaceDocs(config.rootPath, index, { query, repoName }));
  }

  if (request.method === "GET" && url.pathname === "/api/assets") {
    const noteRootRelativePath = url.searchParams.get("note");
    const source = url.searchParams.get("src");
    if (!noteRootRelativePath || !source) {
      throw new HttpError("note and src are required.", 400);
    }

    const config = await loadWorkspaceConfig();
    const asset = await resolvePreviewAsset(config.rootPath, noteRootRelativePath, source);
    return new Response(Bun.file(asset.absolutePath), {
      headers: {
        ...corsHeaders(),
        "cache-control": "no-store",
        "content-length": String(asset.byteSize),
        "content-type": asset.contentType,
      },
    });
  }

  if (request.method === "GET" && url.pathname === "/api/files") {
    const rootRelativePath = url.searchParams.get("path");
    if (!rootRelativePath) {
      throw new HttpError("path is required.", 400);
    }

    const config = await loadWorkspaceConfig();
    return jsonResponse(await readNoteFile(config.rootPath, rootRelativePath));
  }

  if (request.method === "PUT" && url.pathname === "/api/files") {
    const body = (await request.json()) as Partial<UpdateNoteRequest>;
    if (
      typeof body.rootRelativePath !== "string" ||
      typeof body.content !== "string" ||
      typeof body.expectedUpdatedAtMs !== "number"
    ) {
      throw new HttpError("rootRelativePath, content, and expectedUpdatedAtMs are required.", 400);
    }

    const config = await loadWorkspaceConfig();
    return jsonResponse(
      await writeNoteFile(config.rootPath, {
        rootRelativePath: body.rootRelativePath,
        content: body.content,
        expectedUpdatedAtMs: body.expectedUpdatedAtMs,
      }),
    );
  }

  if (request.method === "POST" && url.pathname === "/api/files") {
    const body = (await request.json()) as Partial<CreateNoteRequest>;
    if (
      typeof body.repoName !== "string" ||
      typeof body.repoRelativePath !== "string" ||
      typeof body.content !== "string"
    ) {
      throw new HttpError("repoName, repoRelativePath, and content are required.", 400);
    }

    const config = await loadWorkspaceConfig();
    return jsonResponse(
      await createNoteFile(config.rootPath, {
        repoName: body.repoName,
        repoRelativePath: body.repoRelativePath,
        content: body.content,
      }),
      201,
    );
  }

  if (request.method === "PATCH" && url.pathname === "/api/files") {
    const body = (await request.json()) as Partial<MoveNoteRequest>;
    if (
      typeof body.rootRelativePath !== "string" ||
      typeof body.repoRelativePath !== "string" ||
      typeof body.expectedUpdatedAtMs !== "number"
    ) {
      throw new HttpError("rootRelativePath, repoRelativePath, and expectedUpdatedAtMs are required.", 400);
    }

    const config = await loadWorkspaceConfig();
    return jsonResponse(
      await moveNoteFile(config.rootPath, {
        rootRelativePath: body.rootRelativePath,
        repoRelativePath: body.repoRelativePath,
        expectedUpdatedAtMs: body.expectedUpdatedAtMs,
      }),
    );
  }

  if (request.method === "DELETE" && url.pathname === "/api/files") {
    const body = (await request.json()) as Partial<DeleteNoteRequest>;
    if (typeof body.rootRelativePath !== "string" || typeof body.expectedUpdatedAtMs !== "number") {
      throw new HttpError("rootRelativePath and expectedUpdatedAtMs are required.", 400);
    }

    const config = await loadWorkspaceConfig();
    return jsonResponse(
      await deleteNoteFile(config.rootPath, {
        rootRelativePath: body.rootRelativePath,
        expectedUpdatedAtMs: body.expectedUpdatedAtMs,
      }),
    );
  }

  throw new HttpError("API route not found.", 404);
}

async function serveClient(pathname: string) {
  const normalizedPath = pathname === "/" ? "/index.html" : pathname;
  const requestedPath = resolve(distPath, `.${decodeURIComponent(normalizedPath)}`);

  if (!isInside(distPath, requestedPath)) {
    throw new HttpError("Not found.", 404);
  }

  const requestedFile = Bun.file(requestedPath);
  if (await requestedFile.exists()) {
    return new Response(requestedFile, {
      headers: {
        "content-type": contentTypeForPath(requestedPath),
      },
    });
  }

  const indexFile = Bun.file(join(distPath, "index.html"));
  if (await indexFile.exists()) {
    return new Response(indexFile, {
      headers: {
        "content-type": "text/html; charset=utf-8",
      },
    });
  }

  return new Response("Run `bun run dev` for the web app or `bun run build` before `bun run start`.", {
    status: 404,
    headers: {
      "content-type": "text/plain; charset=utf-8",
    },
  });
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(),
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "http://127.0.0.1:5173",
    "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}

function statusForError(error: unknown) {
  if (error instanceof HttpError) {
    return error.status;
  }

  if (error instanceof NoteWriteConflictError) {
    return 409;
  }

  if (error instanceof Error && "code" in error && error.code === "ENOENT") {
    return 404;
  }

  if (error instanceof SyntaxError) {
    return 400;
  }

  return 500;
}

function isInside(rootPath: string, targetPath: string) {
  const targetRelativeToRoot = relative(rootPath, targetPath);
  return targetRelativeToRoot === "" || (!targetRelativeToRoot.startsWith("..") && !isAbsolute(targetRelativeToRoot));
}

function contentTypeForPath(path: string) {
  switch (extname(path)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

class HttpError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

# Architecture

Repo Notes has two runtime pieces:

- A Bun local API that owns filesystem access.
- A Vite/React client that owns filtering, rendering, editing, and creation workflows.

The browser client never reads arbitrary local files directly. Every read, write, create, and scan request goes through the Bun API, which resolves paths against the configured workspace root.

## Filesystem Boundary

The workspace root must be an absolute path. File operations accept paths relative to that root, reject traversal, and only allow supported note extensions:

- `.md`
- `.markdown`
- `.mdx`
- `.txt`
- `.html`
- `.htm`

The scanner treats each direct child directory under the workspace root as a repository-like project. It skips generated, hidden, and dependency directories during recursive scans, with narrow exceptions for `.github` and `.well-known`.

Before file contents are read, written, moved, deleted, created, or reviewed, Repo Notes checks every existing path segment in the note path with `lstat` and rejects symlinks. This keeps a repo-relative note path from escaping the selected workspace or selected repository through a symlinked file or directory.

## API

- `GET /api/config`: returns the configured root path and whether it exists.
- `PUT /api/config`: updates the configured root path.
- `GET /api/index`: returns repositories plus note metadata from the local metadata cache when available.
- `GET /api/index?force=1`: rebuilds the metadata index from disk.
- `GET /api/index?background=1`: returns cached metadata and queues a background rebuild.
- `GET /api/search?q=<query>`: searches indexed docs by title, path, repo, and file content.
- `GET /api/search?q=<query>&repo=<repoName>`: searches one repository.
- `GET /api/review`: reviews all indexed docs for local hygiene issues and returns bounded metadata-only findings.
- `GET /api/review?repo=<repoName>`: reviews one repository.
- `GET /api/git/changes`: returns metadata-only Git status for changed note-like files across Git repositories.
- `GET /api/git/changes?repo=<repoName>`: returns metadata-only Git status for one repository.
- `GET /api/git/diff?path=<rootRelativePath>`: returns a bounded Git diff preview for one changed note.
- `GET /api/files?path=<rootRelativePath>`: reads one supported note file.
- `PUT /api/files`: updates an existing note file in place.
- `PATCH /api/files`: renames or moves an existing note within its current repository.
- `DELETE /api/files`: deletes an existing note file after checking current disk state.
- `POST /api/files`: creates a new supported note file inside a selected repository without overwriting.

## Rendering

The client renders Markdown and HTML in the browser with sanitization. The server treats note content as local text and does not transform it.

## Storage

The configured workspace root is persisted at:

```text
~/.repo-notes/config.json
```

Repo Notes also stores a metadata-only index cache next to the config file:

```text
~/.repo-notes/index-cache.json
```

The cache stores repository names, relative note paths, sizes, and modification times. It does not store note contents.

## Docs Search

Docs search is an on-demand workflow, separate from indexing, because it may read document bodies. It uses the current index as scope, keeps reads concurrency-limited, checks symlink safety before content reads, and returns ranked note metadata with optional bounded line-level snippets. Search snippets are response-only and are not written to the metadata cache.

After an index response, the API queues a best-effort in-memory search-content warmup. That cache is keyed by workspace root, root-relative path, file size, and modified time. It lets follow-up searches reuse safe, current note bodies without rereading every file, but it is process-local only and never persisted to `~/.repo-notes`. Before a cached body is reused, the server still checks the workspace path for symlinks and stats the file so missing, changed, or unsafe paths are skipped or refreshed.

## Docs Review

Docs review is an on-demand workflow, separate from indexing, because it reads document bodies to inspect markers and Markdown links. The review scanner uses the current index as its scope, keeps reads concurrency-limited, ignores remote links and anchors-only links, checks local Markdown targets with workspace-relative safety resolution, and returns a capped list of findings.

Review payloads are metadata-only: category, severity, repository, root-relative path, title, line, target path, related counts, and aggregate totals. They intentionally do not include snippets or full note contents.

## Git Changes

Git changes are an on-demand, read-only handoff workflow. The API scopes work to indexed direct-child repositories that have Git metadata, runs `git status --porcelain=v1 -z --untracked-files=all` with non-shell arguments, filters results to supported note extensions and allowed note paths, and returns changed-path metadata only. Deleted notes are validated by path because they no longer exist on disk. Existing untracked or modified notes are still opened through the normal `/api/files` path, so content reads keep the same workspace and symlink checks as the rest of the app.

Diff previews require an explicit root-relative changed note path. The server validates the path against the selected workspace, repository, supported note extension, and ignored-directory rules, rejects symlinked existing files before asking Git for a diff, and returns capped line metadata. Tracked files use `git diff --no-ext-diff --no-color --find-renames HEAD -- <path>`. Untracked files use `git diff --no-index --no-color -- /dev/null <path>` so the preview can still show the pending document body without scanning unrelated files.

The client shows changed docs in the middle pane with status labels and staged/unstaged state. Clicking a changed doc loads its bounded diff preview. Opening a changed file remains a separate action and follows the normal note-opening flow; deleted docs stay visible as handoff context but are not opened from Repo Notes.

## Preview Navigation

The rendered reader intercepts Markdown and HTML preview link clicks in the browser. External links are opened outside the current app tab. Local relative links only open inside Repo Notes when they resolve to a note already present in the current index, and all resulting file reads still go through the normal `/api/files` safety path. Missing local links are surfaced as UI errors instead of navigating the Vite app to an arbitrary relative URL.

Local preview image sources are rewritten to `/api/assets?note=<rootRelativePath>&src=<relativeImagePath>`. The asset endpoint resolves image paths relative to the current note, requires the target to remain inside the selected repository, rejects symlinked path segments, limits served assets to common image extensions, and streams the file without adding it to the note index or metadata cache.

## Move/Rename

Moving a note is intentionally scoped to the note's current repository. The API validates the source path as a supported, non-symlinked note file, checks the loaded modified time to avoid moving stale disk state, validates the destination as a supported repo-relative note path, rejects ignored/generated directories, refuses sibling-repository traversal, checks destination parents for symlinks, and refuses to overwrite an existing file. After a successful move, the in-memory search-content cache is invalidated for both old and new paths, and the client refreshes the metadata index from disk.

## Delete

Deleting a note uses the same source-path checks as reading and writing: supported note extension, ignored-directory rejection, symlink rejection, file-only validation, and a modified-time conflict check. The client confirms the destructive action first, clears stale search and review context after success, invalidates the deleted file from the in-memory search-content cache, and refreshes the metadata index so removed docs disappear from the browse surface.

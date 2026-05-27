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

## API

- `GET /api/config`: returns the configured root path and whether it exists.
- `PUT /api/config`: updates the configured root path.
- `GET /api/index`: returns repositories plus note metadata from the local metadata cache when available.
- `GET /api/index?force=1`: rebuilds the metadata index from disk.
- `GET /api/index?background=1`: returns cached metadata and queues a background rebuild.
- `GET /api/review`: reviews all indexed docs for local hygiene issues and returns bounded metadata-only findings.
- `GET /api/review?repo=<repoName>`: reviews one repository.
- `GET /api/files?path=<rootRelativePath>`: reads one supported note file.
- `PUT /api/files`: updates an existing note file in place.
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

## Docs Review

Docs review is an on-demand workflow, separate from indexing, because it reads document bodies to inspect markers and Markdown links. The review scanner uses the current index as its scope, keeps reads concurrency-limited, ignores remote links and anchors-only links, checks local Markdown targets with workspace-relative safety resolution, and returns a capped list of findings.

Review payloads are metadata-only: category, severity, repository, root-relative path, title, line, target path, related counts, and aggregate totals. They intentionally do not include snippets or full note contents.

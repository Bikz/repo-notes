# Architecture

DevShelf has two runtime pieces:

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
- `GET /api/index`: scans the workspace root and returns repositories plus note metadata.
- `GET /api/files?path=<rootRelativePath>`: reads one supported note file.
- `PUT /api/files`: updates an existing note file in place.
- `POST /api/files`: creates a new supported note file inside a selected repository without overwriting.

## Rendering

The client renders Markdown and HTML in the browser with sanitization. The server treats note content as local text and does not transform it.

## Storage

Only the configured workspace root is persisted, at:

```text
~/.repo-notes/config.json
```

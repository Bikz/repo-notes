# Repo Notes

Repo Notes is a local-first notes app for people who keep their real notes, plans, prompts, specs, and docs inside many different repositories.

Point it at a workspace root such as `~/Developer`, and it indexes supported text-like files across each child repository. Selecting a note reads the file directly from disk. Saving writes back to that same local file, so normal Git workflows still own history, review, and publishing.

## What It Indexes

Repo Notes currently scans direct child directories under the configured workspace root and indexes:

- Markdown: `.md`, `.markdown`, `.mdx`
- Text: `.txt`
- HTML: `.html`, `.htm`

It skips generated, hidden, artifact, virtual environment, and dependency folders such as `.git`, `.torva`, `node_modules`, `deps`, `dist`, `build`, `artifacts`, `output`, `tmp`, `.venv`, `venv`, `.next`, `.turbo`, and `coverage`. `.github` and `.well-known` remain visible.

## Features

- Configure a local workspace root.
- Render notes from every child repository in one searchable surface.
- Search titles, paths, repository names, and note contents with bounded local snippets.
- See when a broad content search is capped and narrow by query or repository.
- Preview Markdown, plain text, and HTML with client-side sanitization.
- Jump between Markdown sections from an in-file outline.
- Open indexed local Markdown links directly inside Repo Notes.
- Move back and forward through opened notes while exploring docs.
- Render local preview images through the workspace-safe asset endpoint.
- Edit existing files in place.
- Rename or move notes inside their owning repository.
- Delete obsolete notes with disk-change protection.
- Recover cleanly when a note changed on disk before saving.
- Use editor-grade keyboard shortcuts for save, search, new note, and dismissing transient panels.
- Create new supported files inside a selected repository.
- Open quickly from a local metadata cache, then refresh that index from disk in the background.
- Warm an in-memory content cache after indexing so repeated docs searches avoid rereading every file.
- Reopen to the last valid repo, note, sort, view mode, and projects-pane state without storing note contents.
- Review docs locally for common product-team hygiene issues: broken local Markdown links, unresolved TODO/FIXME/TBD/XXX markers, empty docs, duplicate titles, stale docs, and oversized files.
- Review changed note-like files from local Git status before handoff.
- Keep all file history in the repositories that already own those files.

## Development

Install dependencies:

```sh
bun install
```

Run the local API and Vite client:

```sh
bun run dev
```

Open:

```text
http://127.0.0.1:5173
```

The Bun API runs on `http://127.0.0.1:4177`. The Vite dev server proxies `/api/*` to that API.

## Validation

```sh
bun test
bun run typecheck
bun run lint
bun run build
bun run smoke
```

## Safety Model

Repo Notes is intentionally local-only. It does not upload file contents. File operations are constrained to the configured workspace root and only supported note extensions can be read, edited, moved, deleted, or created.

Repo Notes also refuses to follow symlinks in note paths before reading, writing, moving, deleting, creating, or reviewing files, so a path that appears inside the workspace cannot escape to another location on disk.

The configured root path is stored at:

```text
~/.repo-notes/config.json
```

Repo Notes also writes a metadata-only index cache at `~/.repo-notes/index-cache.json` so the app can open quickly without rewalking every repository before showing search results. The cache stores paths and file metadata, not note contents.

Content search runs on demand against the selected repository or all indexed repositories. Search responses can include a bounded line-level snippet for matching local content, but snippets are not written to the metadata cache.

To keep follow-up searches fast, Repo Notes opportunistically warms an in-memory content cache after indexing. The cache is scoped to the running local API process, validates symlink safety plus file size and modified time before reuse, and is invalidated when Repo Notes edits or creates a note. It is never written to disk.

Docs review runs on demand against the selected repository or all indexed repositories. Review responses contain issue metadata such as category, severity, path, line, target, and counts. They do not include file snippets or full note content.

Git changes run on demand against direct child repositories that have Git metadata. Change responses include changed note paths, status labels, staged/unstaged state, and index presence. They do not include file contents or diffs.

The browser stores a small root-scoped session payload in local storage so Repo Notes can reopen to the last valid browsing context. That payload is limited to the configured root path, selected repo, selected note path, note sort, view mode, and whether the projects pane is visible; it does not include note contents, search snippets, review results, or editor drafts.

Rendered preview links only navigate inside Repo Notes when they resolve to notes already present in the current local index. Missing local links are reported in the app instead of navigating the browser outside the notes surface.

Rendered local images are served through `/api/assets`, which resolves image paths relative to the current note, keeps them inside the same repository, rejects symlinks, and supports common image formats such as PNG, JPEG, GIF, SVG, WebP, and AVIF.

Do not point Repo Notes at directories containing private data you do not want listed in the app.

## License

MIT

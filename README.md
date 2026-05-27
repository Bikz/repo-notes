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
- Preview Markdown, plain text, and HTML with client-side sanitization.
- Edit existing files in place.
- Create new supported files inside a selected repository.
- Open quickly from a local metadata cache, then refresh that index from disk in the background.
- Review docs locally for common product-team hygiene issues: broken local Markdown links, unresolved TODO/FIXME/TBD/XXX markers, empty docs, duplicate titles, stale docs, and oversized files.
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

Repo Notes is intentionally local-only. It does not upload file contents. File operations are constrained to the configured workspace root and only supported note extensions can be read, edited, or created.

Repo Notes also refuses to follow symlinks in note paths before reading, writing, creating, or reviewing files, so a path that appears inside the workspace cannot escape to another location on disk.

The configured root path is stored at:

```text
~/.repo-notes/config.json
```

Repo Notes also writes a metadata-only index cache at `~/.repo-notes/index-cache.json` so the app can open quickly without rewalking every repository before showing search results. The cache stores paths and file metadata, not note contents.

Content search runs on demand against the selected repository or all indexed repositories. Search responses can include a bounded line-level snippet for matching local content, but snippets are not written to the metadata cache.

Docs review runs on demand against the selected repository or all indexed repositories. Review responses contain issue metadata such as category, severity, path, line, target, and counts. They do not include file snippets or full note content.

Do not point Repo Notes at directories containing private data you do not want listed in the app.

## License

MIT

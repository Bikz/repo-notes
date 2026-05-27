# DevShelf

DevShelf is a local-first notes app for people who keep their real notes, plans, prompts, specs, and docs inside many different repositories.

Point it at a workspace root such as `~/Developer`, and it indexes supported text-like files across each child repository. Selecting a note reads the file directly from disk. Saving writes back to that same local file, so normal Git workflows still own history, review, and publishing.

## What It Indexes

DevShelf currently scans direct child directories under the configured workspace root and indexes:

- Markdown: `.md`, `.markdown`, `.mdx`
- Text: `.txt`
- HTML: `.html`, `.htm`

It skips generated, hidden, artifact, virtual environment, and dependency folders such as `.git`, `.torva`, `node_modules`, `deps`, `dist`, `build`, `artifacts`, `output`, `tmp`, `.venv`, `venv`, `.next`, `.turbo`, and `coverage`. `.github` and `.well-known` remain visible.

## Features

- Configure a local workspace root.
- Render notes from every child repository in one searchable surface.
- Preview Markdown, plain text, and HTML with client-side sanitization.
- Edit existing files in place.
- Create new supported files inside a selected repository.
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

DevShelf is intentionally local-only. It does not upload file contents. File operations are constrained to the configured workspace root and only supported note extensions can be read, edited, or created.

The configured root path is stored at:

```text
~/.repo-notes/config.json
```

Do not point DevShelf at directories containing private data you do not want listed in the app.

## License

MIT

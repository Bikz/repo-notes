# Progress

## 2026-05-19

- Started the first implementation goal for a local repository notes app.
- Created the initial Bun/Vite/React scaffold in `/Users/torva/Developer/repo-notes`.
- Initial scope: configure a repository root, index `.txt`, Markdown, and `.html` files across child repositories, render selected files, edit existing files in place, and create new files inside selected repositories.
- Added tested filesystem safety, indexing, read, update, and create modules.
- Added a Bun local API and validated `/api/health`, `/api/config`, and `/api/index` against `/Users/torva/Developer`.
- Tightened scanner ignores after browser proof exposed generated hidden artifacts; current verified index is 20 child directories and 2946 supported note files.
- Verified the React app in Playwright on desktop and mobile viewports; screenshots are in `output/playwright/`.
- Continued the DevShelf implementation from the existing scaffold and screenshots instead of restarting discovery.
- Hardened create-file safety so new files cannot escape the selected repository into a sibling repo, and applied ignored/generated/hidden directory policy to read, write, create, and root-level indexing.
- Added `REPO_NOTES_CONFIG_PATH` support plus `bun run smoke` so API end-to-end verification can run against a disposable workspace without touching the user's real repository root.
- Reworked the UI into a denser DevShelf workbench: creation now opens from a drawer, the sidebar focuses on workspace/filter/sort controls, note rows show kind/size/update metadata, dirty edits are guarded, and mobile has explicit Browse/Read panes.
- Browser-verified a disposable UI flow for root switching, selecting a note, editing and saving to disk, creating from the drawer, and mobile Browse/Read navigation. Fresh screenshots:
  - `output/playwright/devshelf-desktop.png`
  - `output/playwright/devshelf-desktop-browser-smoke.png`
  - `output/playwright/devshelf-mobile-browse.png`
- Final validation passed: `bun test`, `bun run typecheck`, `bun run lint`, `bun run build`, `bun run smoke`, and a workspace-config restore check for `/Users/torva/Developer`.
- Started an Apple Notes-inspired visual overhaul using the provided macOS Notes screenshot and generated direction sheet. Selected the hybrid repository-notes direction: dark translucent source list, grouped notes list, warm editor surface, and macOS-style toolbar controls while preserving repository/workspace safety controls.
- Implemented the Apple Notes-inspired overhaul: window chrome, dark source list, date-grouped note list, gold selected note treatment, full-width preview-first reader, and mobile Browse/Read modes styled after the desktop direction.
- Preserved the generated direction sheet at `output/design/apple-notes-direction-sheet.png`.
- Browser proof artifacts for the overhaul:
  - `output/playwright/devshelf-apple-notes-desktop.png`
  - `output/playwright/devshelf-apple-notes-selected.png`
  - `output/playwright/devshelf-apple-notes-mobile-read.png`
  - `output/playwright/devshelf-apple-notes-mobile-browse.png`
- Tightened the visual direction to "dark notes" using the Codex dark workspace screenshot as inspiration: near-black app chrome, neutral grey active states, quieter status bars, and only restrained warm accenting.
- Browser proof artifacts for the dark-notes refinement:
  - `output/playwright/devshelf-dark-notes-selected.png`
  - `output/playwright/devshelf-dark-notes-mobile-read.png`
  - `output/playwright/devshelf-dark-notes-mobile-browse.png`
- Added stale-save protection so browser edits include the loaded file timestamp and server writes return a conflict instead of overwriting a note changed on disk.
- Final dark-notes validation passed: `bun test`, `bun run typecheck`, `bun run lint`, `bun run build`, `bun run smoke`, Playwright console-error check, and a disposable browser UI edit/save round-trip.

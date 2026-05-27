import DOMPurify from "dompurify";
import {
  ArrowLeft,
  Check,
  FilePlus2,
  Folder,
  ListFilter,
  Loader2,
  MoreHorizontal,
  PanelLeft,
  RefreshCcw,
  Save,
  Search,
  SquarePen,
  X,
} from "lucide-react";
import { marked } from "marked";
import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import "./App.css";
import type { NoteSortMode } from "./client/note-utils";
import {
  filterNotes,
  groupNotesByLocation,
  groupNotesByRecency,
  resolveCreateRepoName,
  sortNotes,
} from "./client/note-utils";
import type {
  CreateNoteRequest,
  NoteFilePayload,
  UpdateNoteRequest,
  WorkspaceConfig,
  WorkspaceIndex,
} from "./shared/types";

type ViewMode = "preview" | "edit" | "split";
type MobilePane = "browse" | "read";

interface CreateFormState {
  repoName: string;
  repoRelativePath: string;
  content: string;
}

const emptyCreateForm: CreateFormState = {
  repoName: "",
  repoRelativePath: "notes/new-note.md",
  content: "# New note\n\n",
};
const initialVisibleNoteCount = 300;

function App() {
  const [config, setConfig] = useState<WorkspaceConfig | null>(null);
  const [rootPathInput, setRootPathInput] = useState("");
  const [workspaceIndex, setWorkspaceIndex] = useState<WorkspaceIndex | null>(null);
  const [selectedPath, setSelectedPath] = useState("");
  const [activeFile, setActiveFile] = useState<NoteFilePayload | null>(null);
  const [editorValue, setEditorValue] = useState("");
  const [repoFilter, setRepoFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [noteSort, setNoteSort] = useState<NoteSortMode>("path");
  const [viewMode, setViewMode] = useState<ViewMode>("preview");
  const [mobilePane, setMobilePane] = useState<MobilePane>("browse");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [visibleNoteCount, setVisibleNoteCount] = useState(initialVisibleNoteCount);
  const [createForm, setCreateForm] = useState<CreateFormState>(emptyCreateForm);
  const [isBooting, setIsBooting] = useState(true);
  const [isIndexing, setIsIndexing] = useState(false);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const selectedNote = activeFile?.note ?? null;
  const isDirty = activeFile !== null && editorValue !== activeFile.content;
  const repos = useMemo(() => workspaceIndex?.repos ?? [], [workspaceIndex]);
  const notes = useMemo(() => workspaceIndex?.notes ?? [], [workspaceIndex]);

  useEffect(() => {
    let isCancelled = false;

    async function boot() {
      setIsBooting(true);
      setError("");

      try {
        const nextConfig = await requestJson<WorkspaceConfig>("/api/config");
        if (isCancelled) {
          return;
        }

        setConfig(nextConfig);
        setRootPathInput(nextConfig.rootPath);

        if (nextConfig.rootExists) {
          const nextIndex = await requestWorkspaceIndex({ backgroundRefresh: true });
          if (isCancelled) {
            return;
          }

          setWorkspaceIndex(nextIndex);
          setCreateForm((current) => ({
            ...current,
            repoName: resolveCreateRepoName(current.repoName, nextIndex.repos),
          }));
          if (nextIndex.cacheStatus === "cached") {
            void hydrateFreshIndex();
          }
        }
      } catch (nextError) {
        if (!isCancelled) {
          setError(messageForError(nextError));
        }
      } finally {
        if (!isCancelled) {
          setIsBooting(false);
        }
      }
    }

    void boot();

    async function hydrateFreshIndex() {
      try {
        const freshIndex = await requestWorkspaceIndex({ force: true });
        if (isCancelled) {
          return;
        }

        setWorkspaceIndex(freshIndex);
        setVisibleNoteCount(initialVisibleNoteCount);
        setCreateForm((current) => ({
          ...current,
          repoName: resolveCreateRepoName(current.repoName, freshIndex.repos),
        }));
      } catch (nextError) {
        if (!isCancelled) {
          setError(messageForError(nextError));
        }
      }
    }

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedPath) {
      return;
    }

    let isCancelled = false;

    async function loadSelectedFile() {
      setIsLoadingFile(true);
      setError("");

      try {
        const file = await requestJson<NoteFilePayload>(`/api/files?path=${encodeURIComponent(selectedPath)}`);
        if (!isCancelled) {
          setActiveFile(file);
          setEditorValue(file.content);
        }
      } catch (nextError) {
        if (!isCancelled) {
          setError(messageForError(nextError));
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingFile(false);
        }
      }
    }

    void loadSelectedFile();

    return () => {
      isCancelled = true;
    };
  }, [selectedPath]);

  const filteredNotes = useMemo(() => {
    return sortNotes(filterNotes(notes, repoFilter, query), noteSort);
  }, [notes, noteSort, query, repoFilter]);
  const visibleNotes = filteredNotes.slice(0, visibleNoteCount);
  const noteGroups = useMemo(() => {
    return noteSort === "updated" ? groupNotesByRecency(visibleNotes) : groupNotesByLocation(visibleNotes, repoFilter);
  }, [noteSort, repoFilter, visibleNotes]);
  const listTitle = repoFilter === "all" ? "All notes" : repoFilter;

  const renderedHtml = useMemo(() => {
    if (!activeFile) {
      return "";
    }

    if (activeFile.note.kind === "markdown") {
      return DOMPurify.sanitize(marked.parse(editorValue, { async: false }) as string);
    }

    if (activeFile.note.kind === "html") {
      return DOMPurify.sanitize(editorValue);
    }

    return DOMPurify.sanitize(`<pre>${escapeHtml(editorValue)}</pre>`);
  }, [activeFile, editorValue]);

  useEffect(() => {
    if (!isDirty) {
      return;
    }

    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  async function updateRootPath(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirmDiscardDraft()) {
      return;
    }

    setError("");
    setNotice("");

    try {
      const nextConfig = await requestJson<WorkspaceConfig>("/api/config", {
        method: "PUT",
        body: JSON.stringify({ rootPath: rootPathInput.trim() }),
      });
      setConfig(nextConfig);
      setWorkspaceIndex(null);
      setSelectedPath("");
      setActiveFile(null);
      setEditorValue("");
      setNotice(nextConfig.rootExists ? "Workspace root saved." : "Root saved, but the path does not exist.");

      if (nextConfig.rootExists) {
        await refreshIndex({ force: true, quiet: true });
      }
    } catch (nextError) {
      setError(messageForError(nextError));
    }
  }

  async function refreshIndex(options: { force?: boolean; quiet?: boolean } = {}) {
    setIsIndexing(true);
    setError("");

    try {
      const nextIndex = await requestWorkspaceIndex({ force: options.force });
      setWorkspaceIndex(nextIndex);
      setVisibleNoteCount(initialVisibleNoteCount);
      setCreateForm((current) => ({
        ...current,
        repoName: resolveCreateRepoName(current.repoName, nextIndex.repos),
      }));
      if (!options.quiet) {
        setNotice(`Refreshed ${nextIndex.notes.length} notes across ${nextIndex.repos.length} repos.`);
      }

      if (selectedPath && !nextIndex.notes.some((note) => note.rootRelativePath === selectedPath)) {
        setSelectedPath("");
        setActiveFile(null);
        setEditorValue("");
      }
    } catch (nextError) {
      setError(messageForError(nextError));
    } finally {
      setIsIndexing(false);
    }
  }

  async function saveFile() {
    if (!activeFile || !isDirty) {
      return;
    }

    setIsSaving(true);
    setError("");
    setNotice("");

    const body: UpdateNoteRequest = {
      rootRelativePath: activeFile.note.rootRelativePath,
      content: editorValue,
      expectedUpdatedAtMs: activeFile.note.updatedAtMs,
    };

    try {
      const savedFile = await requestJson<NoteFilePayload>("/api/files", {
        method: "PUT",
        body: JSON.stringify(body),
      });
      setActiveFile(savedFile);
      setEditorValue(savedFile.content);
      setNotice("Saved.");
      await refreshIndex({ force: true, quiet: true });
    } catch (nextError) {
      setError(messageForError(nextError));
    } finally {
      setIsSaving(false);
    }
  }

  async function createFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsCreating(true);
    setError("");
    setNotice("");

    const body: CreateNoteRequest = {
      repoName: createForm.repoName,
      repoRelativePath: createForm.repoRelativePath.trim(),
      content: createForm.content,
    };

    try {
      const createdFile = await requestJson<NoteFilePayload>("/api/files", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setActiveFile(createdFile);
      setEditorValue(createdFile.content);
      setSelectedPath(createdFile.note.rootRelativePath);
      setRepoFilter(createdFile.note.repoName);
      setVisibleNoteCount(initialVisibleNoteCount);
      setMobilePane("read");
      setIsCreateOpen(false);
      setCreateForm((current) => ({ ...emptyCreateForm, repoName: current.repoName }));
      setNotice("Created note.");
      await refreshIndex({ force: true, quiet: true });
    } catch (nextError) {
      setError(messageForError(nextError));
    } finally {
      setIsCreating(false);
    }
  }

  function openNote(note: NoteFilePayload["note"], nextRepoFilter?: string) {
    if (note.rootRelativePath === selectedPath) {
      setMobilePane("read");
      return;
    }

    if (!confirmDiscardDraft()) {
      return;
    }

    if (nextRepoFilter) {
      setRepoFilter(nextRepoFilter);
      setVisibleNoteCount(initialVisibleNoteCount);
    }
    setSelectedPath(note.rootRelativePath);
    setMobilePane("read");
  }

  function selectNote(note: NoteFilePayload["note"]) {
    openNote(note);
  }

  function selectRepo(repoName: string) {
    setRepoFilter(repoName);
    setVisibleNoteCount(initialVisibleNoteCount);
  }

  function showAllDocs() {
    setRepoFilter("all");
    setVisibleNoteCount(initialVisibleNoteCount);
  }

  function confirmDiscardDraft() {
    return !isDirty || window.confirm("Discard unsaved changes?");
  }

  return (
    <main className="app-shell">
      <section className={`notes-window mobile-pane-${mobilePane}`}>
        <header className="topbar">
          <div className="window-controls" aria-hidden="true">
            <span className="traffic traffic-close" />
            <span className="traffic traffic-minimize" />
            <span className="traffic traffic-zoom" />
          </div>
          <div className="topbar-title">
            <p className="eyebrow">Local docs</p>
            <h1>Repo Notes</h1>
          </div>
          <div className="topbar-actions">
            <button className="round-button" type="button" aria-label="Toggle sources">
              <PanelLeft size={18} />
            </button>
            <button
              className="round-button"
              type="button"
              onClick={() => setIsCreateOpen(true)}
              disabled={repos.length === 0}
              aria-label="New note"
            >
              <SquarePen size={18} />
            </button>
            <button
              className="round-button"
              type="button"
              onClick={() => void refreshIndex({ force: true })}
              disabled={isIndexing}
              aria-label="Refresh"
            >
              {isIndexing ? <Loader2 className="spin" size={18} /> : <RefreshCcw size={18} />}
            </button>
            <button className="round-button" type="button" aria-label="More">
              <MoreHorizontal size={18} />
            </button>
          </div>
        </header>

        {(error || notice) && (
          <div className={`status-strip ${error ? "is-error" : "is-ok"}`} role={error ? "alert" : "status"}>
            {error || notice}
          </div>
        )}

        <nav className="mobile-nav" aria-label="Workspace panes">
          <button className={mobilePane === "browse" ? "is-active" : ""} type="button" onClick={() => setMobilePane("browse")}>
            <ListFilter size={15} />
            <span>Browse</span>
          </button>
          <button
            className={mobilePane === "read" ? "is-active" : ""}
            type="button"
            onClick={() => setMobilePane("read")}
            disabled={!selectedNote}
          >
            <FilePlus2 size={15} />
            <span>Read</span>
          </button>
        </nav>

        <section className="workspace-grid">
        <aside className="sidebar">
          <div className="source-header">
            <div>
              <p className="eyebrow">Repos</p>
              <h2>Projects</h2>
            </div>
            <span>{repos.length} repos</span>
          </div>

          <button
            className={`all-docs-row ${repoFilter === "all" ? "is-active" : ""}`}
            type="button"
            onClick={showAllDocs}
          >
            <ListFilter size={15} />
            <span>All docs</span>
            <strong>{notes.length}</strong>
          </button>

          <nav className="repo-list" aria-label="Repositories">
            {isBooting && (
              <div className="hierarchy-state">
                <Loader2 className="spin" size={16} />
                <span>Loading docs...</span>
              </div>
            )}
            {!isBooting && repos.map((repo) => {
              const repoName = repo.name;
              const isActive = repoFilter === repoName;

              return (
                <button
                  className={`repo-row ${isActive ? "is-active" : ""}`}
                  key={repoName}
                  type="button"
                  onClick={() => selectRepo(repoName)}
                >
                  <Folder size={15} />
                  <span>{repoName}</span>
                  <strong>{repo.noteCount}</strong>
                </button>
              );
            })}
            {!isBooting && repos.length === 0 && (
              <div className="hierarchy-state">
                <strong>No docs indexed.</strong>
                <span>Choose a workspace root from settings.</span>
              </div>
            )}
          </nav>

          <form className="workspace-footer" onSubmit={updateRootPath}>
            <details>
              <summary>
                <span>Workspace root</span>
                <strong>{config?.rootExists ? "Ready" : "Missing"}</strong>
              </summary>
            <label>
              <span>Root path</span>
              <input
                value={rootPathInput}
                onChange={(event) => setRootPathInput(event.target.value)}
                placeholder="/Users/torva/Developer"
                spellCheck={false}
              />
            </label>
            <button className="primary-button" type="submit" disabled={isBooting || !rootPathInput.trim()}>
              <Check size={15} />
              <span>Set root</span>
            </button>
            </details>
          </form>
        </aside>

        <section className="note-list-panel">
          <div className="list-header">
            <div className="list-title-block">
              <div>
                <h2>{listTitle}</h2>
                <p>{filteredNotes.length} {filteredNotes.length === 1 ? "doc" : "docs"}</p>
              </div>
              <select
                className="compact-select"
                value={noteSort}
                onChange={(event) => {
                  setNoteSort(event.target.value as NoteSortMode);
                  setVisibleNoteCount(initialVisibleNoteCount);
                }}
                aria-label="Organize docs"
              >
                <option value="path">By location</option>
                <option value="updated">Recently updated</option>
              </select>
            </div>
            <label className="list-search">
              <span>Search docs</span>
              <div className="search-box">
                <Search size={15} />
                <input
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setVisibleNoteCount(initialVisibleNoteCount);
                  }}
                  placeholder="Title, path, repo"
                  spellCheck={false}
                />
              </div>
            </label>
          </div>
          <div className="note-list">
            {(isBooting || (isIndexing && visibleNotes.length === 0)) && (
              <div className="empty-state">
                <Loader2 className="spin" size={20} />
                <strong>{isBooting ? "Opening workspace..." : "Indexing workspace..."}</strong>
                <span>Repo Notes is preparing the local repository index.</span>
              </div>
            )}
            {!isBooting && noteGroups.map((group) => (
              <section className="note-group" key={`${group.title}-${group.detail ?? ""}`}>
                <div className="note-group-heading">
                  <div>
                    <h3>{group.title}</h3>
                    {group.detail && <span>{group.detail}</span>}
                  </div>
                  <strong>{group.notes.length}</strong>
                </div>
                {group.notes.map((note) => (
                  <button
                    className={`note-row ${note.rootRelativePath === selectedPath ? "is-selected" : ""}`}
                    key={note.id}
                    type="button"
                    onClick={() => selectNote(note)}
                  >
                    <span className="note-title">{note.title}</span>
                    <span className="note-path">{note.repoName}/{note.repoRelativePath}</span>
                    <span className="note-meta">
                      <span>{formatDateLabel(note.updatedAtMs)}</span>
                      <span className="note-preview">{note.kind} · {formatBytes(note.byteSize)}</span>
                    </span>
                  </button>
                ))}
              </section>
            ))}
            {!isBooting && visibleNotes.length < filteredNotes.length && (
              <button
                className="show-more-button"
                type="button"
                onClick={() => setVisibleNoteCount((current) => current + initialVisibleNoteCount)}
              >
                Show {Math.min(initialVisibleNoteCount, filteredNotes.length - visibleNotes.length)} more
              </button>
            )}
            {!isBooting && !isIndexing && filteredNotes.length === 0 && (
              <div className="empty-state">
                <strong>No notes found.</strong>
                <span>Set a workspace root, refresh the index, or loosen the current filters.</span>
              </div>
            )}
          </div>
        </section>

        <section className="reader-panel">
          {selectedNote ? (
            <>
              <div className="reader-header">
                <button className="reader-back icon-button" type="button" onClick={() => setMobilePane("browse")}>
                  <ArrowLeft size={15} />
                  <span>Back</span>
                </button>
                <div className="reader-title">
                  <p className="eyebrow">{selectedNote.repoName}</p>
                  <h2>{selectedNote.repoRelativePath}</h2>
                  {isDirty && <span className="dirty-pill">Unsaved changes</span>}
                </div>
                <div className="reader-actions">
                  <div className="segmented" aria-label="View mode">
                    {(["preview", "split", "edit"] as ViewMode[]).map((mode) => (
                      <button
                        className={viewMode === mode ? "is-active" : ""}
                        key={mode}
                        type="button"
                        onClick={() => setViewMode(mode)}
                      >
                        {mode}
                      </button>
                    ))}
                  </div>
                  <button className="primary-button" type="button" onClick={() => void saveFile()} disabled={!isDirty || isSaving}>
                    {isSaving ? <Loader2 className="spin" size={15} /> : <Save size={15} />}
                    <span>{isDirty ? "Save changes" : "Saved"}</span>
                  </button>
                </div>
              </div>
              <div className="note-date">{formatFullDateTime(selectedNote.updatedAtMs)}</div>
              <div className={`reader-body mode-${viewMode}`}>
                {viewMode !== "edit" && (
                  <article
                    className="rendered-note"
                    dangerouslySetInnerHTML={{ __html: renderedHtml }}
                  />
                )}
                {viewMode !== "preview" && (
                  <textarea
                    className="editor"
                    value={editorValue}
                    onChange={(event) => setEditorValue(event.target.value)}
                    spellCheck={false}
                  />
                )}
              </div>
            </>
          ) : (
            <div className="empty-reader">
              {isLoadingFile ? <Loader2 className="spin" size={20} /> : <FilePlus2 size={20} />}
              <strong>{isLoadingFile ? "Loading note..." : "Select a note"}</strong>
              <span>Preview sanitized markdown, text, or HTML and edit from the same workspace.</span>
            </div>
          )}
        </section>
      </section>

        {isCreateOpen && (
          <div className="drawer-scrim" role="presentation" onClick={() => !isCreating && setIsCreateOpen(false)}>
            <aside
              className="create-drawer"
              aria-labelledby="create-note-title"
              aria-modal="true"
              role="dialog"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="drawer-header">
                <div>
                  <p className="eyebrow">Repo Notes</p>
                  <h2 id="create-note-title">New note</h2>
                </div>
                <button className="round-button" type="button" onClick={() => setIsCreateOpen(false)} aria-label="Close">
                  <X size={16} />
                </button>
              </div>
              <form className="create-form" onSubmit={createFile}>
                <label>
                  <span>Repo</span>
                  <select
                    value={createForm.repoName}
                    onChange={(event) => setCreateForm((current) => ({ ...current, repoName: event.target.value }))}
                    required
                  >
                    <option value="" disabled>
                      Select repo
                    </option>
                    {repos.map((repo) => (
                      <option key={repo.name} value={repo.name}>
                        {repo.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Relative path</span>
                  <input
                    value={createForm.repoRelativePath}
                    onChange={(event) =>
                      setCreateForm((current) => ({ ...current, repoRelativePath: event.target.value }))
                    }
                    placeholder="docs/notes.md"
                    spellCheck={false}
                    required
                  />
                </label>
                <label>
                  <span>Initial content</span>
                  <textarea
                    className="create-content"
                    value={createForm.content}
                    onChange={(event) => setCreateForm((current) => ({ ...current, content: event.target.value }))}
                    required
                  />
                </label>
                <button className="primary-button" type="submit" disabled={isCreating || repos.length === 0}>
                  {isCreating ? <Loader2 className="spin" size={15} /> : <FilePlus2 size={15} />}
                  <span>Create file</span>
                </button>
              </form>
            </aside>
          </div>
        )}
      </section>
    </main>
  );
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init.headers,
    },
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error ?? `Request failed with ${response.status}`);
  }

  return payload as T;
}

function requestWorkspaceIndex(options: { backgroundRefresh?: boolean; force?: boolean } = {}) {
  const params = new URLSearchParams();
  if (options.backgroundRefresh) {
    params.set("background", "1");
  }
  if (options.force) {
    params.set("force", "1");
  }

  const queryString = params.toString();
  const query = queryString ? `?${queryString}` : "";
  return requestJson<WorkspaceIndex>(`/api/index${query}`);
}

function messageForError(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 102.4) / 10} KB`;
  }

  return `${Math.round(bytes / 104857.6) / 10} MB`;
}

function formatDateLabel(timestamp: number) {
  const noteDate = new Date(timestamp);
  const today = new Date();

  if (
    noteDate.getFullYear() === today.getFullYear() &&
    noteDate.getMonth() === today.getMonth() &&
    noteDate.getDate() === today.getDate()
  ) {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(timestamp);
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "numeric",
    day: "numeric",
    year: "2-digit",
  }).format(timestamp);
}

function formatFullDateTime(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}

export default App;

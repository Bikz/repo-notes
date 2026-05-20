import DOMPurify from "dompurify";
import {
  ArrowLeft,
  Check,
  FilePlus2,
  FolderCog,
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
import { filterNotes, groupNotesByRecency, resolveCreateRepoName, sortNotes } from "./client/note-utils";
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
          const nextIndex = await requestJson<WorkspaceIndex>("/api/index");
          if (isCancelled) {
            return;
          }

          setWorkspaceIndex(nextIndex);
          setCreateForm((current) => ({
            ...current,
            repoName: resolveCreateRepoName(current.repoName, nextIndex.repos),
          }));
          setNotice(`Indexed ${nextIndex.notes.length} notes across ${nextIndex.repos.length} repos.`);
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
  const noteGroups = useMemo(() => groupNotesByRecency(visibleNotes), [visibleNotes]);

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
        await refreshIndex();
      }
    } catch (nextError) {
      setError(messageForError(nextError));
    }
  }

  async function refreshIndex() {
    setIsIndexing(true);
    setError("");

    try {
      const nextIndex = await requestJson<WorkspaceIndex>("/api/index");
      setWorkspaceIndex(nextIndex);
      setVisibleNoteCount(initialVisibleNoteCount);
      setCreateForm((current) => ({
        ...current,
        repoName: resolveCreateRepoName(current.repoName, nextIndex.repos),
      }));
      setNotice(`Indexed ${nextIndex.notes.length} notes across ${nextIndex.repos.length} repos.`);

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
      await refreshIndex();
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
      setMobilePane("read");
      setIsCreateOpen(false);
      setCreateForm((current) => ({ ...emptyCreateForm, repoName: current.repoName }));
      setNotice("Created note.");
      await refreshIndex();
    } catch (nextError) {
      setError(messageForError(nextError));
    } finally {
      setIsCreating(false);
    }
  }

  function selectNote(rootRelativePath: string) {
    if (rootRelativePath === selectedPath) {
      setMobilePane("read");
      return;
    }

    if (!confirmDiscardDraft()) {
      return;
    }

    setSelectedPath(rootRelativePath);
    setMobilePane("read");
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
            <p className="eyebrow">DevShelf</p>
            <h1>Repository notes</h1>
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
            <button className="round-button" type="button" onClick={() => void refreshIndex()} disabled={isIndexing} aria-label="Refresh">
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
          <form className="panel compact-form" onSubmit={updateRootPath}>
            <div className="panel-heading">
              <FolderCog size={16} />
              <h2>Workspace</h2>
            </div>
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
            <dl className="workspace-stats">
              <div>
                <dt>Root</dt>
                <dd>{config?.rootExists ? "Ready" : "Missing"}</dd>
              </div>
              <div>
                <dt>Repos</dt>
                <dd>{repos.length}</dd>
              </div>
              <div>
                <dt>Notes</dt>
                <dd>{notes.length}</dd>
              </div>
            </dl>
          </form>

          <section className="panel">
            <div className="panel-heading">
              <ListFilter size={16} />
              <h2>Filters</h2>
            </div>
            <label>
              <span>Repository</span>
              <select
                value={repoFilter}
                onChange={(event) => {
                  setRepoFilter(event.target.value);
                  setVisibleNoteCount(initialVisibleNoteCount);
                }}
              >
                <option value="all">All repositories</option>
                {repos.map((repo) => (
                  <option key={repo.name} value={repo.name}>
                    {repo.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Search</span>
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
            <label>
              <span>Sort</span>
              <select
                value={noteSort}
                onChange={(event) => {
                  setNoteSort(event.target.value as NoteSortMode);
                  setVisibleNoteCount(initialVisibleNoteCount);
                }}
              >
                <option value="path">Path</option>
                <option value="updated">Recently updated</option>
              </select>
            </label>
          </section>
        </aside>

        <section className="note-list-panel">
          <div className="list-header">
            <div>
              <h2>Notes</h2>
              <p>{filteredNotes.length} {filteredNotes.length === 1 ? "note" : "notes"}</p>
            </div>
            <button className="round-button subtle-button" type="button" aria-label="Note list options">
              <MoreHorizontal size={18} />
            </button>
          </div>
          <div className="note-list">
            {(isBooting || (isIndexing && visibleNotes.length === 0)) && (
              <div className="empty-state">
                <Loader2 className="spin" size={20} />
                <strong>{isBooting ? "Opening workspace..." : "Indexing workspace..."}</strong>
                <span>DevShelf is preparing the local repository index.</span>
              </div>
            )}
            {!isBooting && noteGroups.map((group) => (
              <section className="note-group" key={group.title}>
                <h3>{group.title}</h3>
                {group.notes.map((note) => (
                  <button
                    className={`note-row ${note.rootRelativePath === selectedPath ? "is-selected" : ""}`}
                    key={note.id}
                    type="button"
                    onClick={() => selectNote(note.rootRelativePath)}
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
                  <p className="eyebrow">DevShelf</p>
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

import DOMPurify from "dompurify";
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  FilePenLine,
  FilePlus2,
  Folder,
  GitCompare,
  ListFilter,
  ListTree,
  Loader2,
  MoreHorizontal,
  PanelLeft,
  RefreshCcw,
  Save,
  Search,
  SquarePen,
  Trash2,
  X,
} from "lucide-react";
import { marked } from "marked";
import type { FormEvent } from "react";
import type { MouseEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import type {
  NoteHistoryState,
  NoteLineTarget,
  NoteOutlineItem,
  NoteSortMode,
  SessionViewMode,
  WorkspaceSessionState,
} from "./client/note-utils";
import {
  appShortcutForKey,
  extractMarkdownOutline,
  filterReviewIssues,
  filterNotes,
  gitChangeStatusLabel,
  gitChangesLimitMessage,
  groupNotesByLocation,
  groupNotesByRecency,
  isCreateDraftDirty,
  isSaveConflictError,
  initialReviewIssueCount,
  lineStartOffsetForLine,
  lineTargetForSearchResult,
  lineTargetForOutlineAnchor,
  moveNoteHistory,
  nextReviewIssueLimit,
  noteHistoryTarget,
  previewAssetApiPath,
  pushNoteHistory,
  restoreWorkspaceSession,
  resolvePreviewLinkTarget,
  isExternalPreviewHref,
  resolveCreateRepoName,
  resolvePreferredCreateRepoName,
  searchResultLimitMessage,
  sortNotes,
} from "./client/note-utils";
import type { ReviewCategoryFilter, ReviewSeverityFilter } from "./client/note-utils";
import type {
  CreateNoteRequest,
  DocReviewCategory,
  DocSearchPayload,
  DocSearchResult,
  DocReviewIssue,
  DocReviewPayload,
  DocReviewSeverity,
  DeleteNotePayload,
  DeleteNoteRequest,
  GitChangedNote,
  GitChangesPayload,
  MoveNoteRequest,
  NoteFilePayload,
  UpdateNoteRequest,
  WorkspaceConfig,
  WorkspaceIndex,
} from "./shared/types";

type ViewMode = SessionViewMode;
type MobilePane = "browse" | "read";

interface CreateFormState {
  repoName: string;
  repoRelativePath: string;
  content: string;
}

interface MoveFormState {
  repoRelativePath: string;
}

interface OpenNoteOptions {
  repoName?: string;
  preserveReview?: boolean;
  skipHistory?: boolean;
}

interface PreviewAnchorTarget {
  rootRelativePath: string;
  anchor: string;
}

const emptyCreateForm: CreateFormState = {
  repoName: "",
  repoRelativePath: "notes/new-note.md",
  content: "# New note\n\n",
};
const emptyMoveForm: MoveFormState = {
  repoRelativePath: "",
};
const initialVisibleNoteCount = 300;
const contentSearchMinLength = 2;
const workspaceSessionStorageKey = "repo-notes:workspace-session";
const reviewSeverityOptions: DocReviewSeverity[] = ["high", "medium", "low"];
const reviewCategoryOptions: DocReviewCategory[] = [
  "broken-link",
  "missing-file",
  "todo-marker",
  "empty-doc",
  "duplicate-title",
  "stale-doc",
  "large-file",
];

function App() {
  const [config, setConfig] = useState<WorkspaceConfig | null>(null);
  const [rootPathInput, setRootPathInput] = useState("");
  const [workspaceIndex, setWorkspaceIndex] = useState<WorkspaceIndex | null>(null);
  const [selectedPath, setSelectedPath] = useState("");
  const [noteHistory, setNoteHistory] = useState<NoteHistoryState>({ entries: [], index: -1 });
  const [activeFile, setActiveFile] = useState<NoteFilePayload | null>(null);
  const [editorValue, setEditorValue] = useState("");
  const [repoFilter, setRepoFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [noteSort, setNoteSort] = useState<NoteSortMode>("path");
  const [viewMode, setViewMode] = useState<ViewMode>("preview");
  const [mobilePane, setMobilePane] = useState<MobilePane>("browse");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [areSourcesVisible, setAreSourcesVisible] = useState(true);
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [visibleNoteCount, setVisibleNoteCount] = useState(initialVisibleNoteCount);
  const [createForm, setCreateForm] = useState<CreateFormState>(emptyCreateForm);
  const [moveForm, setMoveForm] = useState<MoveFormState>(emptyMoveForm);
  const [docSearch, setDocSearch] = useState<DocSearchPayload | null>(null);
  const [docReview, setDocReview] = useState<DocReviewPayload | null>(null);
  const [gitChanges, setGitChanges] = useState<GitChangesPayload | null>(null);
  const [reviewSeverityFilter, setReviewSeverityFilter] = useState<ReviewSeverityFilter>("all");
  const [reviewCategoryFilter, setReviewCategoryFilter] = useState<ReviewCategoryFilter>("all");
  const [reviewVisibleIssueCount, setReviewVisibleIssueCount] = useState(initialReviewIssueCount);
  const [pendingLineTarget, setPendingLineTarget] = useState<NoteLineTarget | null>(null);
  const [isBooting, setIsBooting] = useState(true);
  const [isIndexing, setIsIndexing] = useState(false);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isMoveOpen, setIsMoveOpen] = useState(false);
  const [isMoving, setIsMoving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);
  const [isLoadingGitChanges, setIsLoadingGitChanges] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [reviewError, setReviewError] = useState("");
  const [gitChangesError, setGitChangesError] = useState("");
  const [saveConflictPath, setSaveConflictPath] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const pendingPreviewAnchorRef = useRef<PreviewAnchorTarget | null>(null);
  const selectedPathRef = useRef("");

  const selectedNote = activeFile?.note ?? null;
  const isDirty = activeFile !== null && editorValue !== activeFile.content;
  const repos = useMemo(() => workspaceIndex?.repos ?? [], [workspaceIndex]);
  const notes = useMemo(() => workspaceIndex?.notes ?? [], [workspaceIndex]);
  const noteByRootRelativePath = useMemo(() => {
    return new Map(notes.map((note) => [note.rootRelativePath, note]));
  }, [notes]);
  const previousHistoryNote = noteByRootRelativePath.get(noteHistoryTarget(noteHistory, -1) ?? "") ?? null;
  const nextHistoryNote = noteByRootRelativePath.get(noteHistoryTarget(noteHistory, 1) ?? "") ?? null;

  useEffect(() => {
    selectedPathRef.current = selectedPath;
  }, [selectedPath]);

  function openPendingPreviewAnchor(file: NoteFilePayload) {
    const pendingAnchor = pendingPreviewAnchorRef.current;
    if (!pendingAnchor || pendingAnchor.rootRelativePath !== file.note.rootRelativePath) {
      return;
    }

    pendingPreviewAnchorRef.current = null;
    if (file.note.kind !== "markdown") {
      return;
    }

    const anchorTarget = lineTargetForOutlineAnchor(
      extractMarkdownOutline(file.content),
      pendingAnchor.anchor,
      file.note.rootRelativePath,
    );
    if (!anchorTarget) {
      return;
    }

    setViewMode((current) => (current === "edit" ? "edit" : "split"));
    setPendingLineTarget(anchorTarget);
    setNotice(`Opened ${file.note.title} at ${pendingAnchor.anchor}.`);
  }

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
          const restoredSession = restoreWorkspaceSession(
            readWorkspaceSession(),
            nextConfig.rootPath,
            nextIndex.repos,
            nextIndex.notes,
          );
          if (restoredSession) {
            selectedPathRef.current = restoredSession.selectedPath;
            setRepoFilter(restoredSession.repoFilter);
            setSelectedPath(restoredSession.selectedPath);
            setNoteSort(restoredSession.noteSort);
            setViewMode(restoredSession.viewMode);
            setAreSourcesVisible(restoredSession.areSourcesVisible);
            setVisibleNoteCount(initialVisibleNoteCount);
            if (restoredSession.selectedPath) {
              setNoteHistory(pushNoteHistory({ entries: [], index: -1 }, restoredSession.selectedPath));
              setMobilePane("read");
            }
          }
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
        if (
          selectedPathRef.current &&
          !freshIndex.notes.some((note) => note.rootRelativePath === selectedPathRef.current)
        ) {
          clearActiveNote();
        }
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
    if (isBooting || !config?.rootExists || !workspaceIndex) {
      return;
    }

    writeWorkspaceSession({
      rootPath: config.rootPath,
      repoFilter,
      selectedPath,
      noteSort,
      viewMode,
      areSourcesVisible,
    });
  }, [
    areSourcesVisible,
    config?.rootExists,
    config?.rootPath,
    isBooting,
    noteSort,
    repoFilter,
    selectedPath,
    viewMode,
    workspaceIndex,
  ]);

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
          setSaveConflictPath("");
          openPendingPreviewAnchor(file);
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

  const normalizedQuery = query.trim().toLowerCase();
  const activeDocSearch = useMemo(() => {
    if (!docSearch || normalizedQuery.length < contentSearchMinLength || docSearch.query !== normalizedQuery) {
      return null;
    }

    const searchRepoFilter = docSearch.scope.repoName ?? "all";
    return searchRepoFilter === repoFilter ? docSearch : null;
  }, [docSearch, normalizedQuery, repoFilter]);
  const cappedSearchMessage = activeDocSearch ? searchResultLimitMessage(activeDocSearch) : "";
  const searchResultByPath = useMemo(() => {
    return new Map(activeDocSearch?.results.map((result) => [result.note.rootRelativePath, result]) ?? []);
  }, [activeDocSearch]);
  const filteredNotes = useMemo(() => {
    if (activeDocSearch) {
      return activeDocSearch.results.map((result) => result.note);
    }

    return sortNotes(filterNotes(notes, repoFilter, query), noteSort);
  }, [activeDocSearch, notes, noteSort, query, repoFilter]);
  const visibleNotes = filteredNotes.slice(0, visibleNoteCount);
  const noteGroups = useMemo(() => {
    return noteSort === "updated" ? groupNotesByRecency(visibleNotes) : groupNotesByLocation(visibleNotes, repoFilter);
  }, [noteSort, repoFilter, visibleNotes]);
  const filteredReviewIssues = useMemo(() => {
    return filterReviewIssues(docReview?.issues ?? [], reviewSeverityFilter, reviewCategoryFilter);
  }, [docReview, reviewCategoryFilter, reviewSeverityFilter]);
  const visibleReviewIssues = useMemo(() => {
    return filteredReviewIssues.slice(0, reviewVisibleIssueCount);
  }, [filteredReviewIssues, reviewVisibleIssueCount]);
  const canShowMoreReviewIssues = visibleReviewIssues.length < filteredReviewIssues.length;
  const cappedGitChangesMessage = gitChanges ? gitChangesLimitMessage(gitChanges) : "";
  const listTitle = repoFilter === "all" ? "All notes" : repoFilter;

  const renderedHtml = useMemo(() => {
    if (!activeFile) {
      return "";
    }

    if (activeFile.note.kind === "markdown") {
      return rewriteRenderedAssetSources(
        DOMPurify.sanitize(marked.parse(editorValue, { async: false }) as string),
        activeFile.note.rootRelativePath,
      );
    }

    if (activeFile.note.kind === "html") {
      return rewriteRenderedAssetSources(DOMPurify.sanitize(editorValue), activeFile.note.rootRelativePath);
    }

    return DOMPurify.sanitize(`<pre>${escapeHtml(editorValue)}</pre>`);
  }, [activeFile, editorValue]);

  const noteOutline = useMemo(() => {
    if (!activeFile || activeFile.note.kind !== "markdown") {
      return [];
    }

    return extractMarkdownOutline(editorValue);
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

  useEffect(() => {
    if (!pendingLineTarget || !activeFile || viewMode === "preview") {
      return;
    }

    if (activeFile.note.rootRelativePath !== pendingLineTarget.rootRelativePath) {
      return;
    }

    const textarea = editorRef.current;
    if (!textarea) {
      return;
    }

    const offset = lineStartOffsetForLine(editorValue, pendingLineTarget.line);
    const targetLine = Math.max(1, Math.floor(pendingLineTarget.line ?? 1));
    const computedLineHeight = Number.parseFloat(window.getComputedStyle(textarea).lineHeight);
    const lineHeight = Number.isFinite(computedLineHeight) ? computedLineHeight : 20;

    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(offset, offset);
    textarea.scrollTop = Math.max(0, (targetLine - 1) * lineHeight - textarea.clientHeight * 0.25);
    setPendingLineTarget(null);
  }, [activeFile, editorValue, pendingLineTarget, viewMode]);

  useEffect(() => {
    if (!config?.rootExists || !workspaceIndex || normalizedQuery.length < contentSearchMinLength) {
      return;
    }

    const controller = new AbortController();
    const searchTimer = window.setTimeout(() => {
      setIsSearching(true);
      setSearchError("");

      const params = new URLSearchParams({ q: normalizedQuery });
      if (repoFilter !== "all") {
        params.set("repo", repoFilter);
      }

      void requestJson<DocSearchPayload>(`/api/search?${params.toString()}`, { signal: controller.signal })
        .then((search) => {
          setDocSearch(search);
        })
        .catch((nextError) => {
          if (!controller.signal.aborted) {
            setSearchError(messageForError(nextError));
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setIsSearching(false);
          }
        });
    }, 180);

    return () => {
      controller.abort();
      window.clearTimeout(searchTimer);
    };
  }, [config?.rootExists, normalizedQuery, repoFilter, workspaceIndex]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const shortcut = appShortcutForKey(event);
      if (!shortcut) {
        return;
      }

      if (shortcut === "save") {
        event.preventDefault();
        const targetElement = event.target instanceof Element ? event.target : null;
        if (isCreateOpen || isMoveOpen || targetElement?.closest(".workspace-footer")) {
          return;
        }

        if (activeFile && isDirty && !isSaving) {
          void saveFile();
        }
        return;
      }

      if (shortcut === "focus-search") {
        event.preventDefault();
        if (isCreateOpen && !closeCreateDrawer()) {
          return;
        }
        if (isMoveOpen && !closeMoveDrawer()) {
          return;
        }

        setMobilePane("browse");
        window.requestAnimationFrame(() => {
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        });
        return;
      }

      if (shortcut === "new-note") {
        event.preventDefault();
        if (repos.length > 0 && !isCreateOpen && !isMoveOpen) {
          openCreateDrawer();
        }
        return;
      }

      if (shortcut === "close-panel" && (isCreateOpen || isMoveOpen || isMoreOpen || error || notice)) {
        event.preventDefault();
        if (isCreateOpen && !closeCreateDrawer()) {
          return;
        }
        if (isMoveOpen && !closeMoveDrawer()) {
          return;
        }

        setIsMoreOpen(false);
        setError("");
        setNotice("");
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

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
      setDocSearch(null);
      setDocReview(null);
      setGitChanges(null);
      setSearchError("");
      setReviewError("");
      setGitChangesError("");
      setReviewSeverityFilter("all");
      setReviewCategoryFilter("all");
      setReviewVisibleIssueCount(initialReviewIssueCount);
      clearActiveNote();
      setNotice(nextConfig.rootExists ? "Workspace root saved." : "Root saved, but the path does not exist.");

      if (nextConfig.rootExists) {
        await refreshIndex({ force: true, quiet: true });
      }
    } catch (nextError) {
      setError(messageForError(nextError));
    }
  }

  async function refreshIndex(options: { force?: boolean; quiet?: boolean; preserveGitChanges?: boolean } = {}) {
    setIsIndexing(true);
    setError("");

    try {
      const nextIndex = await requestWorkspaceIndex({ force: options.force });
      setWorkspaceIndex(nextIndex);
      setDocSearch(null);
      setDocReview(null);
      if (!options.preserveGitChanges) {
        setGitChanges(null);
        setGitChangesError("");
      }
      setSearchError("");
      setReviewError("");
      setReviewSeverityFilter("all");
      setReviewCategoryFilter("all");
      setReviewVisibleIssueCount(initialReviewIssueCount);
      setVisibleNoteCount(initialVisibleNoteCount);
      setCreateForm((current) => ({
        ...current,
        repoName: resolveCreateRepoName(current.repoName, nextIndex.repos),
      }));
      if (!options.quiet) {
        setNotice(`Refreshed ${nextIndex.notes.length} notes across ${nextIndex.repos.length} repos.`);
      }

      const currentSelectedPath = selectedPathRef.current;
      if (currentSelectedPath && !nextIndex.notes.some((note) => note.rootRelativePath === currentSelectedPath)) {
        clearActiveNote();
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
    setSaveConflictPath("");

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
      if (isSaveConflictError(nextError)) {
        setSaveConflictPath(activeFile.note.rootRelativePath);
      }
      setError(messageForError(nextError));
    } finally {
      setIsSaving(false);
    }
  }

  async function reloadActiveFileFromDisk() {
    if (!activeFile) {
      return;
    }

    setIsLoadingFile(true);
    setError("");
    setNotice("");

    try {
      const file = await requestJson<NoteFilePayload>(
        `/api/files?path=${encodeURIComponent(activeFile.note.rootRelativePath)}`,
      );
      setActiveFile(file);
      setEditorValue(file.content);
      setSaveConflictPath("");
      setNotice("Reloaded latest disk version.");
      await refreshIndex({ force: true, quiet: true });
    } catch (nextError) {
      setError(messageForError(nextError));
    } finally {
      setIsLoadingFile(false);
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
      selectedPathRef.current = createdFile.note.rootRelativePath;
      setActiveFile(createdFile);
      setEditorValue(createdFile.content);
      setSelectedPath(createdFile.note.rootRelativePath);
      setNoteHistory((current) => pushNoteHistory(current, createdFile.note.rootRelativePath));
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

  async function moveFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeFile) {
      return;
    }

    if (isDirty) {
      setError("Save or discard changes before moving this note.");
      return;
    }

    setIsMoving(true);
    setError("");
    setNotice("");

    const body: MoveNoteRequest = {
      rootRelativePath: activeFile.note.rootRelativePath,
      repoRelativePath: moveForm.repoRelativePath.trim(),
      expectedUpdatedAtMs: activeFile.note.updatedAtMs,
    };

    try {
      const movedFile = await requestJson<NoteFilePayload>("/api/files", {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      selectedPathRef.current = movedFile.note.rootRelativePath;
      setActiveFile(movedFile);
      setEditorValue(movedFile.content);
      setSelectedPath(movedFile.note.rootRelativePath);
      setNoteHistory(pushNoteHistory({ entries: [], index: -1 }, movedFile.note.rootRelativePath));
      setRepoFilter(movedFile.note.repoName);
      setDocSearch(null);
      setDocReview(null);
      setGitChanges(null);
      setSearchError("");
      setReviewError("");
      setGitChangesError("");
      setReviewSeverityFilter("all");
      setReviewCategoryFilter("all");
      setReviewVisibleIssueCount(initialReviewIssueCount);
      setVisibleNoteCount(initialVisibleNoteCount);
      setMobilePane("read");
      setIsMoveOpen(false);
      setMoveForm({ repoRelativePath: movedFile.note.repoRelativePath });
      setNotice("Moved note.");
      await refreshIndex({ force: true, quiet: true });
    } catch (nextError) {
      if (isSaveConflictError(nextError)) {
        setSaveConflictPath(activeFile.note.rootRelativePath);
      }
      setError(messageForError(nextError));
    } finally {
      setIsMoving(false);
    }
  }

  async function deleteSelectedNote() {
    if (!activeFile || !selectedNote) {
      return;
    }

    setIsMoreOpen(false);
    setError("");
    setNotice("");

    if (isDirty) {
      setError("Save or discard changes before deleting this note.");
      return;
    }

    const confirmed = window.confirm(
      `Delete ${selectedNote.repoRelativePath} from ${selectedNote.repoName}? This removes the local file. Use Git to recover it if needed.`,
    );
    if (!confirmed) {
      return;
    }

    setIsDeleting(true);
    const deletedTitle = selectedNote.title;
    const body: DeleteNoteRequest = {
      rootRelativePath: activeFile.note.rootRelativePath,
      expectedUpdatedAtMs: activeFile.note.updatedAtMs,
    };

    try {
      await requestJson<DeleteNotePayload>("/api/files", {
        method: "DELETE",
        body: JSON.stringify(body),
      });
      clearActiveNote();
      setDocSearch(null);
      setDocReview(null);
      setGitChanges(null);
      setSearchError("");
      setReviewError("");
      setGitChangesError("");
      setReviewSeverityFilter("all");
      setReviewCategoryFilter("all");
      setReviewVisibleIssueCount(initialReviewIssueCount);
      setVisibleNoteCount(initialVisibleNoteCount);
      setMobilePane("browse");
      setNotice(`Deleted ${deletedTitle}.`);
      await refreshIndex({ force: true, quiet: true });
    } catch (nextError) {
      if (isSaveConflictError(nextError)) {
        setSaveConflictPath(activeFile.note.rootRelativePath);
      }
      setError(messageForError(nextError));
    } finally {
      setIsDeleting(false);
    }
  }

  async function runDocReview() {
    setIsReviewing(true);
    setReviewError("");
    setNotice("");
    setReviewVisibleIssueCount(initialReviewIssueCount);

    const params = new URLSearchParams({ force: "1" });
    if (repoFilter !== "all") {
      params.set("repo", repoFilter);
    }

    try {
      const review = await requestJson<DocReviewPayload>(`/api/review?${params.toString()}`);
      setDocReview(review);
      setNotice(
        review.issueCount === 0
          ? `Review found no issues in ${review.scope.label}.`
          : `Review found ${review.issueCount} ${review.issueCount === 1 ? "issue" : "issues"} in ${review.scope.label}.`,
      );
    } catch (nextError) {
      setReviewError(messageForError(nextError));
    } finally {
      setIsReviewing(false);
    }
  }

  async function runGitChanges() {
    setIsMoreOpen(false);
    setIsLoadingGitChanges(true);
    setGitChangesError("");
    setNotice("");

    const params = new URLSearchParams({ force: "1" });
    if (repoFilter !== "all") {
      params.set("repo", repoFilter);
    }

    try {
      await refreshIndex({ force: true, quiet: true, preserveGitChanges: true });
      const changes = await requestJson<GitChangesPayload>(`/api/git/changes?${params.toString()}`);
      setGitChanges(changes);
      setNotice(
        changes.changeCount === 0
          ? `No changed docs in ${changes.scope.label}.`
          : `Found ${changes.changeCount} changed ${changes.changeCount === 1 ? "doc" : "docs"} in ${changes.scope.label}.`,
      );
    } catch (nextError) {
      setGitChangesError(messageForError(nextError));
    } finally {
      setIsLoadingGitChanges(false);
    }
  }

  async function writeClipboard(value: string) {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(value);
        return;
      } catch {
        // Fall back to the old selection API below for browsers that gate clipboard writes.
      }
    }

    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const didCopy = document.execCommand("copy");
    textarea.remove();

    if (!didCopy) {
      throw new Error("Clipboard copy failed.");
    }
  }

  async function copySelectedPath() {
    if (!selectedNote) {
      return;
    }

    setIsMoreOpen(false);
    setError("");
    setNotice("");

    try {
      await writeClipboard(selectedNote.rootRelativePath);
      setNotice("Copied note path.");
    } catch {
      setError("Could not copy the note path.");
    }
  }

  function openNote(note: NoteFilePayload["note"], options: OpenNoteOptions = {}) {
    const isSameNote = note.rootRelativePath === selectedPath;

    if (!isSameNote && !confirmDiscardDraft()) {
      return false;
    }

    if (options.repoName && options.repoName !== repoFilter) {
      setRepoFilter(options.repoName);
      setDocSearch(null);
      setSearchError("");
      setVisibleNoteCount(initialVisibleNoteCount);
      if (!options.preserveReview) {
        setDocReview(null);
        setReviewError("");
        setReviewVisibleIssueCount(initialReviewIssueCount);
      }
    }

    if (!isSameNote) {
      selectedPathRef.current = note.rootRelativePath;
      setSelectedPath(note.rootRelativePath);
      setSaveConflictPath("");
      if (!options.skipHistory) {
        setNoteHistory((current) => pushNoteHistory(current, note.rootRelativePath));
      }
    }
    setMobilePane("read");
    return true;
  }

  function openHistoryNote(direction: -1 | 1) {
    const targetPath = noteHistoryTarget(noteHistory, direction);
    if (!targetPath) {
      return;
    }

    const targetNote = noteByRootRelativePath.get(targetPath);
    if (!targetNote) {
      setError("That note is no longer in the index. Refresh the workspace.");
      return;
    }

    if (!openNote(targetNote, { repoName: targetNote.repoName, skipHistory: true })) {
      return;
    }

    setNoteHistory((current) => moveNoteHistory(current, direction));
    setNotice(`Opened ${targetNote.title}.`);
  }

  function selectNote(note: NoteFilePayload["note"]) {
    if (!openNote(note)) {
      return;
    }

    const searchLineTarget = lineTargetForSearchResult(searchResultByPath.get(note.rootRelativePath));
    if (!searchLineTarget) {
      return;
    }

    setViewMode((current) => (current === "edit" ? "edit" : "split"));
    setPendingLineTarget(searchLineTarget);
    setNotice(`Opened ${note.title} at search match line ${searchLineTarget.line}.`);
  }

  function selectRepo(repoName: string) {
    setRepoFilter(repoName);
    setDocSearch(null);
    setDocReview(null);
    setGitChanges(null);
    setSearchError("");
    setReviewError("");
    setGitChangesError("");
    setReviewSeverityFilter("all");
    setReviewCategoryFilter("all");
    setReviewVisibleIssueCount(initialReviewIssueCount);
    setVisibleNoteCount(initialVisibleNoteCount);
  }

  function showAllDocs() {
    setRepoFilter("all");
    setDocSearch(null);
    setDocReview(null);
    setGitChanges(null);
    setSearchError("");
    setReviewError("");
    setGitChangesError("");
    setReviewSeverityFilter("all");
    setReviewCategoryFilter("all");
    setReviewVisibleIssueCount(initialReviewIssueCount);
    setVisibleNoteCount(initialVisibleNoteCount);
  }

  function confirmDiscardDraft() {
    return !isDirty || window.confirm("Discard unsaved changes?");
  }

  function clearActiveNote() {
    selectedPathRef.current = "";
    pendingPreviewAnchorRef.current = null;
    setSelectedPath("");
    setNoteHistory({ entries: [], index: -1 });
    setSaveConflictPath("");
    setActiveFile(null);
    setEditorValue("");
    setIsLoadingFile(false);
    setError("");
  }

  function clearDocReview() {
    setDocReview(null);
    setReviewError("");
    setReviewSeverityFilter("all");
    setReviewCategoryFilter("all");
    setReviewVisibleIssueCount(initialReviewIssueCount);
    setIsMoreOpen(false);
    setNotice("Review cleared.");
  }

  function openCreateDrawer() {
    const preferredRepoName = resolvePreferredCreateRepoName(repoFilter, selectedNote?.repoName);
    setIsMoreOpen(false);
    setIsMoveOpen(false);
    setCreateForm((current) => ({
      ...current,
      repoName: resolveCreateRepoName(current.repoName, repos, preferredRepoName),
    }));
    setIsCreateOpen(true);
  }

  function closeCreateDrawer() {
    if (isCreating) {
      return false;
    }

    if (isCreateDraftDirty(createForm) && !window.confirm("Discard this new-note draft?")) {
      return false;
    }

    setIsCreateOpen(false);
    return true;
  }

  function openMoveDrawer() {
    if (!selectedNote) {
      return;
    }

    setIsMoreOpen(false);
    setError("");
    setNotice("");
    if (isDirty) {
      setError("Save or discard changes before moving this note.");
      return;
    }

    setIsCreateOpen(false);
    setMoveForm({ repoRelativePath: selectedNote.repoRelativePath });
    setIsMoveOpen(true);
  }

  function closeMoveDrawer() {
    if (isMoving) {
      return false;
    }

    setIsMoveOpen(false);
    return true;
  }

  function openGitChange(change: GitChangedNote) {
    if (change.status === "deleted") {
      setError("That changed doc was deleted on disk. Use Git to inspect or restore it.");
      return;
    }

    const changedNote = noteByRootRelativePath.get(change.rootRelativePath);
    if (!changedNote) {
      setError("That changed doc is not in the current index. Refresh changed docs and try again.");
      return;
    }

    if (!openNote(changedNote, { repoName: changedNote.repoName })) {
      return;
    }

    setNotice(`Opened changed doc ${changedNote.title}.`);
  }

  function openReviewIssue(issue: DocReviewIssue) {
    const issueNote = notes.find((note) => note.rootRelativePath === issue.rootRelativePath);
    if (!issueNote) {
      setError("That review item is no longer in the index. Refresh and run review again.");
      return;
    }

    if (!openNote(issueNote, { repoName: issue.repoName, preserveReview: true })) {
      return;
    }

    setViewMode((current) => (current === "split" ? "split" : "edit"));
    setPendingLineTarget({ rootRelativePath: issue.rootRelativePath, line: issue.line });
    setNotice(issue.line ? `Opened ${issue.title} at line ${issue.line}.` : `Opened ${issue.title}.`);
  }

  function openOutlineItem(item: NoteOutlineItem) {
    if (!selectedNote) {
      return;
    }

    setViewMode((current) => (current === "edit" ? "edit" : "split"));
    setPendingLineTarget({ rootRelativePath: selectedNote.rootRelativePath, line: item.line });
    setNotice(`Opened ${item.title} at line ${item.line}.`);
  }

  function handleRenderedNoteClick(event: MouseEvent<HTMLElement>) {
    if (!selectedNote) {
      return;
    }

    const link = (event.target as Element | null)?.closest?.("a[href]");
    const href = link?.getAttribute("href")?.trim();
    if (!href) {
      return;
    }

    event.preventDefault();
    setError("");

    if (isExternalPreviewHref(href)) {
      window.open(href, "_blank", "noopener,noreferrer");
      return;
    }

    const target = resolvePreviewLinkTarget(selectedNote, notes, href);
    if (!target) {
      setError("That local link is not in the current index. Refresh the workspace or create the linked note.");
      return;
    }

    pendingPreviewAnchorRef.current =
      target.anchor && target.note.rootRelativePath !== selectedNote.rootRelativePath
        ? { rootRelativePath: target.note.rootRelativePath, anchor: target.anchor }
        : null;

    if (!openNote(target.note)) {
      pendingPreviewAnchorRef.current = null;
      return;
    }

    if (!target.anchor) {
      setNotice(`Opened ${target.note.title}.`);
      return;
    }

    if (target.note.rootRelativePath !== selectedNote.rootRelativePath) {
      setNotice(`Opened ${target.note.title}.`);
      return;
    }

    const anchorTarget = lineTargetForOutlineAnchor(noteOutline, target.anchor, selectedNote.rootRelativePath);
    if (!anchorTarget) {
      setNotice(`Opened ${target.note.title}.`);
      return;
    }

    setViewMode((current) => (current === "edit" ? "edit" : "split"));
    setPendingLineTarget(anchorTarget);
    setNotice(`Opened ${target.note.title} at ${target.anchor}.`);
  }

  return (
    <main className="app-shell">
      <section className={`notes-window mobile-pane-${mobilePane} ${areSourcesVisible ? "" : "sources-hidden"}`}>
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
            <div className="history-controls" aria-label="Note history">
              <button
                className="round-button"
                type="button"
                onClick={() => openHistoryNote(-1)}
                disabled={!previousHistoryNote}
                aria-label={previousHistoryNote ? `Back to ${previousHistoryNote.title}` : "Back"}
              >
                <ChevronLeft size={18} />
              </button>
              <button
                className="round-button"
                type="button"
                onClick={() => openHistoryNote(1)}
                disabled={!nextHistoryNote}
                aria-label={nextHistoryNote ? `Forward to ${nextHistoryNote.title}` : "Forward"}
              >
                <ChevronRight size={18} />
              </button>
            </div>
            <button
              className={`round-button source-toggle ${areSourcesVisible ? "" : "is-active"}`}
              type="button"
              onClick={() => {
                setIsMoreOpen(false);
                setAreSourcesVisible((current) => !current);
              }}
              aria-label={areSourcesVisible ? "Hide projects" : "Show projects"}
              aria-pressed={!areSourcesVisible}
            >
              <PanelLeft size={18} />
            </button>
            <button
              className="round-button"
              type="button"
              onClick={openCreateDrawer}
              disabled={repos.length === 0}
              aria-label="New note"
              aria-keyshortcuts="Meta+N Control+N"
            >
              <SquarePen size={18} />
            </button>
            <button
              className="round-button"
              type="button"
              onClick={() => {
                setIsMoreOpen(false);
                void refreshIndex({ force: true });
              }}
              disabled={isIndexing}
              aria-label="Refresh"
            >
              {isIndexing ? <Loader2 className="spin" size={18} /> : <RefreshCcw size={18} />}
            </button>
            <button
              className={`round-button more-button ${isMoreOpen ? "is-active" : ""}`}
              type="button"
              onClick={() => setIsMoreOpen((current) => !current)}
              aria-expanded={isMoreOpen}
              aria-haspopup="menu"
              aria-label="More actions"
            >
              <MoreHorizontal size={18} />
            </button>
            {isMoreOpen && (
              <div className="topbar-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setIsMoreOpen(false);
                    void runDocReview();
                  }}
                  disabled={isBooting || isIndexing || isReviewing || filteredNotes.length === 0}
                >
                  <ListFilter size={15} />
                  <span>Review current scope</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => void runGitChanges()}
                  disabled={isBooting || isIndexing || isLoadingGitChanges || repos.length === 0}
                >
                  {isLoadingGitChanges ? <Loader2 className="spin" size={15} /> : <GitCompare size={15} />}
                  <span>Show changed docs</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => void copySelectedPath()}
                  disabled={!selectedNote}
                >
                  <Copy size={15} />
                  <span>Copy note path</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={openMoveDrawer}
                  disabled={!selectedNote || isDirty}
                >
                  <FilePenLine size={15} />
                  <span>Rename or move</span>
                </button>
                <button
                  className="is-danger"
                  type="button"
                  role="menuitem"
                  onClick={() => void deleteSelectedNote()}
                  disabled={!selectedNote || isDirty || isDeleting}
                >
                  {isDeleting ? <Loader2 className="spin" size={15} /> : <Trash2 size={15} />}
                  <span>Delete note</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setIsMoreOpen(false);
                    void refreshIndex({ force: true });
                  }}
                  disabled={isIndexing}
                >
                  {isIndexing ? <Loader2 className="spin" size={15} /> : <RefreshCcw size={15} />}
                  <span>Refresh index</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={clearDocReview}
                  disabled={!docReview && !reviewError}
                >
                  <X size={15} />
                  <span>Clear review</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setGitChanges(null);
                    setGitChangesError("");
                    setIsMoreOpen(false);
                    setNotice("Changed docs cleared.");
                  }}
                  disabled={!gitChanges && !gitChangesError}
                >
                  <X size={15} />
                  <span>Clear changes</span>
                </button>
              </div>
            )}
          </div>
        </header>

        {(error || notice) && (
          <div className={`status-strip ${error ? "is-error" : "is-ok"}`} role={error ? "alert" : "status"}>
            <span>{error || notice}</span>
            {error && saveConflictPath === selectedNote?.rootRelativePath && (
              <span className="status-actions">
                <button type="button" onClick={() => void reloadActiveFileFromDisk()} disabled={isLoadingFile}>
                  {isLoadingFile ? "Reloading..." : "Reload from disk"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSaveConflictPath("");
                    setError("");
                  }}
                >
                  Keep editing
                </button>
              </span>
            )}
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
                <p>
                  {activeDocSearch
                    ? `${activeDocSearch.resultCount} ${activeDocSearch.resultCount === 1 ? "match" : "matches"}`
                    : `${filteredNotes.length} ${filteredNotes.length === 1 ? "doc" : "docs"}`}
                </p>
              </div>
              <div className="list-actions">
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
                <button
                  className="review-trigger"
                  type="button"
                  onClick={() => void runDocReview()}
                  disabled={isBooting || isIndexing || isReviewing || filteredNotes.length === 0}
                >
                  {isReviewing ? <Loader2 className="spin" size={14} /> : <ListFilter size={14} />}
                  <span>Review</span>
                </button>
                <button
                  className="review-trigger"
                  type="button"
                  onClick={() => void runGitChanges()}
                  disabled={isBooting || isIndexing || isLoadingGitChanges || repos.length === 0}
                >
                  {isLoadingGitChanges ? <Loader2 className="spin" size={14} /> : <GitCompare size={14} />}
                  <span>Changes</span>
                </button>
              </div>
            </div>
            <label className="list-search">
              <span>Search docs</span>
              <div className="search-box">
                <Search size={15} />
                <input
                  ref={searchInputRef}
                  value={query}
                  onChange={(event) => {
                    const nextQuery = event.target.value;
                    setQuery(nextQuery);
                    setDocSearch(null);
                    setSearchError("");
                    if (nextQuery.trim().length < contentSearchMinLength) {
                      setIsSearching(false);
                    }
                    setVisibleNoteCount(initialVisibleNoteCount);
                  }}
                  placeholder="Title, path, repo, content"
                  spellCheck={false}
                  aria-keyshortcuts="Meta+F Control+F"
                />
              </div>
            </label>
            {normalizedQuery.length >= contentSearchMinLength && (
              <div className={`search-status ${searchError ? "is-error" : ""}`} role={searchError ? "alert" : "status"}>
                {searchError
                  ? searchError
                  : isSearching
                    ? "Searching note contents..."
                    : activeDocSearch
                      ? `Searched ${activeDocSearch.searchedNotes} ${activeDocSearch.searchedNotes === 1 ? "doc" : "docs"} locally.`
                      : "Searching titles, paths, repos, and note contents."}
              </div>
            )}
          </div>
          {(gitChanges || isLoadingGitChanges || gitChangesError) && (
            <section className="review-panel changes-panel" aria-label="Changed docs">
              <div className="review-panel-header">
                <div>
                  <p className="eyebrow">Git changes</p>
                  <h3>{gitChanges?.scope.label ?? (repoFilter === "all" ? "All repos" : repoFilter)}</h3>
                </div>
                {gitChanges && (
                  <span>
                    {gitChanges.reposScanned} {gitChanges.reposScanned === 1 ? "repo" : "repos"}
                  </span>
                )}
              </div>

              {isLoadingGitChanges && (
                <div className="review-message">
                  <Loader2 className="spin" size={16} />
                  <span>Checking local Git status...</span>
                </div>
              )}

              {gitChangesError && (
                <div className="review-message is-error">
                  <span>{gitChangesError}</span>
                </div>
              )}

              {gitChanges && !isLoadingGitChanges && (
                <>
                  <div className="review-counts">
                    <span>{gitChanges.changeCount} changed docs</span>
                    <span>{gitChanges.returnedChangeCount} returned</span>
                    <span>{gitChanges.repoCount - gitChanges.reposScanned} non-git repos skipped</span>
                  </div>

                  {gitChanges.changeCount === 0 ? (
                    <div className="review-message">
                      <span>No changed note-like files found in this Git scope.</span>
                    </div>
                  ) : (
                    <div className="review-issues change-list">
                      {gitChanges.changes.map((change) => {
                        const isOpenable = change.status !== "deleted" && noteByRootRelativePath.has(change.rootRelativePath);

                        return (
                          <button
                            className={`review-issue change-row is-${change.status}`}
                            key={change.id}
                            type="button"
                            onClick={() => openGitChange(change)}
                            disabled={!isOpenable}
                          >
                            <span className="change-status">{gitChangeStatusLabel(change.status)}</span>
                            <span className="review-issue-main">
                              <strong>{change.title}</strong>
                              <span>
                                {change.repoName}/{change.repoRelativePath}
                              </span>
                              {change.previousRepoRelativePath && (
                                <em>from {change.repoName}/{change.previousRepoRelativePath}</em>
                              )}
                            </span>
                            <span className="change-stage">
                              {change.staged ? "staged" : ""}
                              {change.staged && change.unstaged ? " + " : ""}
                              {change.unstaged ? "unstaged" : ""}
                            </span>
                          </button>
                        );
                      })}
                      {cappedGitChangesMessage && <div className="review-more">{cappedGitChangesMessage}</div>}
                    </div>
                  )}
                </>
              )}
            </section>
          )}
          {(docReview || isReviewing || reviewError) && (
            <section className="review-panel" aria-label="Docs review">
              <div className="review-panel-header">
                <div>
                  <p className="eyebrow">Docs review</p>
                  <h3>{docReview?.scope.label ?? (repoFilter === "all" ? "All repos" : repoFilter)}</h3>
                </div>
                {docReview && (
                  <span>
                    {docReview.notesReviewed} {docReview.notesReviewed === 1 ? "doc" : "docs"}
                  </span>
                )}
              </div>

              {isReviewing && (
                <div className="review-message">
                  <Loader2 className="spin" size={16} />
                  <span>Checking local docs...</span>
                </div>
              )}

              {reviewError && (
                <div className="review-message is-error">
                  <span>{reviewError}</span>
                </div>
              )}

              {docReview && !isReviewing && (
                <>
                  <div className="review-counts">
                    <span className={docReview.severityCounts.high > 0 ? "is-high" : ""}>
                      {docReview.severityCounts.high} high
                    </span>
                    <span className={docReview.severityCounts.medium > 0 ? "is-medium" : ""}>
                      {docReview.severityCounts.medium} medium
                    </span>
                    <span className={docReview.severityCounts.low > 0 ? "is-low" : ""}>
                      {docReview.severityCounts.low} low
                    </span>
                  </div>

                  {docReview.issueCount > 0 && (
                    <div className="review-filters">
                      <label>
                        <span>Severity</span>
                        <select
                          value={reviewSeverityFilter}
                          onChange={(event) => {
                            setReviewSeverityFilter(event.target.value as ReviewSeverityFilter);
                            setReviewVisibleIssueCount(initialReviewIssueCount);
                          }}
                        >
                          <option value="all">All severity</option>
                          {reviewSeverityOptions.map((severity) => (
                            <option key={severity} value={severity}>
                              {severity}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>Type</span>
                        <select
                          value={reviewCategoryFilter}
                          onChange={(event) => {
                            setReviewCategoryFilter(event.target.value as ReviewCategoryFilter);
                            setReviewVisibleIssueCount(initialReviewIssueCount);
                          }}
                        >
                          <option value="all">All types</option>
                          {reviewCategoryOptions.map((category) => (
                            <option key={category} value={category}>
                              {reviewCategoryLabel(category)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <strong>
                        {filteredReviewIssues.length === docReview.returnedIssueCount
                          ? `${docReview.returnedIssueCount} returned`
                          : `${filteredReviewIssues.length} of ${docReview.returnedIssueCount}`}
                      </strong>
                    </div>
                  )}

                  {docReview.issueCount === 0 ? (
                    <div className="review-message">
                      <span>No broken local links, unresolved markers, empty docs, stale docs, duplicate titles, or oversized files found.</span>
                    </div>
                  ) : filteredReviewIssues.length === 0 ? (
                    <div className="review-message">
                      <span>No review issues match these filters.</span>
                    </div>
                  ) : (
                    <div className="review-issues">
                      {visibleReviewIssues.map((issue) => (
                        <button
                          className="review-issue"
                          key={issue.id}
                          type="button"
                          onClick={() => openReviewIssue(issue)}
                        >
                          <span className={`severity-dot is-${issue.severity}`} />
                          <span className="review-issue-main">
                            <strong>{reviewCategoryLabel(issue.category)}</strong>
                            <span>{issue.message}</span>
                            <em>
                              {issue.rootRelativePath}
                              {issue.line ? `:${issue.line}` : ""}
                            </em>
                          </span>
                        </button>
                      ))}
                      {canShowMoreReviewIssues && (
                        <button
                          className="review-show-more"
                          type="button"
                          onClick={() =>
                            setReviewVisibleIssueCount((current) =>
                              nextReviewIssueLimit(current, filteredReviewIssues.length),
                            )
                          }
                        >
                          Show {Math.min(initialReviewIssueCount, filteredReviewIssues.length - visibleReviewIssues.length)} more issues
                        </button>
                      )}
                      {!canShowMoreReviewIssues && docReview.issueCount > docReview.returnedIssueCount && (
                        <div className="review-more">
                          Review returned the first {docReview.returnedIssueCount} of {docReview.issueCount} issues. Narrow the scope to inspect more.
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </section>
          )}
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
                {group.notes.map((note) => {
                  const searchResult = searchResultByPath.get(note.rootRelativePath);

                  return (
                    <button
                      className={`note-row ${note.rootRelativePath === selectedPath ? "is-selected" : ""}`}
                      key={note.id}
                      type="button"
                      onClick={() => selectNote(note)}
                    >
                      <span className="note-title">{note.title}</span>
                      <span className="note-path">{note.repoName}/{note.repoRelativePath}</span>
                      {searchResult?.snippet && (
                        <span className="note-search-snippet">
                          {searchMatchLabel(searchResult)} {searchResult.snippet}
                        </span>
                      )}
                      <span className="note-meta">
                        <span>{formatDateLabel(note.updatedAtMs)}</span>
                        <span className="note-preview">{note.kind} · {formatBytes(note.byteSize)}</span>
                      </span>
                    </button>
                  );
                })}
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
            {cappedSearchMessage && <div className="search-limit-message">{cappedSearchMessage}</div>}
            {!isBooting && !isIndexing && filteredNotes.length === 0 && (
              <div className="empty-state">
                <strong>No notes found.</strong>
                <span>
                  {normalizedQuery.length >= contentSearchMinLength
                    ? "No titles, paths, repos, or note contents matched this search."
                    : "Set a workspace root, refresh the index, or loosen the current filters."}
                </span>
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
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => void saveFile()}
                    disabled={!isDirty || isSaving}
                    aria-keyshortcuts="Meta+S Control+S"
                  >
                    {isSaving ? <Loader2 className="spin" size={15} /> : <Save size={15} />}
                    <span>{isDirty ? "Save changes" : "Saved"}</span>
                  </button>
                </div>
              </div>
              <div className="note-date">{formatFullDateTime(selectedNote.updatedAtMs)}</div>
              {noteOutline.length > 0 && (
                <nav className="note-outline" aria-label="Document outline">
                  <div className="note-outline-label">
                    <ListTree size={14} />
                    <span>Outline</span>
                  </div>
                  <div className="note-outline-list">
                    {noteOutline.map((item) => (
                      <button
                        className={`outline-chip level-${Math.min(item.level, 4)}`}
                        key={item.id}
                        type="button"
                        onClick={() => openOutlineItem(item)}
                      >
                        <span>{item.title}</span>
                        <em>{item.line}</em>
                      </button>
                    ))}
                  </div>
                </nav>
              )}
              <div className={`reader-body mode-${viewMode}`}>
                {viewMode !== "edit" && (
                  <article
                    className="rendered-note"
                    onClick={handleRenderedNoteClick}
                    dangerouslySetInnerHTML={{ __html: renderedHtml }}
                  />
                )}
                {viewMode !== "preview" && (
                  <textarea
                    ref={editorRef}
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
          <div className="drawer-scrim" role="presentation" onClick={() => void closeCreateDrawer()}>
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
                <button className="round-button" type="button" onClick={() => void closeCreateDrawer()} aria-label="Close">
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
        {isMoveOpen && selectedNote && (
          <div className="drawer-scrim" role="presentation" onClick={() => void closeMoveDrawer()}>
            <aside
              className="create-drawer"
              aria-labelledby="move-note-title"
              aria-modal="true"
              role="dialog"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="drawer-header">
                <div>
                  <p className="eyebrow">{selectedNote.repoName}</p>
                  <h2 id="move-note-title">Rename or move</h2>
                </div>
                <button className="round-button" type="button" onClick={() => void closeMoveDrawer()} aria-label="Close">
                  <X size={16} />
                </button>
              </div>
              <form className="create-form" onSubmit={moveFile}>
                <label>
                  <span>Repo</span>
                  <input value={selectedNote.repoName} disabled spellCheck={false} />
                </label>
                <label>
                  <span>Relative path</span>
                  <input
                    value={moveForm.repoRelativePath}
                    onChange={(event) => setMoveForm({ repoRelativePath: event.target.value })}
                    placeholder="docs/notes.md"
                    spellCheck={false}
                    required
                  />
                </label>
                <button
                  className="primary-button"
                  type="submit"
                  disabled={isMoving || isDirty || !moveForm.repoRelativePath.trim()}
                >
                  {isMoving ? <Loader2 className="spin" size={15} /> : <FilePenLine size={15} />}
                  <span>Move note</span>
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
    throw new ApiRequestError(payload?.error ?? `Request failed with ${response.status}`, response.status);
  }

  return payload as T;
}

class ApiRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
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

function readWorkspaceSession() {
  try {
    return JSON.parse(window.localStorage.getItem(workspaceSessionStorageKey) ?? "null") as unknown;
  } catch {
    return null;
  }
}

function writeWorkspaceSession(session: WorkspaceSessionState) {
  try {
    window.localStorage.setItem(workspaceSessionStorageKey, JSON.stringify(session));
  } catch {
    // Browsers can deny storage; session restore is a convenience, not required state.
  }
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function rewriteRenderedAssetSources(html: string, noteRootRelativePath: string) {
  const template = document.createElement("template");
  template.innerHTML = html;

  for (const image of template.content.querySelectorAll("img[src]")) {
    const source = image.getAttribute("src");
    if (!source) {
      continue;
    }

    const assetPath = previewAssetApiPath(noteRootRelativePath, source);
    if (assetPath) {
      image.setAttribute("src", assetPath);
    }
  }

  return template.innerHTML;
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

function reviewCategoryLabel(category: DocReviewIssue["category"]) {
  switch (category) {
    case "broken-link":
      return "Broken link";
    case "missing-file":
      return "Missing file";
    case "todo-marker":
      return "Open marker";
    case "empty-doc":
      return "Empty doc";
    case "duplicate-title":
      return "Duplicate title";
    case "stale-doc":
      return "Stale doc";
    case "large-file":
      return "Large file";
  }
}

function searchMatchLabel(result: DocSearchResult) {
  if (result.matchKind === "metadata") {
    return "Metadata:";
  }

  return result.line ? `Line ${result.line}:` : "Content:";
}

export default App;

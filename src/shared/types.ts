export type NoteKind = "markdown" | "text" | "html";

export type SupportedNoteExtension =
  | ".md"
  | ".markdown"
  | ".mdx"
  | ".txt"
  | ".html"
  | ".htm";

export interface RepoSummary {
  name: string;
  rootRelativePath: string;
  isGitRepo: boolean;
  noteCount: number;
}

export interface NoteSummary {
  id: string;
  repoName: string;
  repoRelativePath: string;
  rootRelativePath: string;
  extension: SupportedNoteExtension;
  kind: NoteKind;
  title: string;
  byteSize: number;
  updatedAtMs: number;
}

export interface WorkspaceIndex {
  rootPath: string;
  scannedAtMs: number;
  cacheStatus?: "cached" | "fresh";
  repos: RepoSummary[];
  notes: NoteSummary[];
}

export interface WorkspaceConfig {
  rootPath: string;
  rootExists: boolean;
}

export type DocSearchMatchKind = "metadata" | "content";

export interface DocSearchResult {
  note: NoteSummary;
  matchKind: DocSearchMatchKind;
  line?: number;
  snippet?: string;
}

export interface DocSearchPayload {
  generatedAtMs: number;
  query: string;
  scope: {
    repoName?: string;
    label: string;
  };
  searchedNotes: number;
  resultCount: number;
  returnedResultCount: number;
  results: DocSearchResult[];
}

export type DocReviewCategory =
  | "broken-link"
  | "missing-file"
  | "todo-marker"
  | "empty-doc"
  | "duplicate-title"
  | "stale-doc"
  | "large-file";

export type DocReviewSeverity = "high" | "medium" | "low";

export interface DocReviewIssue {
  id: string;
  category: DocReviewCategory;
  severity: DocReviewSeverity;
  repoName: string;
  rootRelativePath: string;
  title: string;
  message: string;
  line?: number;
  target?: string;
  relatedCount?: number;
}

export interface DocReviewPayload {
  generatedAtMs: number;
  scope: {
    repoName?: string;
    label: string;
  };
  reposReviewed: number;
  notesReviewed: number;
  issueCount: number;
  returnedIssueCount: number;
  severityCounts: Record<DocReviewSeverity, number>;
  issues: DocReviewIssue[];
}

export interface NoteFilePayload {
  note: NoteSummary;
  content: string;
}

export interface CreateNoteRequest {
  repoName: string;
  repoRelativePath: string;
  content: string;
}

export interface UpdateNoteRequest {
  rootRelativePath: string;
  content: string;
  expectedUpdatedAtMs: number;
}

export interface MoveNoteRequest {
  rootRelativePath: string;
  repoRelativePath: string;
  expectedUpdatedAtMs: number;
}

export interface DeleteNoteRequest {
  rootRelativePath: string;
  expectedUpdatedAtMs: number;
}

export interface DeleteNotePayload {
  note: NoteSummary;
}

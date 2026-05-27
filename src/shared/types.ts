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

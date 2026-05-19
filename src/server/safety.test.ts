import { expect, test } from "bun:test";
import { join } from "node:path";
import {
  assertSupportedNoteExtension,
  resolveWorkspaceFilePath,
  resolveWorkspaceRoot,
} from "./safety";

test("resolveWorkspaceRoot requires an absolute path", () => {
  expect(() => resolveWorkspaceRoot("relative/path")).toThrow("absolute");
});

test("resolveWorkspaceFilePath keeps paths under the selected root", () => {
  const root = "/tmp/repo-notes-root";

  expect(resolveWorkspaceFilePath(root, "repo/docs/readme.md")).toBe(
    join(root, "repo", "docs", "readme.md"),
  );

  expect(() => resolveWorkspaceFilePath(root, "../secret.md")).toThrow("outside");
  expect(() => resolveWorkspaceFilePath(root, "/etc/passwd")).toThrow("relative");
});

test("assertSupportedNoteExtension accepts only note-like files", () => {
  expect(() => assertSupportedNoteExtension("docs/readme.md")).not.toThrow();
  expect(() => assertSupportedNoteExtension("docs/notes.markdown")).not.toThrow();
  expect(() => assertSupportedNoteExtension("docs/page.html")).not.toThrow();
  expect(() => assertSupportedNoteExtension("notes/todo.txt")).not.toThrow();
  expect(() => assertSupportedNoteExtension("package.json")).toThrow("Unsupported");
});


import { expect, test } from "bun:test";
import { join } from "node:path";
import {
  assertAllowedNotePath,
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

test("assertAllowedNotePath rejects generated, dependency, and hidden directories", () => {
  expect(() => assertAllowedNotePath("alpha/docs/readme.md")).not.toThrow();
  expect(() => assertAllowedNotePath("alpha/.github/workflows/readme.md")).not.toThrow();
  expect(() => assertAllowedNotePath("alpha/.well-known/security.md")).not.toThrow();

  expect(() => assertAllowedNotePath("alpha/node_modules/pkg/readme.md")).toThrow("ignored");
  expect(() => assertAllowedNotePath("alpha/dist/readme.md")).toThrow("ignored");
  expect(() => assertAllowedNotePath("alpha/.git/readme.md")).toThrow("ignored");
  expect(() => assertAllowedNotePath("alpha/.cache/readme.md")).toThrow("ignored");
});

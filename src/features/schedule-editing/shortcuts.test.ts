import { describe, expect, it } from "vitest";

import { editorKeyCommand, SHORTCUT_HELP, type KeyLike } from "./shortcuts";

const key = (code: string, modifiers: Partial<KeyLike> = {}): KeyLike => ({
  code,
  key: "",
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...modifiers,
});

describe("editorKeyCommand", () => {
  it("maps M, E, N and L (long) to the four shifts by key position, any layout", () => {
    // On a Persian layout KeyM types «ئ»: `code` still says KeyM.
    expect(editorKeyCommand({ ...key("KeyM"), key: "ئ" })).toEqual({
      type: "SET",
      shift: "M",
    });
    expect(editorKeyCommand(key("KeyE"))).toEqual({ type: "SET", shift: "E" });
    expect(editorKeyCommand(key("KeyN"))).toEqual({ type: "SET", shift: "N" });
    expect(editorKeyCommand(key("KeyL"))).toEqual({ type: "SET", shift: "ME" });
  });

  it("clears with Delete or Backspace", () => {
    expect(editorKeyCommand(key("Delete"))).toEqual({ type: "CLEAR" });
    expect(editorKeyCommand(key("Backspace"))).toEqual({ type: "CLEAR" });
  });

  it("moves between nurses and controls; left is forward in RTL", () => {
    expect(editorKeyCommand(key("ArrowDown"))).toEqual({
      type: "ROW",
      delta: 1,
    });
    expect(editorKeyCommand(key("ArrowUp"))).toEqual({
      type: "ROW",
      delta: -1,
    });
    expect(editorKeyCommand(key("ArrowLeft"))).toEqual({
      type: "COLUMN",
      delta: 1,
    });
    expect(editorKeyCommand(key("ArrowRight"))).toEqual({
      type: "COLUMN",
      delta: -1,
    });
  });

  it("moves between days with [ and ], and undoes with Ctrl/Cmd+Z", () => {
    expect(editorKeyCommand(key("BracketLeft"))).toEqual({
      type: "DAY",
      direction: "previous",
    });
    expect(editorKeyCommand(key("BracketRight"))).toEqual({
      type: "DAY",
      direction: "next",
    });
    expect(editorKeyCommand(key("KeyZ", { ctrlKey: true }))).toEqual({
      type: "UNDO",
    });
    expect(editorKeyCommand(key("KeyZ", { metaKey: true }))).toEqual({
      type: "UNDO",
    });
  });

  it("leaves every other key and modified key to the browser", () => {
    expect(editorKeyCommand(key("KeyX"))).toBeNull();
    expect(editorKeyCommand(key("Tab"))).toBeNull();
    expect(editorKeyCommand(key("Enter"))).toBeNull();
    expect(editorKeyCommand(key("KeyM", { ctrlKey: true }))).toBeNull();
    expect(editorKeyCommand(key("KeyM", { altKey: true }))).toBeNull();
    expect(editorKeyCommand(key("KeyM", { shiftKey: true }))).toBeNull();
    // Ctrl+Shift+Z (redo) and Alt+Arrow (browser history) are not taken.
    expect(
      editorKeyCommand(key("KeyZ", { ctrlKey: true, shiftKey: true })),
    ).toBeNull();
    expect(editorKeyCommand(key("ArrowLeft", { altKey: true }))).toBeNull();
  });

  it("documents every shortcut it handles", () => {
    expect(SHORTCUT_HELP.map((s) => s.keys)).toEqual([
      "M",
      "E",
      "N",
      "O",
      "L",
      "Delete / Backspace",
      "↑ / ↓",
      "← / →",
      "[ / ]",
      "Ctrl+Z",
    ]);
  });
});

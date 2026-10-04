import { describe, expect, it } from "vitest";

import {
  IMPORT_ACTION_LABELS,
  IMPORT_FIELD_LABELS,
  IMPORT_FILE_ERRORS,
  IMPORT_ROW_ERRORS,
} from "./presentation";

describe("personnel import wording", () => {
  it("words every code in Persian without exposing the code", () => {
    for (const map of [
      IMPORT_ACTION_LABELS,
      IMPORT_FIELD_LABELS,
      IMPORT_FILE_ERRORS,
      IMPORT_ROW_ERRORS,
    ])
      for (const [code, text] of Object.entries(map)) {
        expect(text).toMatch(/[؀-ۿ]/);
        expect(text).not.toContain(code);
      }
  });
});

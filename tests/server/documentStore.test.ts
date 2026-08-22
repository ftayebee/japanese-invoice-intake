import { describe, expect, it } from "vitest";
import {
  DocumentStore,
  sanitizeFilename,
  toDocumentView,
} from "../../server/documentStore.js";

describe("DocumentStore", () => {
  it("keeps only a safe basename for uploaded filenames", () => {
    expect(sanitizeFilename("../../secrets/請求 書.pdf")).toBe("請求_書.pdf");
    expect(sanitizeFilename("..." )).toBe("invoice");
  });

  it("never exposes the source buffer in the public document view", () => {
    const store = new DocumentStore();
    const record = store.create("invoice.pdf", "application/pdf", Buffer.from("%PDF-"));
    const view = toDocumentView(record);

    expect(view.filename).toBe("invoice.pdf");
    expect(view.fileUrl).toBe(`/api/documents/${record.id}/file`);
    expect(view.status).toBe("PENDING");
    expect(view).not.toHaveProperty("buffer");
  });

  it("fails closed for unknown document identifiers", () => {
    const store = new DocumentStore();
    expect(() => store.get("missing")).toThrowError("Invoice document not found.");
  });
});

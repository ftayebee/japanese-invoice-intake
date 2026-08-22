import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AppError } from "../../server/errors.js";
import {
  detectDocumentType,
  extractDocumentContent,
} from "../../server/services/documentContent.js";

const invoicePath = (filename: string): string =>
  path.resolve(process.cwd(), "invoices", filename);

describe("document content routing", () => {
  it.each([
    ["invoice_01.pdf", 1],
    ["invoice_02.pdf", 2],
    ["invoice_03.pdf", 1],
  ])("uses the text layer for %s", async (filename, expectedPages) => {
    const content = await extractDocumentContent(
      await fs.readFile(invoicePath(filename)),
      "application/pdf",
    );

    expect(content.strategy).toBe("pdf-text");
    expect(content.pageCount).toBe(expectedPages);
    expect(content.text?.length).toBeGreaterThan(80);
    expect(content.visionPages).toHaveLength(0);
  });

  it("renders every page of an image-only PDF for vision extraction", async () => {
    const content = await extractDocumentContent(
      await fs.readFile(invoicePath("invoice_09.pdf")),
      "application/pdf",
    );

    expect(content.strategy).toBe("pdf-vision");
    expect(content.pageCount).toBe(1);
    expect(content.text).toBeNull();
    expect(content.visionPages.map((page) => page.pageNumber)).toEqual([1]);
    expect(content.visionPages[0]?.data.length).toBeGreaterThan(10_000);
  });

  it("validates and routes a genuine JPG", async () => {
    const content = await extractDocumentContent(
      await fs.readFile(invoicePath("invoice_04.jpg")),
      "image/jpeg",
    );

    expect(content.strategy).toBe("image-vision");
    expect(content.pageCount).toBe(1);
    expect(content.visionPages).toHaveLength(1);
  });

  it("rejects a MIME-spoofed payload before parsing", () => {
    expect(() => detectDocumentType(Buffer.from("not a real pdf"), "application/pdf"))
      .toThrowError(AppError);
  });
});

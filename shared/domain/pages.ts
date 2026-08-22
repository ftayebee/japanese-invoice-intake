import type { InvoiceLineCandidate, InvoicePageExtraction } from "./types.js";

/**
 * Combine every page in numeric order without mutating the extraction result.
 * Duplicate/missing page numbers are rejected to avoid silent line duplication.
 */
export function aggregateInvoicePageLines(
  pages: readonly InvoicePageExtraction[],
): readonly InvoiceLineCandidate[] {
  const pageNumbers = new Set<number>();
  for (const page of pages) {
    if (!Number.isSafeInteger(page.pageNumber) || page.pageNumber < 1) {
      throw new RangeError("Invoice page numbers must be positive integers.");
    }
    if (pageNumbers.has(page.pageNumber)) {
      throw new RangeError(`Invoice page ${page.pageNumber} was provided more than once.`);
    }
    pageNumbers.add(page.pageNumber);
  }

  return [...pages]
    .sort((left, right) => left.pageNumber - right.pageNumber)
    .flatMap((page) => page.lines);
}

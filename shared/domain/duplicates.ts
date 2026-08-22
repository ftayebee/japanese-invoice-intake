import { normalizeInvoiceDate } from "./dates.js";
import { normalizePartnerName } from "./partners.js";
import type { DuplicateComparableInvoice, DuplicateMatch } from "./types.js";

function normalizeIdentityToken(value: string | null | undefined): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.normalize("NFKC").trim().toUpperCase().replace(/[\s\u3000]/gu, "");
}

/** Strong duplicate identity, matching the accounting API's uniqueness rule. */
export function buildDuplicateKey(
  partnerCode: string | null | undefined,
  invoiceNumber: string | null | undefined,
): string | null {
  const normalizedPartnerCode = normalizeIdentityToken(partnerCode);
  const normalizedInvoiceNumber = normalizeIdentityToken(invoiceNumber);
  if (normalizedPartnerCode === "" || normalizedInvoiceNumber === "") {
    return null;
  }
  return JSON.stringify([normalizedPartnerCode, normalizedInvoiceNumber]);
}

/**
 * A conservative secondary identity. It is returned only when all fields are
 * available; incomplete extraction must not be declared duplicate by guesswork.
 */
export function buildInvoiceFingerprint(invoice: DuplicateComparableInvoice): string | null {
  const normalizedPartnerCode = normalizeIdentityToken(invoice.partnerCode);
  const normalizedPartnerName = normalizePartnerName(invoice.partnerName);
  const supplierIdentity = normalizedPartnerCode !== ""
    ? `CODE:${normalizedPartnerCode}`
    : normalizedPartnerName !== ""
      ? `NAME:${normalizedPartnerName}`
      : "";
  const normalizedInvoiceNumber = normalizeIdentityToken(invoice.invoiceNumber);
  const normalizedIssueDate = normalizeInvoiceDate(invoice.issueDate);

  if (
    supplierIdentity === "" ||
    normalizedInvoiceNumber === "" ||
    normalizedIssueDate === null ||
    !Number.isSafeInteger(invoice.totalAmount)
  ) {
    return null;
  }

  return JSON.stringify([
    supplierIdentity,
    normalizedInvoiceNumber,
    normalizedIssueDate,
    invoice.totalAmount,
  ]);
}

/** Check the strong API key first, then the complete secondary fingerprint. */
export function detectDuplicate(
  candidate: DuplicateComparableInvoice,
  existingInvoices: readonly DuplicateComparableInvoice[],
): DuplicateMatch {
  const strongKey = buildDuplicateKey(candidate.partnerCode, candidate.invoiceNumber);
  if (strongKey !== null) {
    const matchedIndex = existingInvoices.findIndex(
      (existing) =>
        buildDuplicateKey(existing.partnerCode, existing.invoiceNumber) === strongKey,
    );
    if (matchedIndex >= 0) {
      return {
        duplicate: true,
        method: "strong_key",
        reason: "The partner code and normalized invoice number match an existing invoice.",
        matchedIndex,
        identity: strongKey,
      };
    }
  }

  const fingerprint = buildInvoiceFingerprint(candidate);
  if (fingerprint !== null) {
    const matchedIndex = existingInvoices.findIndex(
      (existing) => buildInvoiceFingerprint(existing) === fingerprint,
    );
    if (matchedIndex >= 0) {
      return {
        duplicate: true,
        method: "fingerprint",
        reason: "Supplier, invoice number, issue date, and total match an existing invoice.",
        matchedIndex,
        identity: fingerprint,
      };
    }
  }

  return {
    duplicate: false,
    method: null,
    reason: "No deterministic duplicate identity matched an existing invoice.",
    matchedIndex: null,
    identity: null,
  };
}

import { describe, expect, it } from "vitest";

import {
  buildDuplicateKey,
  buildInvoiceFingerprint,
  detectDuplicate,
  type DuplicateComparableInvoice,
} from "../../shared/domain/index.js";

const invoice01: DuplicateComparableInvoice = {
  partnerCode: "P-1001",
  partnerName: "株式会社山田製作所",
  invoiceNumber: "YM-2026-0107",
  issueDate: "2026-01-07",
  totalAmount: 184_800,
};

describe("duplicate detection", () => {
  it("detects invoice_07 as the same partner + invoice number as invoice_01", () => {
    const invoice07: DuplicateComparableInvoice = {
      ...invoice01,
      invoiceNumber: " ｙｍ-２０２６-０１０７ ",
    };
    const result = detectDuplicate(invoice07, [invoice01]);
    expect(result).toMatchObject({
      duplicate: true,
      method: "strong_key",
      matchedIndex: 0,
    });
  });

  it("builds a stable strong key without unsafe delimiter concatenation", () => {
    expect(buildDuplicateKey(" P-1001 ", "ym-2026-0107")).toBe(
      '["P-1001","YM-2026-0107"]',
    );
  });

  it("uses a complete secondary fingerprint when no partner code exists", () => {
    const first: DuplicateComparableInvoice = {
      ...invoice01,
      partnerCode: null,
      partnerName: "（株）山田製作所",
    };
    const second: DuplicateComparableInvoice = {
      ...first,
      partnerName: "株式会社 山田製作所",
      issueDate: "2026/1/7",
    };
    expect(buildInvoiceFingerprint(second)).toBe(buildInvoiceFingerprint(first));
    expect(detectDuplicate(second, [first]).method).toBe("fingerprint");
  });

  it("does not guess from an incomplete or different identity", () => {
    const incomplete: DuplicateComparableInvoice = {
      partnerCode: null,
      partnerName: "株式会社山田製作所",
      invoiceNumber: null,
      issueDate: "2026-01-07",
      totalAmount: 184_800,
    };
    expect(buildInvoiceFingerprint(incomplete)).toBeNull();
    expect(
      detectDuplicate({ ...invoice01, invoiceNumber: "YM-2026-0108" }, [invoice01]).duplicate,
    ).toBe(false);
  });
});

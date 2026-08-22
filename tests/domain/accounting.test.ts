import { describe, expect, it } from "vitest";

import {
  calculateAccountingTotals,
  toAccountingInvoiceDto,
  validateInvoice,
  type InvoiceCandidate,
  type InvoiceLineCandidate,
} from "../../shared/domain/index.js";

function candidate(overrides: Partial<InvoiceCandidate> = {}): InvoiceCandidate {
  return {
    partnerCode: "P-1001",
    partnerName: "株式会社山田製作所",
    supplierRegistrationNo: "T1010001000101",
    invoiceNumber: "YM-2026-0107",
    issueDate: "2026/01/07",
    dueDate: "2026年2月28日",
    currency: "JPY",
    lines: [
      {
        description: "Precision part A-100",
        quantity: 120,
        unit: "pcs",
        unitPrice: 1_250,
        amount: 150_000,
        taxCode: "T10",
      },
      {
        description: "Packing and freight",
        quantity: null,
        unit: "lot",
        unitPrice: null,
        amount: 18_000,
        taxCode: "T10",
      },
    ],
    subtotal: 168_000,
    taxAmount: 16_800,
    totalAmount: 184_800,
    ...overrides,
  };
}

function lumpSumLine(amount: number, taxCode: string): InvoiceLineCandidate {
  return {
    description: "Lump sum",
    quantity: null,
    unit: "lot",
    unitPrice: null,
    amount,
    taxCode,
  };
}

describe("accounting validation", () => {
  it("accepts null quantity/unitPrice and normalizes dates", () => {
    const result = validateInvoice(candidate(), { knownPartnerCodes: ["P-1001"] });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.issueDate).toBe("2026-01-07");
      expect(result.value.dueDate).toBe("2026-02-28");
      expect(result.value.lines[1]).toMatchObject({ quantity: null, unitPrice: null });
      expect(result.warnings).toEqual([]);
    }
  });

  it("calculates mixed tax per code and floors each group", () => {
    const totals = calculateAccountingTotals([
      { amount: 1_001, taxCode: "T10" },
      { amount: 1_001, taxCode: "T08" },
    ]);
    expect(totals).toEqual({
      subtotal: 2_002,
      taxByCode: { T10: 100, T08: 80 },
      taxAmount: 180,
      totalAmount: 2_182,
    });

    const result = validateInvoice(
      candidate({
        lines: [lumpSumLine(1_001, "T10"), lumpSumLine(1_001, "T08")],
        subtotal: 2_002,
        taxAmount: 180,
        totalAmount: 2_182,
      }),
    );
    expect(result.valid).toBe(true);
  });

  it("preserves a negative discount line in its tax group", () => {
    const result = validateInvoice(
      candidate({
        lines: [
          lumpSumLine(1_000, "T10"),
          {
            description: "Discount",
            quantity: 1,
            unit: "lot",
            unitPrice: -100,
            amount: -100,
            taxCode: "T10",
          },
        ],
        subtotal: 900,
        taxAmount: 90,
        totalAmount: 990,
      }),
    );
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.lines[1]?.amount).toBe(-100);
    }
  });

  it("rejects an unknown tax code", () => {
    const result = validateInvoice(
      candidate({ lines: [lumpSumLine(100, "T05")], subtotal: 100, taxAmount: 5, totalAmount: 105 }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.code === "INVALID_TAX_CODE")).toBe(true);
  });

  it("rejects a quantity × unitPrice mismatch", () => {
    const badLine: InvoiceLineCandidate = {
      description: "Bad calculation",
      quantity: 2,
      unit: "pcs",
      unitPrice: 500,
      amount: 999,
      taxCode: "T10",
    };
    const result = validateInvoice(
      candidate({ lines: [badLine], subtotal: 999, taxAmount: 99, totalAmount: 1_098 }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "LINE_AMOUNT_MISMATCH" })]),
    );
  });

  it.each([
    [{ subtotal: 167_999 }, "SUBTOTAL_MISMATCH"],
    [{ taxAmount: 16_799 }, "TAX_MISMATCH"],
    [{ totalAmount: 184_799 }, "TOTAL_MISMATCH"],
  ] as const)("rejects inconsistent totals", (override, expectedCode) => {
    const result = validateInvoice(candidate(override));
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.code === expectedCode)).toBe(true);
  });

  it("rejects dates, decimals, missing fields, and unknown partner codes", () => {
    const result = validateInvoice(
      candidate({
        partnerCode: "P-INVENTED",
        invoiceNumber: null,
        issueDate: "2026-02-30",
        dueDate: "2026-01-01",
        subtotal: 168_000.5,
      }),
      { knownPartnerCodes: ["P-1001"] },
    );
    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.code)).toEqual(
      expect.arrayContaining([
        "UNKNOWN_PARTNER",
        "REQUIRED_FIELD",
        "INVALID_DATE",
        "INVALID_INTEGER",
      ]),
    );
  });

  it("rejects a due date before its issue date", () => {
    const result = validateInvoice(
      candidate({ issueDate: "2026-02-01", dueDate: "2026-01-31" }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.code === "DUE_DATE_BEFORE_ISSUE_DATE")).toBe(true);
  });

  it("converts only a validated invoice to the exact accounting API DTO", () => {
    const result = validateInvoice(candidate());
    expect(result.valid).toBe(true);
    if (!result.valid) {
      return;
    }

    expect(toAccountingInvoiceDto(result.value)).toEqual({
      partner_code: "P-1001",
      invoice_number: "YM-2026-0107",
      issue_date: "2026-01-07",
      due_date: "2026-02-28",
      currency: "JPY",
      lines: [
        {
          description: "Precision part A-100",
          quantity: 120,
          unit: "pcs",
          unit_price: 1_250,
          amount: 150_000,
          tax_code: "T10",
        },
        {
          description: "Packing and freight",
          quantity: null,
          unit: "lot",
          unit_price: null,
          amount: 18_000,
          tax_code: "T10",
        },
      ],
      subtotal: 168_000,
      tax_amount: 16_800,
      total_amount: 184_800,
    });
  });
});

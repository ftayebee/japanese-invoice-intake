import { describe, expect, it } from "vitest";

import {
  aggregateInvoicePageLines,
  type InvoiceLineCandidate,
} from "../../shared/domain/index.js";

function line(description: string): InvoiceLineCandidate {
  return {
    description,
    quantity: 1,
    unit: "pcs",
    unitPrice: 100,
    amount: 100,
    taxCode: "T10",
  };
}

describe("multi-page invoice aggregation", () => {
  it("keeps all 26 lines from a two-page extraction in page order", () => {
    const page1 = Array.from({ length: 13 }, (_, index) => line(`P1-${index + 1}`));
    const page2 = Array.from({ length: 13 }, (_, index) => line(`P2-${index + 1}`));

    const combined = aggregateInvoicePageLines([
      { pageNumber: 2, lines: page2 },
      { pageNumber: 1, lines: page1 },
    ]);

    expect(combined).toHaveLength(26);
    expect(combined[0]?.description).toBe("P1-1");
    expect(combined[12]?.description).toBe("P1-13");
    expect(combined[13]?.description).toBe("P2-1");
    expect(combined[25]?.description).toBe("P2-13");
  });

  it("rejects duplicate page numbers instead of double-counting lines", () => {
    expect(() =>
      aggregateInvoicePageLines([
        { pageNumber: 1, lines: [line("first")] },
        { pageNumber: 1, lines: [line("duplicate")] },
      ]),
    ).toThrow(/provided more than once/u);
  });
});

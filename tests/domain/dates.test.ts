import { describe, expect, it } from "vitest";

import {
  convertReiwaYear,
  isISODate,
  normalizeInvoiceDate,
  normalizeJapaneseEraYear,
} from "../../shared/domain/index.js";

describe("invoice date normalization", () => {
  it.each([
    ["2026-01-07", "2026-01-07"],
    ["2026/1/7", "2026-01-07"],
    ["２０２６／０１／０７", "2026-01-07"],
    ["2026年1月7日", "2026-01-07"],
    ["令和8年1月7日", "2026-01-07"],
    ["令和元年5月1日", "2019-05-01"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeInvoiceDate(input)).toBe(expected);
  });

  it("converts the assignment's standalone Reiwa year deterministically", () => {
    expect(convertReiwaYear(8)).toBe(2026);
    expect(normalizeJapaneseEraYear("令和8年")).toBe(2026);
    expect(normalizeJapaneseEraYear("令和元年")).toBe(2019);
  });

  it.each(["", "令和8年", "2026-02-30", "2025-02-29", "2026/13/01", "not a date"])(
    "rejects incomplete or impossible date %s",
    (input) => {
      expect(normalizeInvoiceDate(input)).toBeNull();
    },
  );

  it("distinguishes canonical ISO dates from merely normalizable dates", () => {
    expect(isISODate("2024-02-29")).toBe(true);
    expect(isISODate("2024/02/29")).toBe(false);
    expect(isISODate("2024-02-30")).toBe(false);
  });
});

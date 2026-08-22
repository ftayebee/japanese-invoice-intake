import type { ISODate } from "./types.js";

const WESTERN_DATE_PATTERN = /^(\d{4})([-/])(\d{1,2})\2(\d{1,2})$/;
const JAPANESE_DATE_PATTERN = /^(\d{4})年(\d{1,2})月(\d{1,2})日?$/;
const REIWA_DATE_PATTERN = /^令和(元|\d{1,3})年(\d{1,2})月(\d{1,2})日?$/;
const REIWA_YEAR_PATTERN = /^令和(元|\d{1,3})年?$/;

function normalizeDateCharacters(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u2010-\u2015\u2212]/gu, "-")
    .replace(/[\s\u3000]/gu, "")
    .trim();
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  const days = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return days[month - 1] ?? 0;
}

function toISODate(year: number, month: number, day: number): ISODate | null {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    year < 1 ||
    year > 9999 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month)
  ) {
    return null;
  }

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` as ISODate;
}

/** Convert a numeric Reiwa year (Reiwa 1 = 2019) without consulting the LLM. */
export function convertReiwaYear(reiwaYear: number): number | null {
  if (!Number.isSafeInteger(reiwaYear) || reiwaYear < 1) {
    return null;
  }
  return 2018 + reiwaYear;
}

/** Convert a standalone value such as `令和8年` or `令和元年` to its Gregorian year. */
export function normalizeJapaneseEraYear(value: string): number | null {
  const match = REIWA_YEAR_PATTERN.exec(normalizeDateCharacters(value));
  if (match === null) {
    return null;
  }

  const eraToken = match[1];
  if (eraToken === undefined) {
    return null;
  }
  return convertReiwaYear(eraToken === "元" ? 1 : Number(eraToken));
}

/**
 * Normalize the document date formats supported by the assignment to the exact
 * format accepted by the accounting API. Invalid or incomplete dates return null.
 */
export function normalizeInvoiceDate(value: string | null | undefined): ISODate | null {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }

  const normalized = normalizeDateCharacters(value);
  const westernMatch = WESTERN_DATE_PATTERN.exec(normalized);
  if (westernMatch !== null) {
    return toISODate(
      Number(westernMatch[1]),
      Number(westernMatch[3]),
      Number(westernMatch[4]),
    );
  }

  const japaneseMatch = JAPANESE_DATE_PATTERN.exec(normalized);
  if (japaneseMatch !== null) {
    return toISODate(
      Number(japaneseMatch[1]),
      Number(japaneseMatch[2]),
      Number(japaneseMatch[3]),
    );
  }

  const reiwaMatch = REIWA_DATE_PATTERN.exec(normalized);
  if (reiwaMatch === null) {
    return null;
  }

  const reiwaToken = reiwaMatch[1];
  if (reiwaToken === undefined) {
    return null;
  }
  const gregorianYear = convertReiwaYear(reiwaToken === "元" ? 1 : Number(reiwaToken));
  if (gregorianYear === null) {
    return null;
  }

  return toISODate(gregorianYear, Number(reiwaMatch[2]), Number(reiwaMatch[3]));
}

/** A strict guard: unlike normalizeInvoiceDate, it rejects non-canonical formatting. */
export function isISODate(value: string): value is ISODate {
  return /^\d{4}-\d{2}-\d{2}$/u.test(value) && normalizeInvoiceDate(value) === value;
}

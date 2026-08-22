export const TAX_CODES = ["T10", "T08"] as const;

export type TaxCode = (typeof TAX_CODES)[number];

export type InvoiceStatus =
  | "PENDING"
  | "PROCESSING"
  | "READY"
  | "NEEDS_REVIEW"
  | "INVALID"
  | "DUPLICATE"
  | "REGISTERED"
  | "REGISTRATION_FAILED";

declare const isoDateBrand: unique symbol;

/** A real calendar date serialized in the accounting API's YYYY-MM-DD format. */
export type ISODate = string & { readonly [isoDateBrand]: "ISODate" };

export interface Partner {
  readonly partnerCode: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly registrationNo: string;
}

/**
 * Untrusted, normalized extraction data. Nullable properties mirror fields that
 * may be absent from a document and are deliberately stricter after validation.
 */
export interface InvoiceLineCandidate {
  readonly description: string | null;
  readonly quantity: number | null;
  readonly unit: string | null;
  readonly unitPrice: number | null;
  readonly amount: number | null;
  readonly taxCode: string | null;
}

export interface InvoiceCandidate {
  readonly partnerCode: string | null;
  readonly partnerName: string | null;
  readonly supplierRegistrationNo: string | null;
  readonly invoiceNumber: string | null;
  readonly issueDate: string | null;
  readonly dueDate: string | null;
  readonly currency: string | null;
  readonly lines: readonly InvoiceLineCandidate[];
  readonly subtotal: number | null;
  readonly taxAmount: number | null;
  readonly totalAmount: number | null;
}

export interface ValidatedInvoiceLine {
  readonly description: string;
  readonly quantity: number | null;
  readonly unit: string;
  readonly unitPrice: number | null;
  readonly amount: number;
  readonly taxCode: TaxCode;
}

/** Safe to convert to an AccountingInvoiceDto. */
export interface ValidatedInvoice {
  readonly partnerCode: string;
  readonly partnerName: string | null;
  readonly supplierRegistrationNo: string | null;
  readonly invoiceNumber: string;
  readonly issueDate: ISODate;
  readonly dueDate: ISODate;
  readonly currency: "JPY";
  readonly lines: readonly ValidatedInvoiceLine[];
  readonly subtotal: number;
  readonly taxAmount: number;
  readonly totalAmount: number;
}

/** Exact POST /invoices request shape; do not use this as the extraction model. */
export interface AccountingInvoiceDto {
  readonly partner_code: string;
  readonly invoice_number: string;
  readonly issue_date: ISODate;
  readonly due_date: ISODate;
  readonly currency: "JPY";
  readonly lines: readonly AccountingInvoiceLineDto[];
  readonly subtotal: number;
  readonly tax_amount: number;
  readonly total_amount: number;
}

export interface AccountingInvoiceLineDto {
  readonly description: string;
  readonly quantity: number | null;
  readonly unit: string;
  readonly unit_price: number | null;
  readonly amount: number;
  readonly tax_code: TaxCode;
}

export type ValidationIssueCode =
  | "REQUIRED_FIELD"
  | "UNKNOWN_PARTNER"
  | "INVALID_CURRENCY"
  | "INVALID_DATE"
  | "DUE_DATE_BEFORE_ISSUE_DATE"
  | "EMPTY_LINES"
  | "INVALID_INTEGER"
  | "INVALID_TAX_CODE"
  | "PARTIAL_LINE_PRICING"
  | "LINE_AMOUNT_MISMATCH"
  | "UNSAFE_CALCULATION"
  | "SUBTOTAL_MISMATCH"
  | "TAX_MISMATCH"
  | "TOTAL_MISMATCH";

export interface ValidationIssue {
  readonly code: ValidationIssueCode;
  readonly path: string;
  readonly message: string;
  readonly severity: "error" | "warning";
  readonly expected?: unknown;
  readonly actual?: unknown;
}

export type InvoiceValidationResult =
  | {
      readonly valid: true;
      readonly value: ValidatedInvoice;
      readonly errors: readonly [];
      readonly warnings: readonly ValidationIssue[];
    }
  | {
      readonly valid: false;
      readonly value: null;
      readonly errors: readonly ValidationIssue[];
      readonly warnings: readonly ValidationIssue[];
    };

export interface InvoiceValidationOptions {
  /** Supply the current GET /partners codes to reject stale or invented codes. */
  readonly knownPartnerCodes?: readonly string[] | ReadonlySet<string>;
  /** Defaults to exact equality. Intended only for a documented source rounding rule. */
  readonly lineAmountTolerance?: number;
}

export interface AccountingTotals {
  readonly subtotal: number;
  readonly taxByCode: Readonly<Partial<Record<TaxCode, number>>>;
  readonly taxAmount: number;
  readonly totalAmount: number;
}

export interface PartnerMatchCandidate {
  readonly partner: Partner;
  readonly score: number;
  readonly matchedName: string | null;
}

export type PartnerMatchMethod =
  | "registration_number"
  | "normalized_name"
  | "alias"
  | "fuzzy";

export type PartnerMatchResult =
  | {
      readonly status: "matched";
      readonly partner: Partner;
      readonly method: PartnerMatchMethod;
      readonly confidence: number;
      readonly reason: string;
      readonly candidates: readonly PartnerMatchCandidate[];
    }
  | {
      readonly status: "ambiguous";
      readonly partner: null;
      readonly method: null;
      readonly confidence: number;
      readonly reason: string;
      readonly candidates: readonly PartnerMatchCandidate[];
    }
  | {
      readonly status: "not_found";
      readonly partner: null;
      readonly method: null;
      readonly confidence: number;
      readonly reason: string;
      readonly candidates: readonly PartnerMatchCandidate[];
    };

export interface PartnerMatchInput {
  readonly name: string | null | undefined;
  readonly registrationNo: string | null | undefined;
}

export interface PartnerMatchOptions {
  /** Minimum similarity for controlled fuzzy matching. Defaults to 0.84. */
  readonly fuzzyThreshold?: number;
  /** Required lead over the second candidate. Defaults to 0.08. */
  readonly ambiguityMargin?: number;
}

export interface DuplicateComparableInvoice {
  readonly partnerCode: string | null;
  readonly partnerName: string | null;
  readonly invoiceNumber: string | null;
  readonly issueDate: string | null;
  readonly totalAmount: number | null;
}

export type DuplicateMatch =
  | {
      readonly duplicate: true;
      readonly method: "strong_key" | "fingerprint";
      readonly reason: string;
      readonly matchedIndex: number;
      readonly identity: string;
    }
  | {
      readonly duplicate: false;
      readonly method: null;
      readonly reason: string;
      readonly matchedIndex: null;
      readonly identity: null;
    };

export interface InvoicePageExtraction {
  readonly pageNumber: number;
  readonly lines: readonly InvoiceLineCandidate[];
}

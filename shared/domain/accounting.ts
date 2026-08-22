import { normalizeInvoiceDate } from "./dates.js";
import { TAX_CODES } from "./types.js";
import type {
  AccountingInvoiceDto,
  AccountingTotals,
  InvoiceCandidate,
  InvoiceValidationOptions,
  InvoiceValidationResult,
  TaxCode,
  ValidatedInvoice,
  ValidatedInvoiceLine,
  ValidationIssue,
} from "./types.js";

const TAX_PERCENT: Readonly<Record<TaxCode, number>> = {
  T10: 10,
  T08: 8,
};

export function isTaxCode(value: unknown): value is TaxCode {
  return typeof value === "string" && (TAX_CODES as readonly string[]).includes(value);
}

export function isIntegerJPY(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function safeAdd(left: number, right: number): number {
  const sum = left + right;
  if (!Number.isSafeInteger(sum)) {
    throw new RangeError("Accounting amount exceeds JavaScript's safe integer range.");
  }
  return sum;
}

/** Exact mathematical floor, including for a negative taxable subtotal. */
function floorPercent(amount: number, percent: number): number {
  const product = BigInt(amount) * BigInt(percent);
  const denominator = 100n;
  let quotient = product / denominator;
  if (product < 0n && product % denominator !== 0n) {
    quotient -= 1n;
  }
  const result = Number(quotient);
  if (!Number.isSafeInteger(result)) {
    throw new RangeError("Calculated tax exceeds JavaScript's safe integer range.");
  }
  return result;
}

/**
 * Reproduce the accounting API rule: sum each tax-code group, floor that
 * group's tax, then sum the groups. Negative discount lines remain in the group.
 */
export function calculateAccountingTotals(
  lines: readonly { readonly amount: number; readonly taxCode: TaxCode }[],
): AccountingTotals {
  const subtotals: Partial<Record<TaxCode, number>> = {};
  let subtotal = 0;

  for (const line of lines) {
    if (!isIntegerJPY(line.amount) || !isTaxCode(line.taxCode)) {
      throw new TypeError("Tax calculation requires safe-integer amounts and known tax codes.");
    }
    subtotal = safeAdd(subtotal, line.amount);
    subtotals[line.taxCode] = safeAdd(subtotals[line.taxCode] ?? 0, line.amount);
  }

  const taxByCode: Partial<Record<TaxCode, number>> = {};
  let taxAmount = 0;
  for (const taxCode of TAX_CODES) {
    const taxableSubtotal = subtotals[taxCode];
    if (taxableSubtotal === undefined) {
      continue;
    }
    const groupTax = floorPercent(taxableSubtotal, TAX_PERCENT[taxCode]);
    taxByCode[taxCode] = groupTax;
    taxAmount = safeAdd(taxAmount, groupTax);
  }

  return {
    subtotal,
    taxByCode,
    taxAmount,
    totalAmount: safeAdd(subtotal, taxAmount),
  };
}

function requiredStringIssue(path: string): ValidationIssue {
  return {
    code: "REQUIRED_FIELD",
    path,
    message: `${path} is required.`,
    severity: "error",
  };
}

function validateJPYAmount(
  value: number | null,
  path: string,
  errors: ValidationIssue[],
): value is number {
  if (value === null) {
    errors.push(requiredStringIssue(path));
    return false;
  }
  if (!isIntegerJPY(value)) {
    errors.push({
      code: "INVALID_INTEGER",
      path,
      message: `${path} must be a safe integer amount in JPY.`,
      severity: "error",
      actual: value,
    });
    return false;
  }
  return true;
}

function invalidResult(
  errors: readonly ValidationIssue[],
  warnings: readonly ValidationIssue[],
): InvoiceValidationResult {
  return { valid: false, value: null, errors, warnings };
}

/**
 * Deterministically validate and normalize an untrusted invoice candidate.
 * A successful result is the only input accepted by toAccountingInvoiceDto.
 */
export function validateInvoice(
  candidate: InvoiceCandidate,
  options: InvoiceValidationOptions = {},
): InvoiceValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  const partnerCode = candidate.partnerCode?.trim() ?? "";
  if (partnerCode === "") {
    errors.push(requiredStringIssue("partnerCode"));
  } else if (options.knownPartnerCodes !== undefined) {
    const knownPartnerCodes = new Set(options.knownPartnerCodes);
    if (!knownPartnerCodes.has(partnerCode)) {
      errors.push({
        code: "UNKNOWN_PARTNER",
        path: "partnerCode",
        message: "The partner code does not exist in the current partner master.",
        severity: "error",
        actual: partnerCode,
      });
    }
  }

  const invoiceNumber = candidate.invoiceNumber?.normalize("NFKC").trim() ?? "";
  if (invoiceNumber === "") {
    errors.push(requiredStringIssue("invoiceNumber"));
  }

  const issueDate = normalizeInvoiceDate(candidate.issueDate);
  if (candidate.issueDate === null || candidate.issueDate.trim() === "") {
    errors.push(requiredStringIssue("issueDate"));
  } else if (issueDate === null) {
    errors.push({
      code: "INVALID_DATE",
      path: "issueDate",
      message: "issueDate is not a real supported invoice date.",
      severity: "error",
      actual: candidate.issueDate,
    });
  }

  const dueDate = normalizeInvoiceDate(candidate.dueDate);
  if (candidate.dueDate === null || candidate.dueDate.trim() === "") {
    errors.push(requiredStringIssue("dueDate"));
  } else if (dueDate === null) {
    errors.push({
      code: "INVALID_DATE",
      path: "dueDate",
      message: "dueDate is not a real supported invoice date.",
      severity: "error",
      actual: candidate.dueDate,
    });
  }

  if (issueDate !== null && dueDate !== null && dueDate < issueDate) {
    errors.push({
      code: "DUE_DATE_BEFORE_ISSUE_DATE",
      path: "dueDate",
      message: "dueDate cannot be earlier than issueDate.",
      severity: "error",
      expected: `>= ${issueDate}`,
      actual: dueDate,
    });
  }

  const currency = candidate.currency?.trim().toUpperCase() ?? "";
  if (currency === "") {
    errors.push(requiredStringIssue("currency"));
  } else if (currency !== "JPY") {
    errors.push({
      code: "INVALID_CURRENCY",
      path: "currency",
      message: "The accounting API supports JPY only.",
      severity: "error",
      expected: "JPY",
      actual: candidate.currency,
    });
  }

  if (candidate.lines.length === 0) {
    errors.push({
      code: "EMPTY_LINES",
      path: "lines",
      message: "At least one invoice line is required.",
      severity: "error",
    });
  }

  const tolerance =
    typeof options.lineAmountTolerance === "number" &&
    Number.isSafeInteger(options.lineAmountTolerance) &&
    options.lineAmountTolerance >= 0
      ? options.lineAmountTolerance
      : 0;
  const validatedLines: ValidatedInvoiceLine[] = [];

  candidate.lines.forEach((line, index) => {
    const basePath = `lines[${index}]`;
    const description = line.description?.trim() ?? "";
    const unit = line.unit?.trim() ?? "";
    if (description === "") {
      errors.push(requiredStringIssue(`${basePath}.description`));
    }
    if (unit === "") {
      errors.push(requiredStringIssue(`${basePath}.unit`));
    }

    const quantityValid = line.quantity === null || isIntegerJPY(line.quantity);
    if (!quantityValid) {
      errors.push({
        code: "INVALID_INTEGER",
        path: `${basePath}.quantity`,
        message: "quantity must be a safe integer or null.",
        severity: "error",
        actual: line.quantity,
      });
    }

    const unitPriceValid = line.unitPrice === null || isIntegerJPY(line.unitPrice);
    if (!unitPriceValid) {
      errors.push({
        code: "INVALID_INTEGER",
        path: `${basePath}.unitPrice`,
        message: "unitPrice must be a safe integer JPY amount or null.",
        severity: "error",
        actual: line.unitPrice,
      });
    }

    const amountValid = line.amount !== null && isIntegerJPY(line.amount);
    if (line.amount === null) {
      errors.push(requiredStringIssue(`${basePath}.amount`));
    } else if (!amountValid) {
      errors.push({
        code: "INVALID_INTEGER",
        path: `${basePath}.amount`,
        message: "amount must be a safe integer JPY amount.",
        severity: "error",
        actual: line.amount,
      });
    }

    const taxCodeValid = isTaxCode(line.taxCode);
    if (!taxCodeValid) {
      errors.push({
        code: "INVALID_TAX_CODE",
        path: `${basePath}.taxCode`,
        message: "taxCode must be T10 or T08.",
        severity: "error",
        expected: TAX_CODES,
        actual: line.taxCode,
      });
    }

    if ((line.quantity === null) !== (line.unitPrice === null)) {
      warnings.push({
        code: "PARTIAL_LINE_PRICING",
        path: basePath,
        message:
          "Only one of quantity and unitPrice is present; the API accepts this but the line cannot be recalculated.",
        severity: "warning",
      });
    }

    if (
      quantityValid &&
      unitPriceValid &&
      amountValid &&
      line.quantity !== null &&
      line.unitPrice !== null &&
      line.amount !== null
    ) {
      const expectedAmount = line.quantity * line.unitPrice;
      if (!Number.isSafeInteger(expectedAmount)) {
        errors.push({
          code: "UNSAFE_CALCULATION",
          path: `${basePath}.amount`,
          message: "quantity × unitPrice exceeds JavaScript's safe integer range.",
          severity: "error",
        });
      } else if (Math.abs(expectedAmount - line.amount) > tolerance) {
        errors.push({
          code: "LINE_AMOUNT_MISMATCH",
          path: `${basePath}.amount`,
          message: "amount does not equal quantity × unitPrice.",
          severity: "error",
          expected: expectedAmount,
          actual: line.amount,
        });
      }
    }

    if (
      description !== "" &&
      unit !== "" &&
      quantityValid &&
      unitPriceValid &&
      amountValid &&
      taxCodeValid &&
      line.amount !== null
    ) {
      validatedLines.push({
        description,
        quantity: line.quantity,
        unit,
        unitPrice: line.unitPrice,
        amount: line.amount,
        taxCode: line.taxCode,
      });
    }
  });

  const subtotalValid = validateJPYAmount(candidate.subtotal, "subtotal", errors);
  const taxAmountValid = validateJPYAmount(candidate.taxAmount, "taxAmount", errors);
  const totalAmountValid = validateJPYAmount(candidate.totalAmount, "totalAmount", errors);

  if (validatedLines.length === candidate.lines.length && validatedLines.length > 0) {
    try {
      const calculated = calculateAccountingTotals(validatedLines);
      if (subtotalValid && candidate.subtotal !== calculated.subtotal) {
        errors.push({
          code: "SUBTOTAL_MISMATCH",
          path: "subtotal",
          message: "subtotal does not equal the sum of line amounts.",
          severity: "error",
          expected: calculated.subtotal,
          actual: candidate.subtotal,
        });
      }
      if (taxAmountValid && candidate.taxAmount !== calculated.taxAmount) {
        errors.push({
          code: "TAX_MISMATCH",
          path: "taxAmount",
          message: "taxAmount does not equal the sum of per-tax-code floored tax.",
          severity: "error",
          expected: calculated.taxAmount,
          actual: candidate.taxAmount,
        });
      }
      if (totalAmountValid && candidate.totalAmount !== calculated.totalAmount) {
        errors.push({
          code: "TOTAL_MISMATCH",
          path: "totalAmount",
          message: "totalAmount does not equal recalculated subtotal plus tax.",
          severity: "error",
          expected: calculated.totalAmount,
          actual: candidate.totalAmount,
        });
      }
    } catch (error: unknown) {
      errors.push({
        code: "UNSAFE_CALCULATION",
        path: "lines",
        message: error instanceof Error ? error.message : "Invoice totals could not be calculated safely.",
        severity: "error",
      });
    }
  }

  if (errors.length > 0) {
    return invalidResult(errors, warnings);
  }

  if (
    partnerCode === "" ||
    invoiceNumber === "" ||
    issueDate === null ||
    dueDate === null ||
    currency !== "JPY" ||
    validatedLines.length !== candidate.lines.length ||
    candidate.subtotal === null ||
    !isIntegerJPY(candidate.subtotal) ||
    candidate.taxAmount === null ||
    !isIntegerJPY(candidate.taxAmount) ||
    candidate.totalAmount === null ||
    !isIntegerJPY(candidate.totalAmount)
  ) {
    return invalidResult(
      [
        {
          code: "UNSAFE_CALCULATION",
          path: "invoice",
          message: "Invoice failed an internal validated-state invariant.",
          severity: "error",
        },
      ],
      warnings,
    );
  }

  const value: ValidatedInvoice = {
    partnerCode,
    partnerName: candidate.partnerName,
    supplierRegistrationNo: candidate.supplierRegistrationNo,
    invoiceNumber,
    issueDate,
    dueDate,
    currency,
    lines: validatedLines,
    subtotal: candidate.subtotal,
    taxAmount: candidate.taxAmount,
    totalAmount: candidate.totalAmount,
  };
  return { valid: true, value, errors: [], warnings };
}

export function toAccountingInvoiceDto(invoice: ValidatedInvoice): AccountingInvoiceDto {
  return {
    partner_code: invoice.partnerCode,
    invoice_number: invoice.invoiceNumber,
    issue_date: invoice.issueDate,
    due_date: invoice.dueDate,
    currency: invoice.currency,
    lines: invoice.lines.map((line) => ({
      description: line.description,
      quantity: line.quantity,
      unit: line.unit,
      unit_price: line.unitPrice,
      amount: line.amount,
      tax_code: line.taxCode,
    })),
    subtotal: invoice.subtotal,
    tax_amount: invoice.taxAmount,
    total_amount: invoice.totalAmount,
  };
}

import { z } from "zod";
import type { AccountingInvoiceDto, Partner } from "../../shared/domain/types.js";
import { AppError } from "../errors.js";
import { config } from "../config.js";

const errorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().nullable().optional(),
});

const envelopeSchema = z.object({
  success: z.boolean(),
  data: z.unknown().nullable(),
  error: errorSchema.nullable(),
});

const partnerSchema = z.object({
  partner_code: z.string(),
  name: z.string(),
  aliases: z.array(z.string()),
  registration_no: z.string(),
});

const partnersSchema = z.object({ partners: z.array(partnerSchema) });

const registeredInvoiceSchema = z.object({
  accounting_id: z.string(),
  partner_code: z.string(),
  invoice_number: z.string(),
  issue_date: z.string(),
  due_date: z.string(),
  subtotal: z.number().int(),
  tax_amount: z.number().int(),
  total_amount: z.number().int(),
  line_count: z.number().int(),
});

const registeredInvoicesSchema = z.object({ invoices: z.array(registeredInvoiceSchema) });

export type RegisteredInvoice = z.infer<typeof registeredInvoiceSchema>;

export class AccountingApiError extends AppError {
  readonly accountingCode: string;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super("ACCOUNTING_API_REJECTED", message, status, details);
    this.name = "AccountingApiError";
    this.accountingCode = code;
  }
}

export class AccountingApiClient {
  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`${config.accountingApiBaseUrl}${path}`, {
        ...init,
        headers: {
          Accept: "application/json",
          "X-API-Key": config.accountingApiKey,
          ...init.headers,
        },
        signal: AbortSignal.timeout(8_000),
      });
    } catch (error) {
      throw new AppError(
        "ACCOUNTING_API_UNAVAILABLE",
        "The accounting system is unavailable. Start it and try again.",
        503,
        error,
      );
    }

    let parsed: z.infer<typeof envelopeSchema>;
    try {
      parsed = envelopeSchema.parse(await response.json());
    } catch (error) {
      throw new AppError(
        "ACCOUNTING_API_INVALID_RESPONSE",
        "The accounting system returned an unexpected response.",
        502,
        error,
      );
    }

    if (!response.ok || !parsed.success) {
      const apiError = parsed.error;
      throw new AccountingApiError(
        response.status,
        apiError?.code ?? "UNKNOWN_ERROR",
        apiError?.message ?? "The accounting system rejected the request.",
        apiError?.details,
      );
    }

    return parsed.data;
  }

  async health(): Promise<boolean> {
    try {
      const response = await fetch(`${config.accountingApiBaseUrl}/health`, {
        signal: AbortSignal.timeout(2_500),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async getPartners(): Promise<Partner[]> {
    const data = partnersSchema.parse(await this.request("/partners"));
    return data.partners.map((partner) => ({
      partnerCode: partner.partner_code,
      name: partner.name,
      aliases: partner.aliases,
      registrationNo: partner.registration_no,
    }));
  }

  async getRegisteredInvoices(): Promise<RegisteredInvoice[]> {
    const data = registeredInvoicesSchema.parse(await this.request("/invoices"));
    return data.invoices;
  }

  async createInvoice(invoice: AccountingInvoiceDto): Promise<RegisteredInvoice> {
    return registeredInvoiceSchema.parse(
      await this.request("/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(invoice),
      }),
    );
  }
}

import type { InvoiceCandidate, Partner, PartnerMatchResult } from "../../shared/domain/types.js";
import { normalizeInvoiceDate } from "../../shared/domain/dates.js";
import { matchPartner } from "../../shared/domain/partners.js";
import { detectDuplicate } from "../../shared/domain/duplicates.js";
import {
  toAccountingInvoiceDto,
  validateInvoice,
} from "../../shared/domain/accounting.js";
import { config } from "../config.js";
import { DocumentStore, type DocumentRecord } from "../documentStore.js";
import { AppError, errorMessage } from "../errors.js";
import { AccountingApiClient, AccountingApiError } from "./accountingApi.js";
import { AiExtractor, type AiInvoiceExtraction } from "./aiExtractor.js";
import { extractDocumentContent } from "./documentContent.js";

const REVIEW_CONFIDENCE_THRESHOLD = 0.88;
const MAX_CONCURRENT_EXTRACTIONS = 2;

function normalizeDateOrPreserve(value: string | null): string | null {
  return normalizeInvoiceDate(value) ?? value;
}

function normalizedCandidate(
  extraction: AiInvoiceExtraction,
  partnerMatch: PartnerMatchResult,
): InvoiceCandidate {
  return {
    partnerCode: partnerMatch.status === "matched" ? partnerMatch.partner.partnerCode : null,
    partnerName: extraction.supplierName.trim() || null,
    supplierRegistrationNo: extraction.supplierRegistrationNumber,
    invoiceNumber: extraction.invoiceNumber?.normalize("NFKC").trim() || null,
    issueDate: normalizeDateOrPreserve(extraction.issueDate),
    dueDate: normalizeDateOrPreserve(extraction.dueDate),
    currency: extraction.currency,
    lines: extraction.lines.map((line) => ({
      description: line.description.trim() || null,
      quantity: line.quantity,
      unit: line.unit?.trim() || null,
      unitPrice: line.unitPrice,
      amount: line.amount,
      taxCode: line.taxCode,
    })),
    subtotal: extraction.subtotal,
    taxAmount: extraction.taxAmount,
    totalAmount: extraction.totalAmount,
  };
}

function comparable(invoice: InvoiceCandidate) {
  return {
    partnerCode: invoice.partnerCode,
    partnerName: invoice.partnerName,
    invoiceNumber: invoice.invoiceNumber,
    issueDate: invoice.issueDate,
    totalAmount: invoice.totalAmount,
  };
}

function manuallySelectedPartnerMatch(partner: Partner): PartnerMatchResult {
  return {
    status: "matched",
    partner,
    method: "normalized_name",
    confidence: 1,
    reason: "Partner selected explicitly during human review.",
    candidates: [{ partner, score: 1, matchedName: partner.name }],
  };
}

export class InvoiceProcessor {
  private readonly queue: string[] = [];
  private activeExtractions = 0;
  private partnerCache: { partners: Partner[]; expiresAt: number } | null = null;

  constructor(
    private readonly store: DocumentStore,
    private readonly accountingApi = new AccountingApiClient(),
    private readonly aiExtractor = new AiExtractor(),
  ) {}

  get llmConfigured(): boolean {
    return this.aiExtractor.isConfigured;
  }

  enqueue(recordId: string): void {
    if (!this.queue.includes(recordId)) {
      this.queue.push(recordId);
    }
    this.drainQueue();
  }

  private drainQueue(): void {
    while (this.activeExtractions < MAX_CONCURRENT_EXTRACTIONS) {
      const recordId = this.queue.shift();
      if (!recordId) {
        return;
      }
      this.activeExtractions += 1;
      void this.process(recordId).finally(() => {
        this.activeExtractions -= 1;
        this.drainQueue();
      });
    }
  }

  async getPartners(forceRefresh = false): Promise<Partner[]> {
    if (!forceRefresh && this.partnerCache && this.partnerCache.expiresAt > Date.now()) {
      return this.partnerCache.partners;
    }
    const partners = await this.accountingApi.getPartners();
    this.partnerCache = { partners, expiresAt: Date.now() + 30_000 };
    return partners;
  }

  private async process(recordId: string): Promise<void> {
    // A queued or active extraction may outlive a user-requested session clear.
    // Treat the missing in-memory record as cancellation, not a background error.
    if (!this.store.has(recordId)) {
      return;
    }
    const startedAt = new Date().toISOString();
    this.store.update(recordId, (record) => {
      record.status = "PROCESSING";
      record.problem = null;
      record.processing = { ...record.processing, startedAt, completedAt: null };
    });

    try {
      const record = this.store.get(recordId);
      const documentContent = await extractDocumentContent(record.buffer, record.mimeType);
      const extraction = await this.aiExtractor.extract(documentContent);
      const partners = await this.getPartners();
      const partnerMatch = matchPartner(
        {
          name: extraction.supplierName,
          registrationNo: extraction.supplierRegistrationNumber,
        },
        partners,
      );
      const invoice = normalizedCandidate(extraction, partnerMatch);

      this.store.update(recordId, (current) => {
        current.invoice = invoice;
        current.partnerMatch = partnerMatch;
        current.processing = {
          strategy: documentContent.strategy,
          pageCount: documentContent.pageCount,
          model: config.llmModel,
          confidence: extraction.confidence,
          startedAt,
          completedAt: new Date().toISOString(),
        };
        current.warnings = [...new Set([...documentContent.warnings, ...extraction.warnings])];
        current.handwrittenAnnotations = extraction.handwrittenAnnotations;
        current.reviewApproved = false;
      });

      await this.revalidate(recordId, partners);
    } catch (error) {
      if (!this.store.has(recordId)) {
        return;
      }
      const code = error instanceof AppError ? error.code : "PROCESSING_FAILED";
      this.store.update(recordId, (record) => {
        record.status = "INVALID";
        record.problem = { code, message: errorMessage(error) };
        record.processing = {
          ...record.processing,
          completedAt: new Date().toISOString(),
        };
      });
      console.error(`[invoice:${recordId}] ${code}: ${errorMessage(error)}`);
    }
  }

  async revalidate(recordId: string, suppliedPartners?: Partner[]): Promise<DocumentRecord> {
    const record = this.store.get(recordId);
    if (!record.invoice) {
      throw new AppError("INVOICE_NOT_EXTRACTED", "This document has no invoice data to validate.", 409);
    }

    const partners = suppliedPartners ?? (await this.getPartners());
    const selectedPartner = partners.find(
      (partner) => partner.partnerCode === record.invoice?.partnerCode,
    );
    const partnerMatch = selectedPartner
      ? manuallySelectedPartnerMatch(selectedPartner)
      : matchPartner(
          {
            name: record.invoice.partnerName,
            registrationNo: record.invoice.supplierRegistrationNo,
          },
          partners,
        );

    const invoice: InvoiceCandidate = {
      ...record.invoice,
      partnerCode: partnerMatch.status === "matched" ? partnerMatch.partner.partnerCode : null,
      partnerName:
        selectedPartner?.name ?? record.invoice.partnerName,
      issueDate: normalizeDateOrPreserve(record.invoice.issueDate),
      dueDate: normalizeDateOrPreserve(record.invoice.dueDate),
    };
    const validation = validateInvoice(invoice, {
      knownPartnerCodes: partners.map((partner) => partner.partnerCode),
    });

    const localRecords = this.store
      .list()
      .filter(
        (candidate) =>
          candidate.id !== recordId &&
          candidate.invoice !== null &&
          candidate.status !== "INVALID" &&
          candidate.createdAt <= record.createdAt,
      );
    const localDuplicate = detectDuplicate(
      comparable(invoice),
      localRecords.map((candidate) => comparable(candidate.invoice!)),
    );

    let duplicateOf: string | null = null;
    let duplicateReason: string | null = null;
    if (localDuplicate.duplicate) {
      duplicateOf = localRecords[localDuplicate.matchedIndex]?.id ?? null;
      duplicateReason = localDuplicate.reason;
    } else if (validation.valid) {
      try {
        const registered = await this.accountingApi.getRegisteredInvoices();
        const remoteDuplicate = detectDuplicate(
          comparable(invoice),
          registered.map((candidate) => ({
            partnerCode: candidate.partner_code,
            partnerName: null,
            invoiceNumber: candidate.invoice_number,
            issueDate: candidate.issue_date,
            totalAmount: candidate.total_amount,
          })),
        );
        if (remoteDuplicate.duplicate) {
          const match = registered[remoteDuplicate.matchedIndex];
          duplicateOf = match ? `accounting:${match.accounting_id}` : "accounting";
          duplicateReason = remoteDuplicate.reason;
        }
      } catch (error) {
        if (!(error instanceof AppError && error.code === "ACCOUNTING_API_UNAVAILABLE")) {
          throw error;
        }
      }
    }

    return this.store.update(recordId, (current) => {
      current.invoice = invoice;
      current.partnerMatch = partnerMatch;
      current.validation = validation;
      current.duplicateOf = duplicateOf;
      current.duplicateReason = duplicateReason;
      current.problem = null;

      if (duplicateOf) {
        current.status = "DUPLICATE";
        return;
      }
      if (!validation.valid) {
        current.status = "NEEDS_REVIEW";
        return;
      }

      const requiresReview =
        current.warnings.length > 0 ||
        current.handwrittenAnnotations.length > 0 ||
        (current.processing.confidence ?? 0) < REVIEW_CONFIDENCE_THRESHOLD ||
        current.partnerMatch?.method === "fuzzy";
      current.status = requiresReview && !current.reviewApproved ? "NEEDS_REVIEW" : "READY";
    });
  }

  async updateInvoice(recordId: string, invoice: InvoiceCandidate): Promise<DocumentRecord> {
    this.store.update(recordId, (record) => {
      if (record.status === "REGISTERED") {
        throw new AppError("ALREADY_REGISTERED", "Registered invoices cannot be edited.", 409);
      }
      record.invoice = invoice;
      record.reviewApproved = false;
      record.problem = null;
    });
    return this.revalidate(recordId);
  }

  async approve(recordId: string): Promise<DocumentRecord> {
    const record = await this.revalidate(recordId);
    if (!record.validation?.valid || record.duplicateOf) {
      throw new AppError(
        "REVIEW_BLOCKED",
        "Resolve validation errors and duplicates before approving this invoice.",
        409,
      );
    }
    this.store.update(recordId, (current) => {
      current.reviewApproved = true;
    });
    return this.revalidate(recordId);
  }

  async register(recordId: string): Promise<DocumentRecord> {
    const record = await this.revalidate(recordId);
    if (record.status !== "READY" || !record.validation?.valid) {
      throw new AppError(
        "REGISTRATION_BLOCKED",
        "Only a validated, non-duplicate, approved invoice can be registered.",
        409,
      );
    }

    try {
      const registered = await this.accountingApi.createInvoice(
        toAccountingInvoiceDto(record.validation.value),
      );
      return this.store.update(recordId, (current) => {
        current.status = "REGISTERED";
        current.registration = {
          accountingId: registered.accounting_id,
          registeredAt: new Date().toISOString(),
        };
        current.problem = null;
      });
    } catch (error) {
      if (error instanceof AccountingApiError && error.accountingCode === "DUPLICATE_INVOICE") {
        return this.store.update(recordId, (current) => {
          current.status = "DUPLICATE";
          current.duplicateOf = "accounting";
          current.duplicateReason = error.message;
          current.problem = { code: error.accountingCode, message: error.message };
        });
      }

      return this.store.update(recordId, (current) => {
        current.status = "REGISTRATION_FAILED";
        current.problem = {
          code:
            error instanceof AccountingApiError
              ? error.accountingCode
              : error instanceof AppError
                ? error.code
                : "REGISTRATION_FAILED",
          message: errorMessage(error),
        };
      });
    }
  }
}

import fs from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { AccountingInvoiceDto, Partner } from "../../shared/domain/types.js";
import { DocumentStore, type DocumentRecord } from "../../server/documentStore.js";
import {
  AccountingApiClient,
  AccountingApiError,
  type RegisteredInvoice,
} from "../../server/services/accountingApi.js";
import { AiExtractor, type AiInvoiceExtraction } from "../../server/services/aiExtractor.js";
import type { DocumentContent } from "../../server/services/documentContent.js";
import { InvoiceProcessor } from "../../server/services/invoiceProcessor.js";

const PARTNER: Partner = {
  partnerCode: "SUP-0001",
  name: "株式会社サクラオフィスサプライ",
  aliases: ["サクラオフィス"],
  registrationNo: "T1234567890123",
};

function validExtraction(
  overrides: Partial<AiInvoiceExtraction> = {},
): AiInvoiceExtraction {
  return {
    supplierName: PARTNER.name,
    supplierRegistrationNumber: PARTNER.registrationNo,
    invoiceNumber: "INV-2026-0001",
    issueDate: "2026-01-07",
    dueDate: "2026-02-06",
    currency: "JPY",
    lines: [
      {
        description: "事務用品",
        quantity: 2,
        unit: "個",
        unitPrice: 500,
        amount: 1_000,
        taxCode: "T10",
      },
    ],
    subtotal: 1_000,
    taxAmount: 100,
    totalAmount: 1_100,
    confidence: 0.98,
    warnings: [],
    handwrittenAnnotations: [],
    ...overrides,
  };
}

class FakeAiExtractor extends AiExtractor {
  private readonly queuedExtractions: AiInvoiceExtraction[];

  constructor(...extractions: AiInvoiceExtraction[]) {
    super();
    this.queuedExtractions = extractions.map((extraction) => structuredClone(extraction));
  }

  override get isConfigured(): boolean {
    return true;
  }

  override async extract(_document: DocumentContent): Promise<AiInvoiceExtraction> {
    const extraction = this.queuedExtractions.shift();
    if (!extraction) {
      throw new Error("The fake extractor has no queued response.");
    }
    return structuredClone(extraction);
  }
}

class DeferredAiExtractor extends AiExtractor {
  private readonly startedPromise: Promise<void>;
  private resolveStarted!: () => void;
  private readonly extractionPromise: Promise<AiInvoiceExtraction>;
  private resolveExtraction!: (extraction: AiInvoiceExtraction) => void;

  constructor() {
    super();
    this.startedPromise = new Promise((resolve) => {
      this.resolveStarted = resolve;
    });
    this.extractionPromise = new Promise((resolve) => {
      this.resolveExtraction = resolve;
    });
  }

  override get isConfigured(): boolean {
    return true;
  }

  override async extract(_document: DocumentContent): Promise<AiInvoiceExtraction> {
    this.resolveStarted();
    return this.extractionPromise;
  }

  async waitUntilStarted(): Promise<void> {
    await this.startedPromise;
  }

  release(extraction: AiInvoiceExtraction): void {
    this.resolveExtraction(structuredClone(extraction));
  }
}

type CreateMode = "success" | "failure" | "duplicate";

class FakeAccountingApi extends AccountingApiClient {
  readonly createdInvoices: AccountingInvoiceDto[] = [];

  constructor(
    private readonly partners: readonly Partner[] = [PARTNER],
    private readonly registeredInvoices: readonly RegisteredInvoice[] = [],
    private readonly createMode: CreateMode = "success",
  ) {
    super();
  }

  override async getPartners(): Promise<Partner[]> {
    return this.partners.map((partner) => ({
      ...partner,
      aliases: [...partner.aliases],
    }));
  }

  override async getRegisteredInvoices(): Promise<RegisteredInvoice[]> {
    return this.registeredInvoices.map((invoice) => ({ ...invoice }));
  }

  override async createInvoice(invoice: AccountingInvoiceDto): Promise<RegisteredInvoice> {
    this.createdInvoices.push(structuredClone(invoice));

    if (this.createMode === "duplicate") {
      throw new AccountingApiError(
        409,
        "DUPLICATE_INVOICE",
        "This invoice already exists in accounting.",
      );
    }
    if (this.createMode === "failure") {
      throw new AccountingApiError(
        422,
        "POSTING_REJECTED",
        "The accounting system rejected the posting.",
      );
    }

    return {
      accounting_id: "ACC-TEST-0001",
      partner_code: invoice.partner_code,
      invoice_number: invoice.invoice_number,
      issue_date: invoice.issue_date,
      due_date: invoice.due_date,
      subtotal: invoice.subtotal,
      tax_amount: invoice.tax_amount,
      total_amount: invoice.total_amount,
      line_count: invoice.lines.length,
    };
  }
}

let samplePdf: Buffer;

beforeAll(async () => {
  samplePdf = await fs.readFile(path.resolve(process.cwd(), "invoices", "invoice_01.pdf"));
});

function addAndEnqueue(
  store: DocumentStore,
  processor: InvoiceProcessor,
  filename = "invoice_01.pdf",
): DocumentRecord {
  const record = store.create(filename, "application/pdf", samplePdf);
  processor.enqueue(record.id);
  return record;
}

async function waitForStatus(
  store: DocumentStore,
  recordId: string,
  expectedStatuses: readonly DocumentRecord["status"][],
): Promise<DocumentRecord> {
  await vi.waitFor(
    () => {
      expect(expectedStatuses).toContain(store.get(recordId).status);
    },
    { timeout: 10_000, interval: 10 },
  );
  return store.get(recordId);
}

describe("InvoiceProcessor state transitions", () => {
  it("treats clearing a session during extraction as safe cancellation", async () => {
    const store = new DocumentStore();
    const extractor = new DeferredAiExtractor();
    const processor = new InvoiceProcessor(store, new FakeAccountingApi(), extractor);

    addAndEnqueue(store, processor);
    await extractor.waitUntilStarted();
    expect(store.list()[0]?.status).toBe("PROCESSING");

    expect(store.clear()).toBe(1);
    extractor.release(validExtraction());
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(store.list()).toHaveLength(0);
  });

  it("makes a high-confidence, valid, exact-partner extraction READY", async () => {
    const store = new DocumentStore();
    const accounting = new FakeAccountingApi();
    const processor = new InvoiceProcessor(
      store,
      accounting,
      new FakeAiExtractor(validExtraction()),
    );

    const pending = addAndEnqueue(store, processor);
    const record = await waitForStatus(store, pending.id, ["READY"]);

    expect(record.validation?.valid).toBe(true);
    expect(record.partnerMatch).toMatchObject({
      status: "matched",
      partner: { partnerCode: PARTNER.partnerCode },
      method: "normalized_name",
      confidence: 1,
    });
    expect(record.processing.confidence).toBe(0.98);
    expect(record.reviewApproved).toBe(false);
  });

  it.each([
    {
      scenario: "low confidence",
      extraction: validExtraction({ confidence: 0.6 }),
    },
    {
      scenario: "handwriting",
      extraction: validExtraction({
        handwrittenAnnotations: [
          {
            text: "受領済",
            interpretation: "A handwritten received mark is present.",
            affectsInvoiceData: false,
          },
        ],
      }),
    },
  ])("requires review for $scenario, then approval makes it READY", async ({ extraction }) => {
    const store = new DocumentStore();
    const processor = new InvoiceProcessor(
      store,
      new FakeAccountingApi(),
      new FakeAiExtractor(extraction),
    );

    const pending = addAndEnqueue(store, processor);
    const needsReview = await waitForStatus(store, pending.id, ["NEEDS_REVIEW"]);
    expect(needsReview.validation?.valid).toBe(true);

    const approved = await processor.approve(pending.id);
    expect(approved.status).toBe("READY");
    expect(approved.reviewApproved).toBe(true);
  });

  it("keeps an unknown supplier out of READY and blocks approval", async () => {
    const store = new DocumentStore();
    const extraction = validExtraction({
      supplierName: "株式会社未登録サプライヤー",
      supplierRegistrationNumber: "T9999999999999",
    });
    const processor = new InvoiceProcessor(
      store,
      new FakeAccountingApi(),
      new FakeAiExtractor(extraction),
    );

    const pending = addAndEnqueue(store, processor);
    const record = await waitForStatus(store, pending.id, ["NEEDS_REVIEW"]);

    expect(record.partnerMatch?.status).toBe("not_found");
    expect(record.invoice?.partnerCode).toBeNull();
    expect(record.validation).toMatchObject({
      valid: false,
      errors: expect.arrayContaining([
        expect.objectContaining({ code: "REQUIRED_FIELD", path: "partnerCode" }),
      ]),
    });
    await expect(processor.approve(pending.id)).rejects.toMatchObject({
      code: "REVIEW_BLOCKED",
    });
    expect(store.get(pending.id).status).toBe("NEEDS_REVIEW");
  });

  it("marks a second matching invoice as DUPLICATE", async () => {
    const extraction = validExtraction();
    const store = new DocumentStore();
    const processor = new InvoiceProcessor(
      store,
      new FakeAccountingApi(),
      new FakeAiExtractor(extraction, extraction),
    );

    const first = addAndEnqueue(store, processor, "invoice_01.pdf");
    await waitForStatus(store, first.id, ["READY"]);

    const second = addAndEnqueue(store, processor, "invoice_07.pdf");
    const duplicate = await waitForStatus(store, second.id, ["DUPLICATE"]);

    expect(duplicate.duplicateOf).toBe(first.id);
    expect(duplicate.duplicateReason).toContain(
      "partner code and normalized invoice number",
    );
  });

  it.each([
    {
      createMode: "failure" as const,
      expectedStatus: "REGISTRATION_FAILED" as const,
      expectedCode: "POSTING_REJECTED",
    },
    {
      createMode: "duplicate" as const,
      expectedStatus: "DUPLICATE" as const,
      expectedCode: "DUPLICATE_INVOICE",
    },
  ])(
    "maps a $createMode accounting response to $expectedStatus",
    async ({ createMode, expectedStatus, expectedCode }) => {
      const store = new DocumentStore();
      const accounting = new FakeAccountingApi([PARTNER], [], createMode);
      const processor = new InvoiceProcessor(
        store,
        accounting,
        new FakeAiExtractor(validExtraction()),
      );

      const pending = addAndEnqueue(store, processor);
      await waitForStatus(store, pending.id, ["READY"]);

      const result = await processor.register(pending.id);
      expect(result.status).toBe(expectedStatus);
      expect(result.problem?.code).toBe(expectedCode);
      expect(accounting.createdInvoices).toHaveLength(1);
    },
  );
});

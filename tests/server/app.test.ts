import fs from "node:fs/promises";
import path from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../server/app.js";
import { DocumentStore } from "../../server/documentStore.js";
import { AccountingApiClient } from "../../server/services/accountingApi.js";
import { InvoiceProcessor } from "../../server/services/invoiceProcessor.js";

class FakeAccountingApi extends AccountingApiClient {
  override async health(): Promise<boolean> {
    return true;
  }

  override async getPartners() {
    return [];
  }
}

class IdleInvoiceProcessor extends InvoiceProcessor {
  override get llmConfigured(): boolean {
    return true;
  }

  override enqueue(): void {
    // Endpoint tests verify intake boundaries without invoking a paid provider.
  }
}

function testApp() {
  const store = new DocumentStore();
  const accounting = new FakeAccountingApi();
  const processor = new IdleInvoiceProcessor(store, accounting);
  return { app: createApp(store, accounting, processor), store };
}

describe("invoice intake API", () => {
  it("returns a typed bootstrap envelope and security headers", async () => {
    const { app } = testApp();
    const response = await request(app).get("/api/bootstrap").expect(200);

    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.body).toMatchObject({
      success: true,
      error: null,
      data: {
        health: { app: "ok", accountingApi: "available", llm: "configured" },
        partners: [],
        documents: [],
      },
    });
  });

  it("lists all twelve assignment samples", async () => {
    const { app } = testApp();
    const response = await request(app).get("/api/samples").expect(200);

    expect(response.body.data).toHaveLength(12);
    expect(response.body.data[0].filename).toBe("invoice_01.pdf");
    expect(response.body.data[11].filename).toBe("invoice_12.jpg");
  });

  it("loads only explicitly selected assignment samples", async () => {
    const { app, store } = testApp();
    const response = await request(app)
      .post("/api/samples/load")
      .send({ filenames: ["invoice_02.pdf"] })
      .expect(202);

    expect(response.body.data.documents).toHaveLength(1);
    expect(response.body.data.documents[0]).toMatchObject({
      filename: "invoice_02.pdf",
      status: "PENDING",
    });
    expect(store.list()).toHaveLength(1);
  });

  it("accepts a real PDF and serves it inline without exposing its buffer", async () => {
    const { app } = testApp();
    const source = await fs.readFile(path.resolve("invoices", "invoice_01.pdf"));
    const uploaded = await request(app)
      .post("/api/documents")
      .attach("invoices", source, {
        filename: "../../unsafe invoice.pdf",
        contentType: "application/pdf",
      })
      .expect(202);

    const document = uploaded.body.data.documents[0];
    expect(document.filename).toBe("unsafe_invoice.pdf");
    expect(document).not.toHaveProperty("buffer");

    const file = await request(app).get(document.fileUrl).expect(200);
    expect(file.headers["content-type"]).toContain("application/pdf");
    expect(file.headers["content-disposition"]).toContain("inline");
  });

  it("rejects MIME spoofing and missing files with safe errors", async () => {
    const { app } = testApp();
    const spoofed = await request(app)
      .post("/api/documents")
      .attach("invoices", Buffer.from("plain text"), {
        filename: "fake.pdf",
        contentType: "application/pdf",
      })
      .expect(415);
    expect(spoofed.body.error.code).toBe("UNSUPPORTED_FILE");
    expect(spoofed.body.error).not.toHaveProperty("stack");

    const missing = await request(app).post("/api/documents").expect(400);
    expect(missing.body.error.code).toBe("NO_FILES");
  });
});

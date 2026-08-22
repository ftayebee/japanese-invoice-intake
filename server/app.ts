import fs from "node:fs/promises";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import type { InvoiceCandidate } from "../shared/domain/types.js";
import type { AppHealth, SampleFile } from "../shared/transport.js";
import { config } from "./config.js";
import { DocumentStore, toDocumentView } from "./documentStore.js";
import { AppError } from "./errors.js";
import { AccountingApiClient } from "./services/accountingApi.js";
import { detectDocumentType } from "./services/documentContent.js";
import { InvoiceProcessor } from "./services/invoiceProcessor.js";

const invoiceLineSchema = z.object({
  description: z.string().nullable(),
  quantity: z.number().int().nullable(),
  unit: z.string().nullable(),
  unitPrice: z.number().int().nullable(),
  amount: z.number().int().nullable(),
  taxCode: z.string().nullable(),
});

const invoiceCandidateSchema: z.ZodType<InvoiceCandidate> = z.object({
  partnerCode: z.string().nullable(),
  partnerName: z.string().nullable(),
  supplierRegistrationNo: z.string().nullable(),
  invoiceNumber: z.string().nullable(),
  issueDate: z.string().nullable(),
  dueDate: z.string().nullable(),
  currency: z.string().nullable(),
  lines: z.array(invoiceLineSchema),
  subtotal: z.number().int().nullable(),
  taxAmount: z.number().int().nullable(),
  totalAmount: z.number().int().nullable(),
});

const sampleSelectionSchema = z.object({
  filenames: z.array(z.string()).max(12).optional(),
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.maxUploadBytes,
    files: 12,
  },
  fileFilter: (_request, file, callback) => {
    if (["application/pdf", "image/jpeg", "image/jpg"].includes(file.mimetype)) {
      callback(null, true);
      return;
    }
    callback(new AppError("UNSUPPORTED_FILE", "Only PDF and JPG files are supported.", 415));
  },
});

const invoicesDirectory = path.resolve(process.cwd(), "invoices");

function success<T>(response: Response, data: T, status = 200): void {
  response.status(status).json({ success: true, data, error: null });
}

function route(
  handler: (request: Request, response: Response) => Promise<void>,
): (request: Request, response: Response, next: NextFunction) => void {
  return (request, response, next) => {
    void handler(request, response).catch(next);
  };
}

function documentId(request: Request): string {
  const value = request.params.id;
  if (typeof value !== "string" || value === "") {
    throw new AppError("DOCUMENT_NOT_FOUND", "Invoice document not found.", 404);
  }
  return value;
}

async function listSamples(): Promise<SampleFile[]> {
  const entries = await fs.readdir(invoicesDirectory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /^invoice_\d{2}\.(pdf|jpe?g)$/iu.test(entry.name))
    .map((entry): SampleFile => ({
      filename: entry.name,
      mimeType: entry.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg",
    }))
    .sort((left, right) => left.filename.localeCompare(right.filename));
}

export function createApp(
  store = new DocumentStore(),
  accountingApi = new AccountingApiClient(),
  processor = new InvoiceProcessor(store, accountingApi),
) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.use((_request, response, next) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    next();
  });

  app.get(
    "/api/health",
    route(async (_request, response) => {
      const accountingAvailable = await accountingApi.health();
      const health: AppHealth = {
        app: "ok",
        accountingApi: accountingAvailable ? "available" : "unavailable",
        llm: processor.llmConfigured ? "configured" : "missing_key",
        model: config.llmModel,
      };
      success(response, health);
    }),
  );

  app.get(
    "/api/bootstrap",
    route(async (_request, response) => {
      const accountingAvailable = await accountingApi.health();
      const partners = accountingAvailable ? await processor.getPartners().catch(() => []) : [];
      success(response, {
        health: {
          app: "ok",
          accountingApi: accountingAvailable ? "available" : "unavailable",
          llm: processor.llmConfigured ? "configured" : "missing_key",
          model: config.llmModel,
        },
        partners,
        documents: store.list().map(toDocumentView),
      });
    }),
  );

  app.get(
    "/api/partners",
    route(async (_request, response) => {
      success(response, await processor.getPartners());
    }),
  );

  app.get(
    "/api/samples",
    route(async (_request, response) => {
      success(response, await listSamples());
    }),
  );

  app.post(
    "/api/samples/load",
    route(async (request, response) => {
      const selection = sampleSelectionSchema.parse(request.body ?? {});
      const available = await listSamples();
      const selected = selection.filenames
        ? available.filter((sample) => selection.filenames?.includes(sample.filename))
        : available;

      if (selected.length === 0) {
        throw new AppError("NO_SAMPLES_SELECTED", "No matching sample invoices were selected.", 400);
      }

      const records = [];
      for (const sample of selected) {
        const buffer = await fs.readFile(path.join(invoicesDirectory, sample.filename));
        const mimeType = detectDocumentType(buffer, sample.mimeType);
        const record = store.create(sample.filename, mimeType, buffer);
        records.push(record);
        processor.enqueue(record.id);
      }
      success(response, { documents: records.map(toDocumentView) }, 202);
    }),
  );

  app.post(
    "/api/documents",
    upload.array("invoices", 12),
    route(async (request, response) => {
      const files = request.files;
      if (!Array.isArray(files) || files.length === 0) {
        throw new AppError("NO_FILES", "Select at least one PDF or JPG invoice.", 400);
      }

      const records = files.map((file) => {
        const mimeType = detectDocumentType(file.buffer, file.mimetype);
        return store.create(file.originalname, mimeType, file.buffer);
      });
      for (const record of records) {
        processor.enqueue(record.id);
      }
      success(response, { documents: records.map(toDocumentView) }, 202);
    }),
  );

  app.get("/api/documents", (_request, response) => {
    success(response, store.list().map(toDocumentView));
  });

  app.delete("/api/documents", (_request, response) => {
    success(response, { removed: store.clear() });
  });

  app.get("/api/documents/:id", (request, response) => {
    success(response, toDocumentView(store.get(documentId(request))));
  });

  app.get("/api/documents/:id/file", (request, response) => {
    const record = store.get(documentId(request));
    response.setHeader("Content-Type", record.mimeType);
    response.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(record.filename)}`);
    response.setHeader("Cache-Control", "private, max-age=300");
    response.send(record.buffer);
  });

  app.post(
    "/api/documents/:id/process",
    route(async (request, response) => {
      const record = store.get(documentId(request));
      if (record.status === "PROCESSING") {
        throw new AppError("ALREADY_PROCESSING", "This document is already processing.", 409);
      }
      processor.enqueue(record.id);
      success(response, toDocumentView(record), 202);
    }),
  );

  app.put(
    "/api/documents/:id",
    route(async (request, response) => {
      const invoice = invoiceCandidateSchema.parse(request.body);
      success(response, toDocumentView(await processor.updateInvoice(documentId(request), invoice)));
    }),
  );

  app.post(
    "/api/documents/:id/approve",
    route(async (request, response) => {
      success(response, toDocumentView(await processor.approve(documentId(request))));
    }),
  );

  app.post(
    "/api/documents/:id/register",
    route(async (request, response) => {
      success(response, toDocumentView(await processor.register(documentId(request))));
    }),
  );

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof multer.MulterError) {
      response.status(413).json({
        success: false,
        data: null,
        error: { code: "UPLOAD_REJECTED", message: error.message },
      });
      return;
    }

    if (error instanceof z.ZodError) {
      response.status(422).json({
        success: false,
        data: null,
        error: {
          code: "VALIDATION_ERROR",
          message: "The submitted data is malformed.",
          details: error.issues,
        },
      });
      return;
    }

    const appError = error instanceof AppError
      ? error
      : new AppError("INTERNAL_ERROR", "An unexpected server error occurred.", 500);
    if (appError.status >= 500) {
      console.error(`[server] ${appError.code}: ${appError.message}`);
    }
    response.status(appError.status).json({
      success: false,
      data: null,
      error: {
        code: appError.code,
        message: appError.message,
        details: appError.details ?? null,
      },
    });
  });

  return app;
}

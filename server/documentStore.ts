import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  InvoiceCandidate,
  InvoiceStatus,
  InvoiceValidationResult,
  PartnerMatchResult,
} from "../shared/domain/types.js";
import type {
  DocumentProblem,
  DocumentView,
  HandwrittenAnnotation,
  ProcessingMetadata,
  RegistrationResult,
} from "../shared/transport.js";
import type { SupportedMimeType } from "./services/documentContent.js";
import { AppError } from "./errors.js";

export interface DocumentRecord {
  readonly id: string;
  readonly filename: string;
  readonly mimeType: SupportedMimeType;
  readonly buffer: Buffer;
  readonly createdAt: string;
  updatedAt: string;
  status: InvoiceStatus;
  invoice: InvoiceCandidate | null;
  validation: InvoiceValidationResult | null;
  partnerMatch: PartnerMatchResult | null;
  processing: ProcessingMetadata;
  warnings: string[];
  handwrittenAnnotations: HandwrittenAnnotation[];
  duplicateOf: string | null;
  duplicateReason: string | null;
  reviewApproved: boolean;
  registration: RegistrationResult | null;
  problem: DocumentProblem | null;
}

export function sanitizeFilename(filename: string): string {
  const basename = path.basename(filename.normalize("NFKC"));
  const sanitized = basename.replace(/[^\p{L}\p{N}._-]+/gu, "_").replace(/^\.+/u, "");
  return sanitized.slice(0, 180) || "invoice";
}

function emptyProcessingMetadata(): ProcessingMetadata {
  return {
    strategy: null,
    pageCount: null,
    model: null,
    confidence: null,
    startedAt: null,
    completedAt: null,
  };
}

export function toDocumentView(record: DocumentRecord): DocumentView {
  return {
    id: record.id,
    filename: record.filename,
    mimeType: record.mimeType,
    fileUrl: `/api/documents/${record.id}/file`,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    invoice: record.invoice,
    validation: record.validation,
    partnerMatch: record.partnerMatch,
    processing: record.processing,
    warnings: record.warnings,
    handwrittenAnnotations: record.handwrittenAnnotations,
    duplicateOf: record.duplicateOf,
    duplicateReason: record.duplicateReason,
    reviewApproved: record.reviewApproved,
    registration: record.registration,
    problem: record.problem,
  };
}

export class DocumentStore {
  private readonly records = new Map<string, DocumentRecord>();

  create(filename: string, mimeType: SupportedMimeType, buffer: Buffer): DocumentRecord {
    const now = new Date().toISOString();
    const record: DocumentRecord = {
      id: randomUUID(),
      filename: sanitizeFilename(filename),
      mimeType,
      buffer,
      createdAt: now,
      updatedAt: now,
      status: "PENDING",
      invoice: null,
      validation: null,
      partnerMatch: null,
      processing: emptyProcessingMetadata(),
      warnings: [],
      handwrittenAnnotations: [],
      duplicateOf: null,
      duplicateReason: null,
      reviewApproved: false,
      registration: null,
      problem: null,
    };
    this.records.set(record.id, record);
    return record;
  }

  get(id: string): DocumentRecord {
    const record = this.records.get(id);
    if (!record) {
      throw new AppError("DOCUMENT_NOT_FOUND", "Invoice document not found.", 404);
    }
    return record;
  }

  has(id: string): boolean {
    return this.records.has(id);
  }

  list(): DocumentRecord[] {
    return [...this.records.values()].sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt),
    );
  }

  clear(): number {
    const count = this.records.size;
    this.records.clear();
    return count;
  }

  update(id: string, update: (record: DocumentRecord) => void): DocumentRecord {
    const record = this.get(id);
    update(record);
    record.updatedAt = new Date().toISOString();
    return record;
  }
}

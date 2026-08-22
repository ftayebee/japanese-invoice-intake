import type {
  InvoiceCandidate,
  InvoiceStatus,
  InvoiceValidationResult,
  Partner,
  PartnerMatchResult,
} from "./domain/types.js";

export interface HandwrittenAnnotation {
  readonly text: string;
  readonly interpretation: string;
  readonly affectsInvoiceData: boolean;
}

export interface ProcessingMetadata {
  readonly strategy: "pdf-text" | "pdf-vision" | "image-vision" | null;
  readonly pageCount: number | null;
  readonly model: string | null;
  readonly confidence: number | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
}

export interface RegistrationResult {
  readonly accountingId: string;
  readonly registeredAt: string;
}

export interface DocumentProblem {
  readonly code: string;
  readonly message: string;
}

export interface DocumentView {
  readonly id: string;
  readonly filename: string;
  readonly mimeType: "application/pdf" | "image/jpeg";
  readonly fileUrl: string;
  readonly status: InvoiceStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly invoice: InvoiceCandidate | null;
  readonly validation: InvoiceValidationResult | null;
  readonly partnerMatch: PartnerMatchResult | null;
  readonly processing: ProcessingMetadata;
  readonly warnings: readonly string[];
  readonly handwrittenAnnotations: readonly HandwrittenAnnotation[];
  readonly duplicateOf: string | null;
  readonly duplicateReason: string | null;
  readonly reviewApproved: boolean;
  readonly registration: RegistrationResult | null;
  readonly problem: DocumentProblem | null;
}

export interface AppHealth {
  readonly app: "ok";
  readonly accountingApi: "available" | "unavailable";
  readonly llm: "configured" | "missing_key";
  readonly model: string;
}

export interface BootstrapData {
  readonly health: AppHealth;
  readonly partners: readonly Partner[];
  readonly documents: readonly DocumentView[];
}

export interface UploadResponse {
  readonly documents: readonly DocumentView[];
}

export interface SampleFile {
  readonly filename: string;
  readonly mimeType: "application/pdf" | "image/jpeg";
}

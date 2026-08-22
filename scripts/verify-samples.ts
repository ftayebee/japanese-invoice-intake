import type { DocumentView } from "../shared/transport.js";

interface ApiEnvelope<T> {
  readonly success: boolean;
  readonly data: T | null;
  readonly error: { readonly code: string; readonly message: string } | null;
}

const baseUrl = (process.env.APP_BASE_URL ?? "http://127.0.0.1:3001").replace(/\/$/u, "");
const terminalStatuses = new Set<DocumentView["status"]>([
  "READY",
  "NEEDS_REVIEW",
  "INVALID",
  "DUPLICATE",
  "REGISTERED",
  "REGISTRATION_FAILED",
]);

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const envelope = await response.json() as ApiEnvelope<T>;
  if (!response.ok || !envelope.success || envelope.data === null) {
    throw new Error(
      `${envelope.error?.code ?? response.status}: ${envelope.error?.message ?? response.statusText}`,
    );
  }
  return envelope.data;
}

async function documents(): Promise<DocumentView[]> {
  return api<DocumentView[]>("/api/documents");
}

async function waitForTerminalDocuments(timeoutMs = 10 * 60_000): Promise<DocumentView[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = await documents();
    if (current.length === 12 && current.every((document) => terminalStatuses.has(document.status))) {
      return current;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("Timed out waiting for all twelve invoices to finish processing.");
}

function byFilename(documentsToIndex: readonly DocumentView[], filename: string): DocumentView {
  const document = documentsToIndex.find((candidate) => candidate.filename === filename);
  if (!document) {
    throw new Error(`Missing result for ${filename}.`);
  }
  return document;
}

function assert(condition: unknown, message: string, failures: string[]): void {
  if (!condition) failures.push(message);
}

function verifyAssignmentCases(results: readonly DocumentView[]): string[] {
  const failures: string[] = [];
  const invoice = (number: string): DocumentView => byFilename(results, `invoice_${number}`);

  assert(results.length === 12, `Expected 12 documents; received ${results.length}.`, failures);
  for (const number of ["01.pdf", "02.pdf", "03.pdf"]) {
    assert(invoice(number).processing.strategy === "pdf-text", `${number} should use PDF text.`, failures);
  }
  assert(invoice("02.pdf").processing.pageCount === 2, "invoice_02 must preserve both pages.", failures);
  assert(invoice("02.pdf").invoice?.lines.length === 26, "invoice_02 must preserve all 26 lines.", failures);
  assert(invoice("09.pdf").processing.strategy === "pdf-vision", "invoice_09 must use PDF vision.", failures);

  for (const number of ["04.jpg", "05.jpg", "06.jpg", "07.jpg", "08.jpg", "10.jpg", "11.jpg", "12.jpg"]) {
    assert(invoice(number).processing.strategy === "image-vision", `${number} should use image vision.`, failures);
  }

  assert(invoice("03.pdf").invoice?.lines.some((line) => line.taxCode === "T10"), "invoice_03 needs T10 lines.", failures);
  assert(invoice("03.pdf").invoice?.lines.some((line) => line.taxCode === "T08"), "invoice_03 needs T08 lines.", failures);
  assert(invoice("04.jpg").handwrittenAnnotations.length > 0, "invoice_04 handwriting must be surfaced.", failures);
  assert(
    invoice("05.jpg").invoice?.lines.some((line) => line.quantity === null && line.unitPrice === null),
    "invoice_05 must preserve omitted quantity and unit price as null.",
    failures,
  );
  assert(
    invoice("06.jpg").partnerMatch?.status === "matched",
    "invoice_06 alias supplier must resolve to a master partner.",
    failures,
  );
  assert(invoice("07.jpg").status === "DUPLICATE", "invoice_07 must be blocked as duplicate invoice_01.", failures);
  assert(invoice("08.jpg").handwrittenAnnotations.length > 0, "invoice_08 bank correction must be surfaced.", failures);
  assert(
    invoice("10.jpg").partnerMatch?.status !== "matched" && invoice("10.jpg").status !== "READY",
    "invoice_10 unknown supplier must not silently become ready.",
    failures,
  );
  assert(invoice("11.jpg").invoice?.issueDate?.startsWith("2026-") === true, "invoice_11 Reiwa issue date must normalize to 2026.", failures);
  assert(invoice("11.jpg").invoice?.dueDate?.startsWith("2026-") === true, "invoice_11 Reiwa due date must normalize to 2026.", failures);
  assert(invoice("12.jpg").invoice?.lines.some((line) => (line.amount ?? 0) < 0), "invoice_12 discount must stay negative.", failures);

  return failures;
}

async function main(): Promise<void> {
  const health = await api<{ llm: string; accountingApi: string }>("/api/health");
  if (health.llm !== "configured") {
    throw new Error("LLM_API_KEY is not configured on the application server.");
  }
  if (health.accountingApi !== "available") {
    throw new Error("The local accounting API is not available.");
  }

  await api<{ removed: number }>("/api/documents", { method: "DELETE" });
  await api<{ documents: readonly DocumentView[] }>("/api/samples/load", {
    method: "POST",
    body: JSON.stringify({}),
  });
  const results = await waitForTerminalDocuments();

  console.table(results.map((document) => ({
    file: document.filename,
    status: document.status,
    strategy: document.processing.strategy,
    pages: document.processing.pageCount,
    confidence: document.processing.confidence,
    partner: document.invoice?.partnerCode ?? "—",
    invoice: document.invoice?.invoiceNumber ?? "—",
    lines: document.invoice?.lines.length ?? 0,
    total: document.invoice?.totalAmount ?? "—",
  })));

  const failures = verifyAssignmentCases(results);
  if (failures.length > 0) {
    console.error("\nSample verification failed:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log("\nAll twelve assignment cases passed their deterministic verification checks.");
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

import type { BootstrapData, DocumentView, UploadResponse } from "../../shared/transport";
import type { InvoiceCandidate } from "../../shared/domain/types";

interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  error: { code: string; message: string } | null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const body = await response.json() as ApiEnvelope<T>;
  if (!response.ok || !body.success || body.data === null) {
    throw new Error(body.error?.message ?? `Request failed (${response.status})`);
  }
  return body.data;
}

const json = (method: string, body?: unknown): RequestInit => body === undefined
  ? { method }
  : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };

export const api = {
  bootstrap: () => request<BootstrapData>("/api/bootstrap"),
  documents: () => request<readonly DocumentView[]>("/api/documents"),
  loadSamples: () => request<UploadResponse>("/api/samples/load", json("POST", {})),
  upload: (files: FileList) => {
    const form = new FormData();
    Array.from(files).forEach((file) => form.append("invoices", file));
    return request<UploadResponse>("/api/documents", { method: "POST", body: form });
  },
  clear: () => request<{ removed: number }>("/api/documents", { method: "DELETE" }),
  save: (id: string, invoice: InvoiceCandidate) =>
    request<DocumentView>(`/api/documents/${id}`, json("PUT", invoice)),
  approve: (id: string) => request<DocumentView>(`/api/documents/${id}/approve`, json("POST")),
  register: (id: string) => request<DocumentView>(`/api/documents/${id}/register`, json("POST")),
  retry: (id: string) => request<DocumentView>(`/api/documents/${id}/process`, json("POST")),
};

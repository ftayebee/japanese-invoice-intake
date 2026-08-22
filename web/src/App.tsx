import { AlertTriangle, CheckCircle2, CircleDollarSign, Files, Inbox, LoaderCircle, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { InvoiceCandidate, Partner } from "../../shared/domain/types";
import type { AppHealth, DocumentView } from "../../shared/transport";
import { api } from "./api";
import { AppHeader } from "./components/AppHeader";
import { DocumentPreview } from "./components/DocumentPreview";
import { InvoiceEditor } from "./components/InvoiceEditor";
import { InvoiceQueue, type QueueFilter } from "./components/InvoiceQueue";

const workingStatuses = new Set(["PENDING", "PROCESSING"]);
const actionStatuses = new Set(["NEEDS_REVIEW", "INVALID", "DUPLICATE", "REGISTRATION_FAILED"]);
const yen = new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 });

export default function App() {
  const [documents, setDocuments] = useState<readonly DocumentView[]>([]);
  const [partners, setPartners] = useState<readonly Partner[]>([]);
  const [health, setHealth] = useState<AppHealth | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<QueueFilter>("ALL");
  const [search, setSearch] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [booting, setBooting] = useState(true);

  const refreshDocuments = useCallback(async () => {
    const next = await api.documents();
    setDocuments(next);
    setSelectedId((current) => current && next.some((document) => document.id === current) ? current : next[0]?.id ?? null);
  }, []);

  useEffect(() => {
    void api.bootstrap().then((data) => {
      setDocuments(data.documents);
      setPartners(data.partners);
      setHealth(data.health);
      setSelectedId(data.documents[0]?.id ?? null);
    }).catch((error: unknown) => setMessage({ tone: "error", text: error instanceof Error ? error.message : "Unable to load the workspace." })).finally(() => setBooting(false));
  }, []);

  const isProcessing = documents.some((document) => workingStatuses.has(document.status));
  useEffect(() => {
    if (!isProcessing) return;
    const timer = window.setInterval(() => void refreshDocuments().catch(() => undefined), 1100);
    return () => window.clearInterval(timer);
  }, [isProcessing, refreshDocuments]);

  const selected = documents.find((document) => document.id === selectedId) ?? null;
  const metrics = useMemo(() => ({
    total: documents.length,
    processing: documents.filter((document) => workingStatuses.has(document.status)).length,
    action: documents.filter((document) => actionStatuses.has(document.status)).length,
    ready: documents.filter((document) => document.status === "READY" || document.status === "REGISTERED").length,
    value: documents.reduce((total, document) => total + (document.invoice?.totalAmount ?? 0), 0),
  }), [documents]);

  const run = async (name: string, operation: () => Promise<void>, successText?: string) => {
    setBusyAction(name);
    setMessage(null);
    try {
      await operation();
      if (successText) setMessage({ tone: "success", text: successText });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "The action could not be completed." });
    } finally {
      setBusyAction(null);
    }
  };
  const replaceDocument = (next: DocumentView) => {
    setDocuments((current) => current.map((document) => document.id === next.id ? next : document));
  };

  const loadSamples = () => void run("load", async () => {
    const result = await api.loadSamples();
    setDocuments((current) => [...result.documents, ...current]);
    setSelectedId(result.documents[0]?.id ?? null);
  }, "12 sample invoices queued for extraction.");
  const uploadFiles = (files: FileList) => void run("upload", async () => {
    const result = await api.upload(files);
    setDocuments((current) => [...result.documents, ...current]);
    setSelectedId(result.documents[0]?.id ?? null);
  }, `${files.length} invoice${files.length === 1 ? "" : "s"} queued.`);
  const clear = () => {
    if (!window.confirm("Clear every invoice from this local review session?")) return;
    void run("clear", async () => { await api.clear(); setDocuments([]); setSelectedId(null); }, "Review session cleared.");
  };

  if (booting) return <main className="app-loading"><LoaderCircle size={24} /><p>Opening review desk…</p></main>;

  return (
    <div className="app-shell">
      <AppHeader health={health} busy={Boolean(busyAction)} onUpload={uploadFiles} onLoadSamples={loadSamples} onClear={clear} />
      {message && <div className={`toast toast--${message.tone}`} role="status">{message.tone === "success" ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}{message.text}<button onClick={() => setMessage(null)} aria-label="Dismiss notification"><X size={14} /></button></div>}
      <main className="app-main">
        <section className="metrics" aria-label="Batch summary">
          <article><span className="metric-icon metric-icon--blue"><Files size={17} /></span><div><p>Batch total</p><strong>{metrics.total}</strong><span>invoices</span></div></article>
          <article><span className="metric-icon metric-icon--amber"><Inbox size={17} /></span><div><p>Needs action</p><strong>{metrics.action}</strong><span>{metrics.processing ? `+ ${metrics.processing} processing` : "review exceptions"}</span></div></article>
          <article><span className="metric-icon metric-icon--green"><CheckCircle2 size={17} /></span><div><p>Ready</p><strong>{metrics.ready}</strong><span>checks passed</span></div></article>
          <article><span className="metric-icon metric-icon--navy"><CircleDollarSign size={17} /></span><div><p>Invoice value</p><strong>{yen.format(metrics.value)}</strong><span>extracted gross</span></div></article>
        </section>

        {documents.length === 0 ? (
          <section className="welcome-state">
            <span className="welcome-state__icon"><Files size={24} /></span>
            <h1>Bring invoices into one review queue.</h1>
            <p>Upload PDF or JPG invoices, or load the provided 12-document test batch. AI extracts the draft; deterministic checks keep registration guarded.</p>
            <div><button className="button button--primary" onClick={loadSamples} disabled={Boolean(busyAction)} type="button">Load 12 samples</button><label className="button button--secondary">Upload invoices<input type="file" accept="application/pdf,image/jpeg" multiple onChange={(event) => event.target.files && uploadFiles(event.target.files)} /></label></div>
          </section>
        ) : (
          <section className="workspace">
            <InvoiceQueue documents={documents} selectedId={selectedId} filter={filter} search={search} onFilter={setFilter} onSearch={setSearch} onSelect={setSelectedId} />
            <DocumentPreview document={selected} />
            <InvoiceEditor
              document={selected}
              partners={partners}
              busyAction={busyAction}
              onSave={async (invoice: InvoiceCandidate) => { if (!selected) return; await run("save", async () => replaceDocument(await api.save(selected.id, invoice)), "Invoice draft saved and revalidated."); }}
              onApprove={async () => { if (!selected) return; await run("approve", async () => replaceDocument(await api.approve(selected.id)), "Human review approved."); }}
              onRegister={async () => { if (!selected) return; await run("register", async () => replaceDocument(await api.register(selected.id)), "Invoice registered in accounting."); }}
              onRetry={async () => { if (!selected) return; await run("retry", async () => replaceDocument(await api.retry(selected.id)), "Extraction restarted."); }}
            />
          </section>
        )}
      </main>
    </div>
  );
}

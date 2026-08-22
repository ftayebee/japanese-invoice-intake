import { AlertCircle, Check, Plus, RefreshCw, Save, Send, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { InvoiceCandidate, InvoiceLineCandidate, Partner } from "../../../shared/domain/types";
import type { DocumentView } from "../../../shared/transport";
import { StatusBadge } from "./StatusBadge";
import { ValidationPanel } from "./ValidationPanel";

interface Props {
  document: DocumentView | null;
  partners: readonly Partner[];
  busyAction: string | null;
  onSave: (invoice: InvoiceCandidate) => Promise<void>;
  onApprove: () => Promise<void>;
  onRegister: () => Promise<void>;
  onRetry: () => Promise<void>;
}

const blankLine: InvoiceLineCandidate = { description: "", quantity: null, unit: "式", unitPrice: null, amount: null, taxCode: "T10" };
const money = new Intl.NumberFormat("ja-JP");
const nullableNumber = (value: string): number | null => value === "" ? null : Number(value);

export function InvoiceEditor({ document, partners, busyAction, onSave, onApprove, onRegister, onRetry }: Props) {
  const [draft, setDraft] = useState<InvoiceCandidate | null>(document?.invoice ?? null);
  useEffect(() => setDraft(document?.invoice ?? null), [document?.id, document?.updatedAt]);

  const update = <K extends keyof InvoiceCandidate>(key: K, value: InvoiceCandidate[K]) => {
    setDraft((current) => current ? { ...current, [key]: value } : current);
  };
  const updateLine = <K extends keyof InvoiceLineCandidate>(index: number, key: K, value: InvoiceLineCandidate[K]) => {
    if (!draft) return;
    update("lines", draft.lines.map((line, lineIndex) => lineIndex === index ? { ...line, [key]: value } : line));
  };
  const selectedPartner = useMemo(() => partners.find((partner) => partner.partnerCode === draft?.partnerCode), [partners, draft?.partnerCode]);
  const isWorking = document?.status === "PROCESSING" || document?.status === "PENDING";
  const canApprove = Boolean(document && !isWorking && document.invoice && document.validation?.valid && !document.reviewApproved && document.status !== "DUPLICATE");
  const canRegister = Boolean(document && document.reviewApproved && document.validation?.valid && document.status !== "DUPLICATE" && document.status !== "REGISTERED");

  if (!document) {
    return <section className="editor panel empty-pane"><p>Select an invoice to review extracted fields.</p></section>;
  }
  if (isWorking || !draft) {
    return (
      <section className="editor panel processing-pane">
        <div className="processing-orbit"><RefreshCw size={20} /></div>
        <h2>{document.status === "PENDING" ? "Waiting to extract" : "Reading invoice"}</h2>
        <p>Identifying supplier, dates, line items, tax, totals, and handwritten exceptions.</p>
        {document.problem && <div className="notice notice--danger"><AlertCircle size={16} /><div><strong>{document.problem.code}</strong><p>{document.problem.message}</p></div></div>}
      </section>
    );
  }

  return (
    <section className="editor panel">
      <div className="panel-heading editor-heading">
        <div><h2>Review accounting record</h2></div>
        <StatusBadge status={document.status} />
      </div>
      <div className="editor-scroll">
        <div className="confidence-row">
          <span>AI confidence</span>
          <strong>{document.processing.confidence === null ? "—" : `${Math.round(document.processing.confidence * 100)}%`}</strong>
          <div className="confidence-bar"><span style={{ width: `${Math.round((document.processing.confidence ?? 0) * 100)}%` }} /></div>
        </div>
        <ValidationPanel document={document} />

        <fieldset className="form-section">
          <legend>Supplier & invoice</legend>
          <div className="form-grid">
            <label className="field field--wide"><span>Supplier</span>
              <select value={draft.partnerCode ?? ""} onChange={(event) => {
                const partner = partners.find((item) => item.partnerCode === event.target.value);
                setDraft((current) => current ? { ...current, partnerCode: partner?.partnerCode ?? null, partnerName: partner?.name ?? current.partnerName, supplierRegistrationNo: partner?.registrationNo ?? current.supplierRegistrationNo } : current);
              }}>
                <option value="">Select known supplier</option>
                {partners.map((partner) => <option value={partner.partnerCode} key={partner.partnerCode}>{partner.partnerCode} · {partner.name}</option>)}
              </select>
              {!selectedPartner && <small>Registration is blocked until a known partner is selected.</small>}
            </label>
            <label className="field"><span>Invoice number</span><input value={draft.invoiceNumber ?? ""} onChange={(event) => update("invoiceNumber", event.target.value || null)} /></label>
            <label className="field"><span>Registration number</span><input value={draft.supplierRegistrationNo ?? ""} onChange={(event) => update("supplierRegistrationNo", event.target.value || null)} /></label>
            <label className="field"><span>Issue date</span><input type="date" value={draft.issueDate ?? ""} onChange={(event) => update("issueDate", event.target.value || null)} /></label>
            <label className="field"><span>Due date</span><input type="date" value={draft.dueDate ?? ""} onChange={(event) => update("dueDate", event.target.value || null)} /></label>
            <label className="field"><span>Currency</span><select value={draft.currency ?? "JPY"} onChange={(event) => update("currency", event.target.value)}><option>JPY</option></select></label>
          </div>
        </fieldset>

        <fieldset className="form-section">
          <legend>Line items <span>{draft.lines.length}</span></legend>
          <div className="line-table-scroll">
            <table className="line-table">
              <thead><tr><th>Description</th><th>Qty</th><th>Unit</th><th>Unit price</th><th>Amount</th><th>Tax</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {draft.lines.map((line, index) => (
                  <tr key={index}>
                    <td><input aria-label={`Line ${index + 1} description`} value={line.description ?? ""} onChange={(event) => updateLine(index, "description", event.target.value || null)} /></td>
                    <td><input aria-label={`Line ${index + 1} quantity`} inputMode="numeric" value={line.quantity ?? ""} onChange={(event) => updateLine(index, "quantity", nullableNumber(event.target.value))} /></td>
                    <td><input aria-label={`Line ${index + 1} unit`} value={line.unit ?? ""} onChange={(event) => updateLine(index, "unit", event.target.value || null)} /></td>
                    <td><input aria-label={`Line ${index + 1} unit price`} inputMode="numeric" value={line.unitPrice ?? ""} onChange={(event) => updateLine(index, "unitPrice", nullableNumber(event.target.value))} /></td>
                    <td><input aria-label={`Line ${index + 1} amount`} inputMode="numeric" value={line.amount ?? ""} onChange={(event) => updateLine(index, "amount", nullableNumber(event.target.value))} /></td>
                    <td><select aria-label={`Line ${index + 1} tax code`} value={line.taxCode ?? ""} onChange={(event) => updateLine(index, "taxCode", event.target.value || null)}><option value="T10">10%</option><option value="T08">8%</option><option value="">—</option></select></td>
                    <td><button type="button" className="icon-button" aria-label={`Remove line ${index + 1}`} onClick={() => update("lines", draft.lines.filter((_, lineIndex) => lineIndex !== index))}><Trash2 size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" className="text-button" onClick={() => update("lines", [...draft.lines, blankLine])}><Plus size={14} /> Add line</button>
        </fieldset>

        <fieldset className="form-section totals-section">
          <legend>Invoice totals</legend>
          <div className="totals-grid">
            <label><span>Subtotal</span><span className="money-input"><i>¥</i><input inputMode="numeric" value={draft.subtotal ?? ""} onChange={(event) => update("subtotal", nullableNumber(event.target.value))} /></span></label>
            <label><span>Tax</span><span className="money-input"><i>¥</i><input inputMode="numeric" value={draft.taxAmount ?? ""} onChange={(event) => update("taxAmount", nullableNumber(event.target.value))} /></span></label>
            <label className="total-emphasis"><span>Total</span><span className="money-input"><i>¥</i><input inputMode="numeric" value={draft.totalAmount ?? ""} onChange={(event) => update("totalAmount", nullableNumber(event.target.value))} /></span></label>
          </div>
          <p className="calculated-note">Current extracted total: <strong>¥{money.format(draft.totalAmount ?? 0)}</strong></p>
        </fieldset>
        {document.problem && <div className="notice notice--danger"><AlertCircle size={16} /><div><strong>{document.problem.code}</strong><p>{document.problem.message}</p></div></div>}
        {document.registration && <div className="registered-card"><Check size={17} /><div><strong>Registered in accounting</strong><span>ID {document.registration.accountingId}</span></div></div>}
      </div>
      <footer className="editor-actions">
        <button className="button button--quiet" type="button" onClick={() => void onRetry()} disabled={Boolean(busyAction) || document.status === "REGISTERED"}><RefreshCw size={15} /> Retry AI</button>
        <button className="button button--secondary" type="button" onClick={() => void onSave(draft)} disabled={Boolean(busyAction) || document.status === "REGISTERED"}><Save size={15} /> {busyAction === "save" ? "Saving…" : "Save"}</button>
        {document.reviewApproved ? (
          <button className="button button--primary" type="button" onClick={() => void onRegister()} disabled={!canRegister || Boolean(busyAction)}><Send size={15} /> {busyAction === "register" ? "Registering…" : document.status === "REGISTERED" ? "Registered" : "Register invoice"}</button>
        ) : (
          <button className="button button--primary" type="button" onClick={() => void onApprove()} disabled={!canApprove || Boolean(busyAction)}><Check size={15} /> {busyAction === "approve" ? "Approving…" : "Approve review"}</button>
        )}
      </footer>
    </section>
  );
}

import { FileText, Search } from "lucide-react";
import type { DocumentView } from "../../../shared/transport";
import type { InvoiceStatus } from "../../../shared/domain/types";
import { StatusBadge } from "./StatusBadge";

export type QueueFilter = "ALL" | "ACTION" | InvoiceStatus;

interface Props {
  documents: readonly DocumentView[];
  selectedId: string | null;
  filter: QueueFilter;
  search: string;
  onFilter: (value: QueueFilter) => void;
  onSearch: (value: string) => void;
  onSelect: (id: string) => void;
}

const money = new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 });

export function InvoiceQueue({ documents, selectedId, filter, search, onFilter, onSearch, onSelect }: Props) {
  const actionStatuses: InvoiceStatus[] = ["NEEDS_REVIEW", "INVALID", "DUPLICATE", "REGISTRATION_FAILED"];
  const visible = documents.filter((document) => {
    const matchesFilter = filter === "ALL" || (filter === "ACTION" ? actionStatuses.includes(document.status) : document.status === filter);
    const query = search.trim().toLocaleLowerCase();
    const haystack = `${document.filename} ${document.invoice?.partnerName ?? ""} ${document.invoice?.invoiceNumber ?? ""}`.toLocaleLowerCase();
    return matchesFilter && (query === "" || haystack.includes(query));
  });
  const actionCount = documents.filter((document) => actionStatuses.includes(document.status)).length;

  return (
    <aside className="queue panel" aria-label="Invoice queue">
      <div className="panel-heading"><h2>Invoice queue <span>{documents.length}</span></h2></div>
      <div className="queue-tools">
        <label className="search-field">
          <Search size={15} aria-hidden="true" />
          <input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Search invoices" aria-label="Search invoices" />
        </label>
        <div className="segmented" aria-label="Queue filter">
          <button className={filter === "ALL" ? "is-active" : ""} onClick={() => onFilter("ALL")} type="button">All</button>
          <button className={filter === "ACTION" ? "is-active" : ""} onClick={() => onFilter("ACTION")} type="button">Action {actionCount}</button>
          <button className={filter === "READY" ? "is-active" : ""} onClick={() => onFilter("READY")} type="button">Ready</button>
        </div>
      </div>
      <div className="queue-list">
        {visible.map((document) => (
          <button
            type="button"
            className={`queue-row${selectedId === document.id ? " is-selected" : ""}`}
            key={document.id}
            onClick={() => onSelect(document.id)}
          >
            <span className="queue-row__icon"><FileText size={16} /></span>
            <span className="queue-row__body">
              <span className="queue-row__top"><strong>{document.invoice?.partnerName ?? document.filename}</strong><StatusBadge status={document.status} compact /></span>
              <span className="queue-row__meta">{document.invoice?.invoiceNumber ?? "Extraction pending"}<span>{document.invoice?.totalAmount === null || document.invoice?.totalAmount === undefined ? "—" : money.format(document.invoice.totalAmount)}</span></span>
            </span>
          </button>
        ))}
        {visible.length === 0 && <div className="queue-empty">No invoices match this view.</div>}
      </div>
    </aside>
  );
}

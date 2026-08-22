import { AlertTriangle, Check, CircleDashed, Copy, LoaderCircle, ShieldAlert } from "lucide-react";
import type { InvoiceStatus } from "../../../shared/domain/types";

const labels: Record<InvoiceStatus, string> = {
  PENDING: "Queued",
  PROCESSING: "Extracting",
  READY: "Ready",
  NEEDS_REVIEW: "Review",
  INVALID: "Blocked",
  DUPLICATE: "Duplicate",
  REGISTERED: "Registered",
  REGISTRATION_FAILED: "Failed",
};

export function StatusBadge({ status, compact = false }: { status: InvoiceStatus; compact?: boolean }) {
  const Icon = status === "PROCESSING" ? LoaderCircle
    : status === "READY" || status === "REGISTERED" ? Check
      : status === "DUPLICATE" ? Copy
        : status === "PENDING" ? CircleDashed
          : status === "NEEDS_REVIEW" ? AlertTriangle
            : ShieldAlert;
  return (
    <span className={`status status--${status.toLowerCase()}${compact ? " status--compact" : ""}`}>
      <Icon size={13} aria-hidden="true" />
      {labels[status]}
    </span>
  );
}

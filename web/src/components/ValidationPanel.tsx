import { AlertCircle, CheckCircle2, Copy, PenLine, ShieldCheck } from "lucide-react";
import type { DocumentView } from "../../../shared/transport";

export function ValidationPanel({ document }: { document: DocumentView }) {
  const errors = document.validation?.errors ?? [];
  const validationWarnings = document.validation?.warnings ?? [];
  const hasNothing = errors.length === 0 && validationWarnings.length === 0 && document.warnings.length === 0 && document.handwrittenAnnotations.length === 0 && !document.duplicateReason;
  return (
    <div className="validation-stack">
      {document.duplicateReason && (
        <div className="notice notice--danger"><Copy size={16} /><div><strong>Possible duplicate</strong><p>{document.duplicateReason}</p></div></div>
      )}
      {document.handwrittenAnnotations.map((annotation, index) => (
        <div className="notice notice--amber" key={`${annotation.text}-${index}`}><PenLine size={16} /><div><strong>Handwritten note</strong><p>{annotation.text} — {annotation.interpretation}</p></div></div>
      ))}
      {errors.map((issue) => (
        <div className="notice notice--danger" key={`${issue.path}-${issue.code}`}><AlertCircle size={16} /><div><strong>{issue.path}</strong><p>{issue.message}</p></div></div>
      ))}
      {[...validationWarnings, ...document.warnings.map((message, index) => ({ path: `Review note ${index + 1}`, message }))].map((issue) => (
        <div className="notice notice--amber" key={`${issue.path}-${issue.message}`}><AlertCircle size={16} /><div><strong>{issue.path}</strong><p>{issue.message}</p></div></div>
      ))}
      {hasNothing && (
        <div className="notice notice--success"><ShieldCheck size={16} /><div><strong>Deterministic checks passed</strong><p>Required fields, line arithmetic, tax, totals, and partner mapping are consistent.</p></div></div>
      )}
      {document.reviewApproved && <div className="review-stamp"><CheckCircle2 size={15} /> Human review approved</div>}
    </div>
  );
}

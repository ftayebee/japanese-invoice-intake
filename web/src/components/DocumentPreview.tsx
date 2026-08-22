import { ExternalLink, FileText, ScanText } from "lucide-react";
import type { DocumentView } from "../../../shared/transport";

export function DocumentPreview({ document }: { document: DocumentView | null }) {
  if (!document) {
    return <section className="preview panel empty-pane"><FileText size={24} /><p>Select an invoice to inspect its source.</p></section>;
  }
  return (
    <section className="preview panel">
      <div className="panel-heading panel-heading--preview">
        <div><h2 title={document.filename}>Source · {document.filename}</h2></div>
        <div className="preview-meta">
          <span><ScanText size={13} /> {document.processing.strategy?.replaceAll("-", " ") ?? "queued"}</span>
          {document.processing.pageCount && <span>{document.processing.pageCount} page{document.processing.pageCount > 1 ? "s" : ""}</span>}
          <a href={document.fileUrl} target="_blank" rel="noreferrer" aria-label="Open source in new tab"><ExternalLink size={15} /></a>
        </div>
      </div>
      <div className="document-stage">
        {document.mimeType === "application/pdf"
          ? <iframe key={document.fileUrl} src={`${document.fileUrl}#toolbar=0&navpanes=0`} title={`Source document ${document.filename}`} />
          : <img src={document.fileUrl} alt={`Source invoice ${document.filename}`} />}
      </div>
    </section>
  );
}

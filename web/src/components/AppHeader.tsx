import { FileStack, HeartPulse, RotateCcw, Upload } from "lucide-react";
import type { AppHealth } from "../../../shared/transport";

interface Props {
  health: AppHealth | null;
  busy: boolean;
  onUpload: (files: FileList) => void;
  onLoadSamples: () => void;
  onClear: () => void;
}

export function AppHeader({ health, busy, onUpload, onLoadSamples, onClear }: Props) {
  return (
    <header className="app-header">
      <div className="brand">
        <span className="brand__mark"><FileStack size={17} /></span>
        <span>Invoice Intake</span>
        <span className="brand__env">REVIEW DESK</span>
      </div>
      <div className="header-actions">
        <div className="health" title={`Model: ${health?.model ?? "checking"}`}>
          <HeartPulse size={14} />
          <span className={health?.accountingApi === "available" ? "health__dot" : "health__dot health__dot--down"} />
          Accounting {health?.accountingApi === "available" ? "online" : "offline"}
          <span className="health__divider" />
          AI {health?.llm === "configured" ? "ready" : "not configured"}
        </div>
        <button className="button button--quiet header-hide-mobile" type="button" onClick={onClear} disabled={busy}>
          <RotateCcw size={15} /> Reset
        </button>
        <button className="button button--secondary header-hide-mobile" type="button" onClick={onLoadSamples} disabled={busy}>
          Load samples
        </button>
        <label className={`button button--primary${busy ? " is-disabled" : ""}`}>
          <Upload size={15} /> Upload
          <input
            type="file"
            accept="application/pdf,image/jpeg"
            multiple
            disabled={busy}
            onChange={(event) => event.target.files && onUpload(event.target.files)}
          />
        </label>
      </div>
    </header>
  );
}

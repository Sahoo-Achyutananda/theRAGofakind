import { useState } from "react";

// One pipeline step shown above the answer, e.g. "✓ Retrieved top 10 · 24 ms".
// Click it to expand and see what that step produced (children).
export default function StepRow({ status, label, doneLabel, ms, children }) {
  const [open, setOpen] = useState(false);
  const done = status === "done";

  return (
    <div className="step">
      <button className="step-row" disabled={!done} onClick={() => setOpen(!open)}>
        <span className={`step-dot ${status}`} />
        <span>{done ? doneLabel : label}</span>
        {done && ms != null && <span className="muted"> · {formatMs(ms)}</span>}
        {done && <span className="step-caret">{open ? "▾" : "▸"}</span>}
      </button>
      {open && done && <div className="step-body">{children}</div>}
    </div>
  );
}

export function formatMs(ms) {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

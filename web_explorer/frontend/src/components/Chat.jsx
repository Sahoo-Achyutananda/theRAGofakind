import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import * as api from "../api.js";
import ChunkCard from "./ChunkCard.jsx";
import StepRow, { formatMs } from "./StepRow.jsx";

const EXAMPLES = [
  "Can the State make special laws only for women?",
  "Does an accused person have the right to remain silent?",
  "What does Article 31 say?",
];

export default function Chat({ messages, setMessages }) {
  const [input, setInput] = useState("");
  const [compare, setCompare] = useState(false); // also answer from the baseline top 3?
  const [hybrid, setHybrid] = useState(false);   // re-rank the hybrid (BM25 + dense) top 10 instead of dense
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef(null);

  // braces matter: an effect may only return a cleanup function, and some browsers
  // make scrollIntoView() return a Promise, so don't return its result
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // update one assistant message in place
  const patch = (id, changes) =>
    setMessages((ms) => ms.map((m) => (m.id === id ? { ...m, ...changes } : m)));

  async function ask(query) {
    if (!query.trim() || busy) return;
    const id = Date.now();
    setInput("");
    setBusy(true);
    setMessages((ms) => [
      ...ms,
      { id: `${id}-user`, role: "user", text: query },
      { id, role: "assistant", query, compare, hybrid, stage: "retrieve" },
    ]);

    try {
      // step 1: bi-encoder top 10 (always - it's the baseline)
      const retrieved = await api.retrieve(query);
      const denseIds = retrieved.results.map((c) => c.chunk_id);
      patch(id, { retrieved, stage: hybrid ? "hybrid" : "rerank" });

      // step 1b (hybrid on): BM25 + dense fused top 10
      let poolIds = denseIds;
      if (hybrid) {
        const hybridRes = await api.retrieveHybrid(query);
        poolIds = hybridRes.results.map((c) => c.chunk_id);
        patch(id, { hybridRes, stage: "rerank" });
      }

      // step 2: cross-encoder re-ranks the pool (dense top 10, or hybrid top 10)
      const reranked = await api.rerank(query, poolIds);
      patch(id, { reranked, stage: "generate" });

      // step 3: answer from the re-ranked top 3 (and optionally the dense baseline top 3)
      const answer = await api.generate(query, reranked.top);
      patch(id, { answer });
      if (compare) {
        const baseline = await api.generate(query, denseIds.slice(0, 3));
        patch(id, { baseline });
      }
      patch(id, { stage: "done" });
    } catch (e) {
      patch(id, { stage: "error", error: e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="chat">
      <div className="messages">
        {messages.length === 0 && (
          <div className="empty">
            <h1>Ask about the Constitution of India</h1>
            <p className="muted">Answers use only the retrieved articles. Click a step to see its chunks.</p>
            <div className="examples">
              {EXAMPLES.map((q) => (
                <button key={q} onClick={() => ask(q)}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="msg user">
              <div className="bubble">{m.text}</div>
            </div>
          ) : (
            <AssistantMessage key={m.id} m={m} />
          )
        )}
        <div ref={bottomRef} />
      </div>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
      >
        <div className="composer-box">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a question…"
            disabled={busy}
          />
          <button
            type="button"
            className={`toggle ${hybrid ? "on" : ""}`}
            aria-pressed={hybrid}
            onClick={() => setHybrid(!hybrid)}
            title="Hybrid search: BM25 keywords + dense embeddings, fused with RRF"
          >
            <span className="toggle-track">
              <span className="toggle-knob" />
            </span>
            Hybrid
          </button>
          <button type="submit" className="send" disabled={busy || !input.trim()}>
            {busy ? "…" : "Send"}
          </button>
        </div>
        <label className="compare">
          <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
          Also answer from the baseline top 3 (one extra LLM call)
        </label>
      </form>
    </main>
  );
}

// which result each step stores on the message
const STEP_KEY = { retrieve: "retrieved", hybrid: "hybridRes", rerank: "reranked", generate: "answer" };

// status of a step given the message's current stage
function stepStatus(m, step) {
  const order = ["retrieve", ...(m.hybrid ? ["hybrid"] : []), "rerank", "generate", "done"];
  if (m.stage === "error") {
    if (m[STEP_KEY[step]]) return "done";
    const failed = order.find((s) => s !== "done" && !m[STEP_KEY[s]]); // first step without a result
    return step === failed ? "error" : "pending";
  }
  const cur = order.indexOf(m.stage);
  const me = order.indexOf(step);
  return me < cur ? "done" : me === cur ? "running" : "pending";
}

function AssistantMessage({ m }) {
  const top = m.reranked?.top || [];
  const poolName = m.hybrid ? "hybrid" : "bi";
  const denseTop10 = new Set(m.retrieved?.results.map((c) => c.chunk_id) || []);
  const newInHybrid = m.hybridRes?.results.filter((c) => !denseTop10.has(c.chunk_id)) || [];

  return (
    <div className="msg assistant">
      <div className="steps">
        <StepRow
          status={stepStatus(m, "retrieve")}
          label="Retrieving…"
          doneLabel="Retrieved top 10 (bi-encoder)"
          ms={m.retrieved?.ms}
        >
          {m.retrieved?.results.map((c) => (
            <ChunkCard
              key={c.chunk_id}
              chunk={c}
              badges={[`#${c.rank}`, `cos ${c.score.toFixed(3)}`]}
              highlight={c.rank <= 3}
            />
          ))}
          <p className="muted small">Highlighted = baseline top 3 (what Pipeline 1 sends to the LLM).</p>
        </StepRow>

        {m.hybrid && (
          <StepRow
            status={stepStatus(m, "hybrid")}
            label="Hybrid retrieval…"
            doneLabel={`Hybrid top 10 (BM25 + dense) · ${newInHybrid.length} new vs dense`}
            ms={m.hybridRes?.ms}
          >
            <p className="muted small">
              Ranks are fused with RRF from the dense and BM25 top 50. Highlighted = not in the dense
              top 10. "–" = outside that list's top 50.
            </p>
            {m.hybridRes?.results.map((c) => (
              <ChunkCard
                key={c.chunk_id}
                chunk={c}
                badges={[
                  `#${c.rank}`,
                  `dense ${c.dense_rank ? "#" + c.dense_rank : "–"}`,
                  `bm25 ${c.bm25_rank ? "#" + c.bm25_rank : "–"}`,
                ]}
                highlight={!denseTop10.has(c.chunk_id)}
              />
            ))}
          </StepRow>
        )}

        <StepRow
          status={stepStatus(m, "rerank")}
          label="Re-ranking…"
          doneLabel={`Re-ranked ${m.hybrid ? "hybrid" : "dense"} top 10 → top 3 (cross-encoder)`}
          ms={m.reranked?.ms}
        >
          <RankTable results={m.reranked?.results || []} poolName={poolName} />
          {m.reranked?.results.slice(0, 3).map((c) => (
            <ChunkCard
              key={c.chunk_id}
              chunk={c}
              badges={[`${poolName} #${c.bi_rank} → ce #${c.ce_rank}`, `ce ${c.ce_score.toFixed(2)}`]}
              highlight
            />
          ))}
        </StepRow>

        <StepRow
          status={stepStatus(m, "generate")}
          label="Generating…"
          doneLabel={`Generated answer from ${top.join(", ")}`}
          ms={m.answer?.ms}
        >
          <p className="muted small">
            Model: {m.answer?.model}. The prompt contained only these chunks: {top.join(", ")}.
          </p>
        </StepRow>
      </div>

      {m.stage === "error" && <div className="error">Error: {m.error}</div>}

      {m.answer && (
        <div className="answer">
          {m.compare && (
            <div className="answer-label">
              {m.hybrid ? "Hybrid + re-ranked" : "Re-ranked (Pipeline 2)"}
            </div>
          )}
          <ReactMarkdown>{m.answer.answer}</ReactMarkdown>
        </div>
      )}

      {m.baseline && (
        <div className="answer baseline">
          <div className="answer-label">
            Baseline (Pipeline 1) · {formatMs(m.baseline.ms)}
          </div>
          <ReactMarkdown>{m.baseline.answer}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}

// before → after ranks for all 10 candidates
function RankTable({ results, poolName }) {
  return (
    <table className="ranks">
      <thead>
        <tr>
          <th>chunk</th>
          <th>{poolName} rank</th>
          <th>ce rank</th>
          <th>shift</th>
          <th>ce score</th>
        </tr>
      </thead>
      <tbody>
        {results.map((c) => {
          const shift = c.bi_rank - c.ce_rank;
          return (
            <tr key={c.chunk_id} className={c.ce_rank <= 3 ? "top" : ""}>
              <td>{c.chunk_id}</td>
              <td>{c.bi_rank}</td>
              <td>{c.ce_rank}</td>
              <td className={shift > 0 ? "up" : shift < 0 ? "down" : ""}>
                {shift > 0 ? `▲${shift}` : shift < 0 ? `▼${-shift}` : "–"}
              </td>
              <td>{c.ce_score.toFixed(2)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

# theRAGofakind

Retrieval-augmented question answering over the **articles of the Constitution of India**,
comparing a **bi-encoder baseline** with **cross-encoder re-ranking** (RAG assignment: Baseline vs. Re-Ranking).

Everything is in one notebook: [`rag.ipynb`](rag.ipynb).

## Pipelines

```
                       ┌─ Pipeline 1 (baseline) ─ top 3 ──────────────────────────► LLM → Answer 1
query → bi-encoder ────┤
        top 10         └─ Pipeline 2 ─ cross-encoder re-ranks all 10 → top 3 ──────► LLM → Answer 2
```

| Component | Choice |
|---|---|
| Document | Constitution of India (as on 1 May 2026), **articles only** (PDF pages 33–283), footnotes removed |
| Chunking | Structure-aware: whole article if ≤ 1000 chars, else split at numbered clauses, else line windows; every chunk prefixed with `Article N — title` (1,035 chunks) |
| Bi-encoder | `sentence-transformers/all-MiniLM-L6-v2`, cosine similarity (normalised dot product) |
| Cross-encoder | `cross-encoder/ms-marco-MiniLM-L-6-v2` |
| LLM | Gemini (`gemini-3.5-flash`), `temperature=0`, identical prompt for both pipelines |

## How to run

1. Python 3.11. Install: `pip install pdfplumber sentence-transformers google-genai python-dotenv`
2. Create a `.env` file in the project folder with your key: `GEMINI_API_KEY=...` (git ignores `.env`)
3. Open `rag.ipynb` and run all cells. The first run extracts the PDF (~1–2 min) and caches the text in `data/articles_text.txt`.

The failure-mode cells make about 90 Gemini calls; set `RUN_LLM = False` to check retrieval only.

## Repository layout

| Path | Contents |
|---|---|
| `rag.ipynb` | Extraction → chunking → embeddings → both pipelines → failure analysis → latency |
| `data/` | Source PDF, cached text, `chunks.json`, `chunk_embs.npy` |
| `failure_modes/queries/` | Test queries per failure type (keyword traps, synonyms, exceptions, negation, document-specific, out-of-corpus) with expected articles |
| `failure_modes/results/` | Rank shifts, both answers and latencies per query; `selected_cases.json` holds the cases discussed in the report |
| `web_explorer/` | Optional FastAPI + React app to browse chunks and run the pipelines interactively (see its README) |

## Latency (CPU, 52 queries × 3 runs after warm-up)

| Stage | Mean | Median | p95 |
|---|---|---|---|
| Bi-encoder retrieval (top 10 of 1,035) | 21.3 ms | 21.0 ms | 24.3 ms |
| Cross-encoder re-ranking (10 pairs) | 477.0 ms | 508.9 ms | 568.0 ms |
| LLM generation (per call) | 4.4 s | 3.7 s | 8.5 s |

## Known limitations

- Footnotes (amendment history) are excluded, so "when was Article X added?" can't be answered.
- Schedules and appendices are excluded (e.g. the 2019 declaration under Article 370(3) in Appendix III).
- Some long clauses are split at arbitrary line breaks by the window fallback (e.g. chunks `359_2`, `191_1`).
- Cross-references ("the said clause", "except articles 20 and 21") point outside a chunk and aren't resolved.

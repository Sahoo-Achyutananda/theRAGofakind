# theRAGofakind

Retrieval-augmented question answering over the **articles of the Constitution of India**, built to compare two
retrieval pipelines on the same chunked corpus:

- **Pipeline 1 (baseline):** a bi-encoder retrieves the top 10 chunks and the top 3 go to the LLM.
- **Pipeline 2 (re-ranking):** the same 10 candidates are re-scored by a cross-encoder and its top 3 go to the LLM.

Both pipelines use the same prompt and model, so any difference in the answers comes from which chunks were
retrieved. The project stress-tests both pipelines with 52 failure-mode queries (keyword traps, synonyms,
exceptions, negation, document-specific questions and out-of-corpus questions), measures rank shifts, retrieval
metrics and latency, and compares the two answers for each query.

- **Notebook (all code):** [`rag.ipynb`](rag.ipynb)
- **Report:** [`report/report.pdf`](report/report.pdf), with a separate [results appendix](report/results_appendix.pdf)
- **Dataset:** [Constitution of India, Legislative Department](https://www.legislative.gov.in/constitution-of-india)
  (edition as on 1 May 2026, stored in `data/`)

## How it works

```
                       ┌─ Pipeline 1 (baseline) ─ top 3 ──────────────────────────► LLM → Answer 1
query → bi-encoder ────┤
        top 10         └─ Pipeline 2 ─ cross-encoder re-ranks all 10 → top 3 ──────► LLM → Answer 2
```

| Component | Choice |
|---|---|
| Document | Constitution of India, **articles only** (PDF pages 33–283); schedules, appendices and footnotes excluded |
| Text extraction | `pdfplumber`: pages are cropped above the drawn footnote separator line, and small superscript footnote markers are filtered out by font size |
| Chunking | Structure-aware: a whole article if ≤ 1,000 characters, otherwise split at numbered clauses, otherwise into line windows; every chunk is prefixed with `Article N — title` (1,035 chunks from 500 articles) |
| Bi-encoder | `sentence-transformers/all-MiniLM-L6-v2`, cosine similarity on normalised embeddings |
| Cross-encoder | `cross-encoder/ms-marco-MiniLM-L-6-v2` |
| LLM | Gemini (`gemini-3.5-flash`), `temperature=0`; the prompt restricts answers to the retrieved chunks |

## Key results

Retrieval metrics over the 48 failure-mode queries that have an expected article (article-level relevance; 6 of
these queries were added after a search for rescue examples, which favours re-ranking):

| Metric | Baseline | Re-ranked |
|---|---|---|
| Hit@3 | 0.69 | 0.81 |
| Precision@3 | 0.35 | 0.42 |
| MRR | 0.67 | 0.71 |
| nDCG@10 | 0.69 | 0.73 |

- In 8 rescue cases the answering clause sat outside the baseline top 3 and the cross-encoder promoted it. In 5 of
  them the re-ranked answer was correct where the baseline answer refused (4) or described the wrong article (1).
- 8 queries never had a relevant chunk in the bi-encoder top 10, so re-ranking could not help them; a top-20
  candidate pool would contain 6 of those, and a top-50 pool all 8.

Latency on a laptop CPU (52 queries × 3 runs after warm-up):

| Stage | Mean | Median | p95 |
|---|---|---|---|
| Bi-encoder retrieval (top 10 of 1,035) | 23.0 ms | 21.6 ms | 31.4 ms |
| Cross-encoder re-ranking (10 pairs) | 482.0 ms | 506.1 ms | 595.8 ms |
| LLM generation (per call) | 5.1 s | 4.4 s | 9.9 s |

## Run the notebook

1. **Python 3.11.** Install the dependencies:
   ```
   pip install pdfplumber sentence-transformers google-genai python-dotenv matplotlib
   ```
2. **API key.** Create a `.env` file in the project folder containing `GEMINI_API_KEY=your-key`.
   `.env` is in `.gitignore`, so the key never gets committed.
3. **Run all cells** in `rag.ipynb`.
   - The first run extracts the PDF (about 1–2 minutes) and caches the text in `data/articles_text.txt`.
   - The two models download from Hugging Face on first use (about 90 MB each).
   - Gemini calls: with `RERUN_FAILURE_MODES = False` (the default), the failure-mode cells reuse the saved answers
     in `failure_modes/results/` and only call Gemini for queries that are new. Set it to `True` to regenerate all
     answers (about 104 calls plus a 5-second pause per query). The selected-cases section always makes 16 calls.

## Run the web explorer

An optional web app for browsing the chunks and trying the pipeline on your own questions:

- **Chat tab:** ask a question and watch it go through retrieval (bi-encoder top 10), re-ranking (cross-encoder
  top 3) and generation. Click any step to see its chunks and the rank shifts; tick *"Also answer from the baseline
  top 3"* to see Answer 1 and Answer 2 side by side.
- **Explore chunks tab:** type an article number (e.g. `21A`) or words from a title to see how that article was chunked.

```
web_explorer/frontend   React + Vite (browser)   ──/api──►   web_explorer/backend   FastAPI (Python)
                                                              loads data/chunks.json + both models, calls Gemini
```

**Prerequisites:** Python 3.11, Node.js 18 or newer, the `.env` file from above, and `data/chunks.json` +
`data/chunk_embs.npy` (both are in the repo; the notebook regenerates them). The Gemini key is only read by the
backend and never reaches the browser.

**Terminal 1: backend**
```
cd web_explorer/backend
pip install -r requirements.txt
python -m uvicorn app:app --port 8000
```
Wait for `Application startup complete`. To check it, open http://127.0.0.1:8000/docs, which lists the API
endpoints and lets you try them.

**Terminal 2: frontend**
```
cd web_explorer/frontend
npm install      # first time only
npm run dev
```
Open http://localhost:5173.

On Windows, if `python` points to a different installation than the one with the packages, use `py -3.11 -m ...`;
if PowerShell blocks `npm`, run `npm.cmd run dev` instead. More detail is in [`web_explorer/README.md`](web_explorer/README.md).

## Repository layout

| Path | Contents |
|---|---|
| `rag.ipynb` | Extraction → chunking → embeddings → both pipelines → failure analysis → latency → retrieval metrics |
| `data/` | Source PDF, cached article text, `chunks.json`, `chunk_embs.npy` |
| `failure_modes/queries/` | The 52 test queries, one file per failure category, each with expected article(s); queries with `relevant_chunks` are the clause-level selected cases |
| `failure_modes/results/` | Per query: rank shifts, verdict, both answers and latencies; `selected_cases.json` (clause-level rescue cases) and `metrics_per_query.csv` |
| `figures/` | Latency charts and the bi-encoder vs cross-encoder score comparison used in the report |
| `report/` | `report.pdf` / `report.tex`, and the results appendix as PDF, LaTeX and Markdown |
| `web_explorer/` | FastAPI + React app for exploring chunks and running the pipelines interactively |

The `f-hybrid` branch adds an experiment with hybrid retrieval (BM25 + dense, fused with Reciprocal Rank Fusion) in
`hybrid.ipynb`, plus a hybrid toggle in the web explorer.

## Known limitations

- Footnotes (amendment history) are excluded, so questions like "when was Article X added?" can't be answered.
- Schedules and appendices are excluded (e.g. the 2019 declaration under Article 370(3) is in Appendix III).
- Retrieval metrics use article-level relevance; clause-level relevance is only labelled for the 8 selected cases.

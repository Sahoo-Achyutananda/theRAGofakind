# Web explorer

A small web app on top of the notebook's RAG pipeline:

- **Chat**: ask a question → retrieve (bi-encoder top 10) → re-rank (cross-encoder top 3) → Gemini answer.
  Click any step to see its chunks and the rank shifts. Tick *"Also answer from the baseline top 3"*
  to see Answer 1 vs Answer 2 side by side.
- **Explore chunks**: type an article number (e.g. `21A`) or title words to see its chunks.

```
frontend/  React (Vite)   ──/api──►   backend/  FastAPI (Python)
           runs in browser            loads data/chunks.json + models, calls Gemini
```

The Gemini key stays in the project's `.env` and is only read by the backend.

## 1. Create the data (once)

In `rag.ipynb`, run the notebook down to (and including) the cells that save:

- `data/chunks.json`: right after chunking
- `data/chunk_embs.npy`: right after the embedding cell

If `chunk_embs.npy` is missing, the backend computes it on first start (~30 s).

## 2. Start the backend (terminal 1)

```powershell
py -3.11 -m pip install fastapi uvicorn
cd web_explorer\backend
py -3.11 -m uvicorn app:app --port 8000
```

Wait for `Application startup complete`. Loading the two models takes a few seconds.
Check it works: open http://127.0.0.1:8000/docs. This lists every API endpoint, and you can try them there.

## 3. Start the frontend (terminal 2)

```powershell
cd web_explorer\frontend
npm install        # first time only
npm run dev
```

Open http://localhost:5173.

## Files

| File | What it does |
|---|---|
| `backend/app.py` | API: `/api/articles`, `/api/retrieve`, `/api/rerank`, `/api/generate` (same prompt as the notebook) |
| `frontend/src/api.js` | `fetch` helpers for those endpoints |
| `frontend/src/App.jsx` | Top bar + the two tabs |
| `frontend/src/components/Chat.jsx` | Chat UI; runs the 3 steps one after another |
| `frontend/src/components/StepRow.jsx` | A clickable "✓ Retrieved top 10 · 24 ms" row |
| `frontend/src/components/ChunkCard.jsx` | Displays one chunk |
| `frontend/src/components/Explorer.jsx` | Article list + chunk viewer |
| `frontend/src/styles.css` | All styling (light + dark) |

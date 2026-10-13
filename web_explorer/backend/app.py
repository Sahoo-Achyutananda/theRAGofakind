"""
Backend for the RAG explorer.

It loads the chunks saved by the notebook (data/chunks.json + data/chunk_embs.npy),
and exposes the same steps as the notebook as small API endpoints:

    GET  /api/articles            list of all articles (for the explorer tab)
    GET  /api/articles/{number}   all chunks of one article
    POST /api/retrieve            Pipeline 1: bi-encoder top 10
    POST /api/retrieve_hybrid     BM25 + bi-encoder, fused with RRF (same as hybrid.ipynb)
    POST /api/rerank              Pipeline 2: cross-encoder re-ranks the given 10
    POST /api/generate            Gemini answer from the given chunks

Run from this folder:   py -3.11 -m uvicorn app:app --port 8000
"""
import json
import os
import re
import time
from collections import Counter
from pathlib import Path

import numpy as np
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from google import genai
from google.genai import types
from pydantic import BaseModel
from rank_bm25 import BM25Okapi
from sentence_transformers import CrossEncoder, SentenceTransformer

ROOT = Path(__file__).resolve().parents[2]          # the project folder
DATA = ROOT / "data"
load_dotenv(ROOT / ".env")                          # GEMINI_API_KEY lives here, never in the frontend

GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.5-flash")

# ---------- load data + models once, when the server starts ----------
chunks = json.loads((DATA / "chunks.json").read_text(encoding="utf-8"))
chunk_by_id = {c["chunk_id"]: c for c in chunks}

bi_encoder = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")
cross_encoder = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")

emb_path = DATA / "chunk_embs.npy"
if emb_path.exists() and np.load(emb_path).shape[0] == len(chunks):
    chunk_embs = np.load(emb_path)
else:                                               # notebook didn't save them: compute (~30 s)
    chunk_embs = bi_encoder.encode([c["text"] for c in chunks], batch_size=64,
                                   normalize_embeddings=True)
    np.save(emb_path, chunk_embs)

# BM25 keyword index - same tokenizer and settings as hybrid.ipynb
STOPWORDS = set("""a an the of and or to in on for by with is are be shall any
such as that this it its at from under which who whom what can does do not""".split())


def tokenize(text):
    return [t for t in re.findall(r"[a-z0-9]+", text.lower()) if t not in STOPWORDS]


bm25 = BM25Okapi([tokenize(c["text"]) for c in chunks], k1=1.5, b=0.75)

client = genai.Client()

# same prompt as the notebook, so answers are comparable
PROMPT_TEMPLATE = """You are answering questions about the Constitution of India.
Use ONLY the context below. If the context does not contain the answer, say
"The provided context does not answer this." Cite article numbers for every claim.

Context:
{context}

Question: {question}

Answer:"""

# article list in document order, with chunk counts
articles = {}
for c in chunks:
    a = articles.setdefault(c["article"], {"number": c["article"], "title": c["title"], "n_chunks": 0})
    a["n_chunks"] += 1

app = FastAPI(title="Constitution RAG explorer")


class QueryIn(BaseModel):
    query: str


class ChunksIn(BaseModel):
    query: str
    chunk_ids: list[str]


def ms_since(t0):
    return round((time.perf_counter() - t0) * 1000, 1)


# ---------- explorer ----------
@app.get("/api/articles")
def list_articles():
    return list(articles.values())


@app.get("/api/articles/{number}")
def get_article(number: str):
    number = number.strip().upper()
    if number not in articles:
        raise HTTPException(404, f"Article {number} not found")
    return {**articles[number], "chunks": [c for c in chunks if c["article"] == number]}


# ---------- pipeline steps ----------
@app.post("/api/retrieve")
def retrieve(body: QueryIn, k: int = 10):
    t0 = time.perf_counter()
    q = bi_encoder.encode(body.query, normalize_embeddings=True)
    scores = chunk_embs @ q                          # cosine similarity with every chunk
    top_idx = np.argsort(-scores)[:k]
    results = [{**chunks[i], "rank": r + 1, "score": float(scores[i])}
               for r, i in enumerate(top_idx)]
    return {"results": results, "ms": ms_since(t0)}


@app.post("/api/retrieve_hybrid")
def retrieve_hybrid(body: QueryIn, k: int = 10, pool: int = 50):
    t0 = time.perf_counter()
    q = bi_encoder.encode(body.query, normalize_embeddings=True)
    dense_rank = np.argsort(-(chunk_embs @ q))[:pool]                       # top 50 by meaning
    bm25_rank = np.argsort(-bm25.get_scores(tokenize(body.query)))[:pool]   # top 50 by keywords

    # Reciprocal Rank Fusion: each list votes 1 / (60 + rank)
    fused = Counter()
    for ranking in (dense_rank, bm25_rank):
        for rank, idx in enumerate(ranking, start=1):
            fused[idx] += 1 / (60 + rank)

    # where each chunk sat in the two input lists (None = outside the top 50)
    dense_pos = {int(i): r for r, i in enumerate(dense_rank, start=1)}
    bm25_pos = {int(i): r for r, i in enumerate(bm25_rank, start=1)}
    results = [{**chunks[i], "rank": r + 1, "score": float(s),
                "dense_rank": dense_pos.get(int(i)), "bm25_rank": bm25_pos.get(int(i))}
               for r, (i, s) in enumerate(fused.most_common(k))]
    return {"results": results, "ms": ms_since(t0)}


@app.post("/api/rerank")
def rerank(body: ChunksIn, k: int = 3):
    t0 = time.perf_counter()
    cands = [chunk_by_id[cid] for cid in body.chunk_ids]
    ce_scores = cross_encoder.predict([(body.query, c["text"]) for c in cands])
    ms = ms_since(t0)

    results = [{**c, "bi_rank": i + 1, "ce_score": float(s)}
               for i, (c, s) in enumerate(zip(cands, ce_scores))]
    results.sort(key=lambda c: c["ce_score"], reverse=True)
    for r, c in enumerate(results, 1):
        c["ce_rank"] = r
    return {"results": results, "top": [c["chunk_id"] for c in results[:k]], "ms": ms}


@app.post("/api/generate")
def generate(body: ChunksIn):
    context = "\n\n".join(f"[{cid}]\n{chunk_by_id[cid]['text']}" for cid in body.chunk_ids)
    prompt = PROMPT_TEMPLATE.format(context=context, question=body.query)

    t0 = time.perf_counter()
    for attempt in range(3):                         # flaky networks: retry a couple of times
        try:
            response = client.models.generate_content(
                model=GEMINI_MODEL,
                contents=prompt,
                config=types.GenerateContentConfig(temperature=0),
            )
            return {"answer": response.text, "ms": ms_since(t0), "model": GEMINI_MODEL}
        except Exception as e:
            last_error = e
            time.sleep(3 * (attempt + 1))
    raise HTTPException(502, f"Gemini call failed: {type(last_error).__name__}: {last_error}")

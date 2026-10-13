// All calls to the Python backend live here.
// Vite forwards /api/... to http://127.0.0.1:8000 (see vite.config.js).

async function request(path, body) {
  const res = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `${res.status} ${res.statusText}`);
  }
  return res.json();
}

export const getArticles = () => request("/api/articles");
export const getArticle = (number) => request(`/api/articles/${encodeURIComponent(number)}`);

// Pipeline 1: bi-encoder top 10
export const retrieve = (query) => request("/api/retrieve", { query });

// Pipeline 2: cross-encoder re-ranks the given chunks
export const rerank = (query, chunkIds) => request("/api/rerank", { query, chunk_ids: chunkIds });

// LLM answer using only the given chunks
export const generate = (query, chunkIds) => request("/api/generate", { query, chunk_ids: chunkIds });

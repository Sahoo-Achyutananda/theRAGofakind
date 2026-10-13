import { useEffect, useState } from "react";
import * as api from "../api.js";
import ChunkCard from "./ChunkCard.jsx";

// Browse chunks by article: type a number (e.g. 21A) or words from a title.
export default function Explorer() {
  const [articles, setArticles] = useState([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null); // { number, title, chunks: [...] }
  const [error, setError] = useState("");

  useEffect(() => {
    api.getArticles().then(setArticles).catch((e) => setError(e.message));
  }, []);

  async function open(number) {
    setError("");
    try {
      setSelected(await api.getArticle(number));
    } catch (e) {
      setError(e.message);
    }
  }

  const s = search.trim().toLowerCase();
  const filtered = articles.filter(
    (a) => !s || a.number.toLowerCase() === s || a.number.toLowerCase().startsWith(s) ||
           a.title.toLowerCase().includes(s)
  );

  return (
    <main className="explorer">
      <aside className="article-list">
        <input
          className="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && filtered[0] && open(filtered[0].number)}
          placeholder="Article number or title…"
        />
        <div className="muted small">{filtered.length} articles</div>
        <ul>
          {filtered.map((a) => (
            <li key={a.number}>
              <button
                className={selected?.number === a.number ? "active" : ""}
                onClick={() => open(a.number)}
              >
                <span className="art-num">{a.number}</span>
                <span className="art-title">{a.title}</span>
                <span className="muted small">{a.n_chunks}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="article-view">
        {error && <div className="error">{error}</div>}
        {!selected && !error && (
          <p className="muted">Pick an article on the left, or type its number and press Enter.</p>
        )}
        {selected && (
          <>
            <h2>
              Article {selected.number} — {selected.title}
            </h2>
            <p className="muted small">
              {selected.chunks.length} chunk{selected.chunks.length > 1 ? "s" : ""}
            </p>
            {selected.chunks.map((c) => (
              <ChunkCard key={c.chunk_id} chunk={c} badges={[`${c.text.length} chars`]} />
            ))}
          </>
        )}
      </section>
    </main>
  );
}

// One chunk: id + article title on top, the text below.
// `badges` is a list of small labels, e.g. ["bi #6", "ce #2"].
export default function ChunkCard({ chunk, badges = [], highlight = false }) {
  // the first line of every chunk is the "Article N — title" prefix; show the rest as the body
  const body = chunk.text.split("\n").slice(1).join("\n");

  return (
    <div className={`chunk ${highlight ? "chunk-highlight" : ""}`}>
      <div className="chunk-head">
        <span className="chunk-id">{chunk.chunk_id}</span>
        <span className="chunk-title">
          Art. {chunk.article} — {chunk.title}
        </span>
        {badges.map((b) => (
          <span key={b} className="badge">
            {b}
          </span>
        ))}
      </div>
      <pre className="chunk-text">{body}</pre>
    </div>
  );
}

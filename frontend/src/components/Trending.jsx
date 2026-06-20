// Trending searches section, populated from GET /trending.
export default function Trending({ items, onPick }) {
  return (
    <section className="trending">
      <h2>🔥 Trending</h2>
      {items.length === 0 ? (
        <p className="muted">No trending searches yet — submit a few searches.</p>
      ) : (
        <ol>
          {items.map((t) => (
            <li key={t.query}>
              <button className="link" onClick={() => onPick(t.query)}>{t.query}</button>
              <span className="score">{t.score}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// Suggestion dropdown. `activeIndex` is the keyboard-highlighted row.
export default function Suggestions({ items, activeIndex, onPick, loading, error }) {
  if (error) return <div className="dropdown error">⚠ {error}</div>;
  if (loading && items.length === 0) return <div className="dropdown muted">Loading…</div>;
  if (items.length === 0) return <div className="dropdown muted">No suggestions</div>;

  return (
    <ul className="dropdown" role="listbox">
      {items.map((s, i) => (
        <li
          key={s.query}
          role="option"
          aria-selected={i === activeIndex}
          className={i === activeIndex ? 'row active' : 'row'}
          onMouseDown={(e) => {
            e.preventDefault(); // keep focus in the input
            onPick(s.query);
          }}
        >
          <span className="q">{s.query}</span>
          <span className="meta">
            {typeof s.count === 'number' && <span className="count">{s.count.toLocaleString()}</span>}
            {typeof s.score === 'number' && <span className="score">score {s.score}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

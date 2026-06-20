import { useCallback, useEffect, useRef, useState } from 'react';
import { useDebounce } from './useDebounce.js';
import { fetchSuggestions, fetchTrending, submitSearch } from './api.js';
import Suggestions from './components/Suggestions.jsx';
import Trending from './components/Trending.jsx';

export default function App() {
  const [input, setInput] = useState('');
  const [mode, setMode] = useState('basic'); // basic | recency — demo the difference
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [response, setResponse] = useState(null); // dummy /search response
  const [trending, setTrending] = useState([]);

  const debounced = useDebounce(input, 200);
  const abortRef = useRef(null);

  // Fetch suggestions whenever the debounced prefix (or mode) changes.
  useEffect(() => {
    if (!debounced.trim()) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError(null);
    fetchSuggestions(debounced, mode, ctrl.signal)
      .then((data) => {
        setSuggestions(data.suggestions || []);
        setOpen(true);
        setActiveIndex(-1);
      })
      .catch((e) => { if (e.name !== 'AbortError') setError('Failed to load suggestions'); })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [debounced, mode]);

  const loadTrending = useCallback(() => {
    fetchTrending().then((d) => setTrending(d.trending || [])).catch(() => {});
  }, []);

  useEffect(() => {
    loadTrending();
    const id = setInterval(loadTrending, 5000); // refresh trending periodically
    return () => clearInterval(id);
  }, [loadTrending]);

  async function doSearch(query) {
    const q = (query ?? input).trim();
    if (!q) return;
    setInput(q);
    setOpen(false);
    setResponse({ state: 'loading' });
    try {
      const r = await submitSearch(q);
      setResponse({ state: 'ok', message: r.message, query: q });
      loadTrending();
    } catch {
      setResponse({ state: 'error' });
    }
  }

  // Keyboard navigation over the suggestion list.
  function onKeyDown(e) {
    if (!open || suggestions.length === 0) {
      if (e.key === 'Enter') doSearch();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0) doSearch(suggestions[activeIndex].query);
      else doSearch();
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className="page">
      <h1>Search Typeahead</h1>

      <div className="mode-toggle">
        <span>Ranking:</span>
        <button className={mode === 'basic' ? 'on' : ''} onClick={() => setMode('basic')}>
          Basic (popularity)
        </button>
        <button className={mode === 'recency' ? 'on' : ''} onClick={() => setMode('recency')}>
          Recency-aware
        </button>
      </div>

      <div className="search-wrap">
        <div className="search-row">
          <input
            className="search-input"
            type="text"
            value={input}
            placeholder="Search…"
            autoFocus
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => suggestions.length && setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 120)}
            aria-label="Search"
          />
          <button className="search-btn" onClick={() => doSearch()}>Search</button>
        </div>
        {open && (
          <Suggestions
            items={suggestions}
            activeIndex={activeIndex}
            loading={loading}
            error={error}
            onPick={(q) => doSearch(q)}
          />
        )}
      </div>

      {response && (
        <div className="response">
          {response.state === 'loading' && <span className="muted">Searching…</span>}
          {response.state === 'error' && <span className="error">Search failed</span>}
          {response.state === 'ok' && (
            <span>
              <strong>{response.message}</strong> for “{response.query}”
            </span>
          )}
        </div>
      )}

      <Trending items={trending} onPick={(q) => { setInput(q); doSearch(q); }} />
    </div>
  );
}

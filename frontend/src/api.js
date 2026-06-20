// Thin fetch wrapper. Paths are proxied to the backend by Vite (see vite.config.js),
// or set VITE_API_BASE to point at a deployed backend.
const BASE = import.meta.env.VITE_API_BASE || '';

async function getJSON(path, signal) {
  const res = await fetch(`${BASE}${path}`, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export function fetchSuggestions(prefix, mode, signal) {
  return getJSON(`/suggest?q=${encodeURIComponent(prefix)}&mode=${mode}`, signal);
}

export function fetchTrending(signal) {
  return getJSON('/trending?limit=10', signal);
}

export async function submitSearch(query) {
  const res = await fetch(`${BASE}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

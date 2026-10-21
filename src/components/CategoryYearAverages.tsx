import { useEffect, useState } from 'react';
import { getStatements } from '../api/financesApi';
import { categoryYearAverage } from './verifiedStatementData';
import { loadRelationalStatements } from './overviewData';
import type { LoadedStatement } from './verifiedStatementData';

const cache = new Map<string, { files: LoadedStatement[]; time: number }>();
const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export function CategoryYearAverages({ year, category, currentFiles }: { year: string; category: string; currentFiles: LoadedStatement[] }) {
  const [history, setHistory] = useState<Record<string, LoadedStatement[]>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      let listing;
      try { listing = await getStatements(controller.signal); }
      catch {
        if (!controller.signal.aborted) { setErrors(['statement index']); setLoading(false); }
        return;
      }
      const years = [...new Set(listing.map((statement) => statement.periodEnd.slice(0, 4)))].filter((value) => /^20\d{2}$/.test(value)).sort().reverse();
      for (const target of years) {
        if (target === year || controller.signal.aborted) continue;
        try {
          let files = cache.get(target);
          if (!files || Date.now() - files.time > 300000) {
            const loaded = await loadRelationalStatements(listing.filter((statement) => statement.periodEnd.slice(0, 4) === target), controller.signal);
            if (controller.signal.aborted) return;
            if (loaded.some((file) => file.error)) throw new Error('Incomplete year');
            files = { files: loaded, time: Date.now() };
            cache.set(target, files);
          }
          if (!controller.signal.aborted && files.files.length) setHistory((current) => ({ ...current, [target]: files.files }));
        } catch {
          if (!controller.signal.aborted) setErrors((current) => [...current, target]);
        }
      }
      if (!controller.signal.aborted) setLoading(false);
    }
    void load();
    return () => controller.abort();
  }, [year, attempt]);
  const all = { ...history, [year]: currentFiles };
  return <div className="category-year-averages">
    <h4>Monthly average by year</h4>
    <div className="category-year-average-row">{Object.keys(all).sort((a, b) => b.localeCompare(a)).map((value) => {
      const average = categoryYearAverage(all[value], value, category);
      return <div key={value}><strong>{value}</strong><span>{average.cents === null ? 'N/A' : currency.format(average.cents / 100)}</span><small>{average.months} complete months</small></div>;
    })}</div>
    {loading && <p role="status">Loading earlier years…</p>}
    {errors.length > 0 && <p role="alert">Unavailable years: {errors.join(', ')}. {!loading && <button onClick={() => { setErrors([]); setLoading(true); setAttempt((value) => value + 1); }}>Retry</button>}</p>}
  </div>;
}

import { useEffect, useState } from 'react';
import { getVerifiedStatementData, getVerifiedStatementFiles } from '../api/financesApi';
import { categoryYearAverage, record } from './verifiedStatementData';
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
      const latest = Math.max(new Date().getFullYear(), Number(year));
      // Search the same year range supported by the statement picker.
      for (let value = latest; value >= 2000; value--) {
        const target = String(value);
        if (target === year || controller.signal.aborted) continue;
        try {
          let files = cache.get(target);
          if (!files || Date.now() - files.time > 300000) {
            const listing = await getVerifiedStatementFiles(target, controller.signal);
            const loaded: LoadedStatement[] = [];
            let index = 0;
            await Promise.all(Array.from({ length: Math.min(4, listing.length) }, async () => {
              while (index < listing.length && !controller.signal.aborted) {
                const file = listing[index++];
                try {
                  const data = record(await getVerifiedStatementData(target, file.fileName, controller.signal));
                  if (!Object.keys(data).length) throw new Error('Invalid statement data');
                  loaded.push({ ...file, data });
                } catch {
                  loaded.push({ ...file, error: 'Unable to load statement' });
                }
              }
            }));
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

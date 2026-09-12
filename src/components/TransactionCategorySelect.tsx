import { useId, useRef, useState } from 'react';
import { setTransactionCategory } from '../api/financesApi';
import type { Category } from '../types/finance';

type Props = {
  transactionId: string;
  description: string;
  categoryId: unknown;
  categoryName: string;
  categories: Category[];
  onSaved: (transactionId: string, category: Category) => void;
};

export function TransactionCategorySelect({ transactionId, description, categoryId, categoryName, categories, onSaved }: Props) {
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);
  const [editing, setEditing] = useState(false);
  const selectId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const current = categories.find((category) => String(category.id) === String(categoryId))
    ?? categories.find((category) => category.name === categoryName);

  async function save(value: string) {
    const category = categories.find((candidate) => String(candidate.id) === value);
    if (!category || saving.current) return;
    saving.current = true;
    setStatus('saving');
    setError(null);
    try {
      await setTransactionCategory(transactionId, category.id);
      onSaved(transactionId, category);
      setStatus('saved');
      setEditing(false);
      buttonRef.current?.focus();
    } catch (caughtError) {
      setStatus('idle');
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to save category. Please try again.');
    } finally {
      saving.current = false;
    }
  }

  return (
    <div className="transaction-category-control">
      <button
        type="button"
        className="transaction-category-button"
        ref={buttonRef}
        aria-label={`Edit category for ${description || 'transaction'}: ${current?.name || categoryName || 'Uncategorized'}`}
        aria-expanded={editing}
        aria-controls={editing ? selectId : undefined}
        disabled={!transactionId || categories.length === 0 || status === 'saving'}
        onClick={() => setEditing((value) => !value)}
      >{current?.name || categoryName || 'Uncategorized'}</button>
      {editing && <select
        id={selectId}
        ref={(node) => node?.focus()}
        aria-label={`Category for ${description || 'transaction'} (${transactionId || 'ID unavailable'})`}
        value={current ? String(current.id) : ''}
        disabled={!transactionId || categories.length === 0 || status === 'saving'}
        onChange={(event) => void save(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setEditing(false);
            buttonRef.current?.focus();
          }
        }}
      >
        <option value="" disabled>{categoryName || 'Select category'}</option>
        {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
      </select>}
      {!transactionId && <small>Transaction ID unavailable</small>}
      {status !== 'idle' && <small role="status">{status === 'saving' ? 'Saving…' : 'Saved'}</small>}
      {error && <small className="category-save-error" role="alert">{error}</small>}
    </div>
  );
}

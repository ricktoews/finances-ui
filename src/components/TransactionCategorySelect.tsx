import { useContext, useId, useRef, useState } from 'react';
import { HighlightedCategoryContext } from './HighlightedCategoryContext';
import { resetTransactionCategory, setTransactionCategory } from '../api/financesApi';
import type { Category } from '../types/finance';

type Props = {
  transactionId: string;
  description: string;
  categoryId: unknown;
  categoryName: string;
  parentCategory?: unknown;
  numericId?: unknown;
  merchant?: unknown;
  categories: Category[];
  onSaved: (transactionId: string) => Promise<void>;
};

export function TransactionCategorySelect({ transactionId, description, categoryId, categoryName, parentCategory, numericId, merchant, categories, onSaved }: Props) {
  const highlightedCategory = useContext(HighlightedCategoryContext);
  const groupName = typeof parentCategory === 'string' && parentCategory.trim()
    ? parentCategory.trim() : categoryName.trim() || 'Uncategorized';
  const isHighlighted = highlightedCategory !== null && highlightedCategory === groupName;
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);
  const [editing, setEditing] = useState(false);
  const selectId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const current = categories.find((category) => String(category.id) === String(categoryId))
    ?? categories.find((category) => category.name === categoryName);

  const canReset = typeof numericId === 'number' && Number.isSafeInteger(numericId) && numericId > 0;

  async function save(value: string) {
    const category = categories.find((candidate) => String(candidate.id) === value);
    const reset = value === 'reset' && canReset;
    if ((!category && !reset) || saving.current) return;
    saving.current = true;
    setStatus('saving');
    setError(null);
    try {
      if (reset) await resetTransactionCategory(numericId as number);
      else await setTransactionCategory(transactionId, category!.id);
      try { await onSaved(transactionId); }
      catch { throw new Error('Category saved, but refreshed data could not be loaded. Reload the statement to see its current category and totals.'); }
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
    <div className="transaction-category-control" data-category-highlighted={isHighlighted || undefined}>
      {typeof merchant === 'string' && merchant && <small>Merchant: {merchant}</small>}
      {typeof parentCategory === 'string' && parentCategory && <small>Parent category: {parentCategory}</small>}
      {isHighlighted && <span className="category-highlight-label">Matching category</span>}
      <button
        type="button"
        className="transaction-category-button"
        ref={buttonRef}
        aria-label={`Edit category for ${description || 'transaction'}: ${categoryName || 'Uncategorized'}`}
        aria-expanded={editing}
        aria-controls={editing ? selectId : undefined}
        disabled={(!transactionId || categories.length === 0) && !canReset || status === 'saving'}
        onClick={() => setEditing((value) => !value)}
      >{categoryName || 'Uncategorized'}</button>
      {editing && <select
        id={selectId}
        ref={(node) => node?.focus()}
        aria-label={`Category for ${description || 'transaction'} (${transactionId || 'ID unavailable'})`}
        value={current ? String(current.id) : ''}
        disabled={(!transactionId || categories.length === 0) && !canReset || status === 'saving'}
        onChange={(event) => save(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setEditing(false);
            buttonRef.current?.focus();
          }
        }}
      >
        <option value="" disabled>{categoryName || 'Select category'}</option>
        {canReset && <option value="reset">Use merchant default</option>}
        {categories.map((category) => <option key={category.id} value={category.id} disabled={!transactionId}>{category.name}</option>)}
      </select>}
      {!transactionId && <small>Transaction ID unavailable</small>}
      {status !== 'idle' && <small role="status">{status === 'saving' ? 'Saving…' : 'Saved'}</small>}
      {error && <small className="category-save-error" role="alert">{error}</small>}
    </div>
  );
}

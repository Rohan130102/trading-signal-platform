'use client';

import { clsx } from 'clsx';
import { Check, ChevronDown, Layers, Search } from 'lucide-react';
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react';

export interface PickerInstrument {
  symbol: string;
  displayName: string;
  exchange?: string | null;
  archived?: boolean;
}

/**
 * A searchable instrument selector, in place of a plain dropdown. Keyboard: arrows move, Enter chooses,
 * Escape closes. On a phone it opens as a sheet from the bottom, above the browser's own controls.
 */
export function InstrumentPicker({
  value,
  onChange,
  instruments,
}: {
  value: string;
  onChange: (symbol: string) => void;
  instruments: PickerInstrument[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = instruments.filter(
      (i) =>
        !q ||
        i.symbol.toLowerCase().includes(q) ||
        i.displayName.toLowerCase().includes(q) ||
        (i.exchange ?? '').toLowerCase().includes(q),
    );
    return q ? matches : [{ symbol: '', displayName: 'All instruments' }, ...matches];
  }, [instruments, query]);

  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, options.findIndex((o) => o.symbol === value)));
    input.current?.focus();
    const away = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
    // Re-run only when opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const choose = (symbol: string) => {
    onChange(symbol);
    setOpen(false);
    setQuery('');
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((a) => Math.min(options.length - 1, a + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const option = options[active];
      if (option) choose(option.symbol);
    }
  };

  const label = value || 'All instruments';
  return (
    <div className="relative" ref={root}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Instruments: ${label}`}
        data-testid="instrument-picker"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-10 max-md:h-11 min-w-[11rem] items-center gap-2 rounded-lg border border-line bg-raised px-3 text-sm font-semibold hover:border-line-strong focus-visible:outline-2 focus-visible:outline-text"
      >
        <Layers className="size-4 text-muted" aria-hidden />
        <span className="num flex-1 truncate text-left">{label}</span>
        <ChevronDown className={clsx('size-4 text-muted transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <div
          className={clsx(
            'z-40 flex flex-col overflow-hidden border border-line-strong bg-surface shadow-float',
            'max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:max-h-[70dvh] max-md:rounded-t-2xl max-md:pb-[env(safe-area-inset-bottom)]',
            'md:absolute md:right-0 md:top-full md:mt-2 md:max-h-96 md:w-72 md:rounded-xl',
          )}
          onKeyDown={onKey}
        >
          <div className="flex items-center gap-2 border-b border-line px-3">
            <Search className="size-4 text-muted" aria-hidden />
            <input
              ref={input}
              role="combobox"
              aria-controls={listId}
              aria-expanded
              aria-activedescendant={options[active] ? `${listId}-${active}` : undefined}
              aria-label="Search instruments"
              placeholder="Search instruments"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-subtle"
            />
          </div>
          <ul id={listId} role="listbox" aria-label="Instruments" className="overflow-y-auto py-1">
            {options.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted">No instrument matches “{query.trim()}”.</li>}
            {options.map((option, index) => {
              const selected = option.symbol === value;
              return (
                <li
                  key={option.symbol || 'all'}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={selected}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(option.symbol)}
                  className={clsx(
                    'mx-1 flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 text-sm',
                    index === active && 'bg-neutral-soft',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="num block font-semibold">{option.symbol || option.displayName}</span>
                    {option.symbol && (
                      <span className="block truncate text-xs text-muted">
                        {[option.displayName, 'exchange' in option ? option.exchange : null, 'archived' in option && option.archived ? 'Archived' : null]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    )}
                  </span>
                  {selected && <Check className="size-4" aria-hidden />}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

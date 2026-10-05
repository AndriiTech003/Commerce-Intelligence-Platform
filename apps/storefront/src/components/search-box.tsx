'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/browser-api';
import type { Suggestions } from '@/lib/types';

type Suggestion = Suggestions['products'][number];

export function SearchBox({ initialQuery = '' }: { initialQuery?: string }) {
  const router = useRouter();
  const listId = useId();
  const [query, setQuery] = useState(initialQuery);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const controller = useRef<AbortController | null>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      controller.current?.abort();
      setItems([]);
      return;
    }
    const timer = setTimeout(() => {
      controller.current?.abort();
      const current = new AbortController();
      controller.current = current;
      api()
        .GET('/v1/storefront/search/suggest', { params: { query: { q } }, signal: current.signal })
        .then(({ data }) => {
          if (current.signal.aborted || !data) return;
          setItems(data.products.slice(0, 8));
          setActive(-1);
        })
        .catch(() => undefined);
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(
    () => () => {
      controller.current?.abort();
      if (blurTimer.current) clearTimeout(blurTimer.current);
    },
    [],
  );

  const go = (href: string) => {
    setOpen(false);
    setActive(-1);
    router.push(href);
  };

  const submit = () => {
    const q = query.trim();
    if (q) go(`/search?q=${encodeURIComponent(q)}`);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActive((i) => (items.length ? (i + 1) % items.length : -1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => (items.length ? (i <= 0 ? items.length - 1 : i - 1) : -1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const selected = active >= 0 ? items[active] : undefined;
      if (selected && open) go(`/p/${selected.slug}`);
      else submit();
    } else if (event.key === 'Escape') {
      setOpen(false);
      setActive(-1);
    }
  };

  const showList = open && items.length > 0;

  return (
    <form
      role="search"
      className="relative w-full"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label htmlFor={`${listId}-input`} className="sr-only">
        Search products
      </label>
      <input
        id={`${listId}-input`}
        data-testid="search-input"
        type="search"
        autoComplete="off"
        placeholder="Search products…"
        value={query}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          blurTimer.current = setTimeout(() => setOpen(false), 120);
        }}
        onKeyDown={onKeyDown}
        className="h-10 w-full rounded-full border border-slate-300 bg-white px-4 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[var(--brand)] focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      />
      {showList ? (
        <ul
          id={listId}
          role="listbox"
          data-testid="search-suggestions"
          className="absolute inset-x-0 top-full z-40 mt-1 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
        >
          {items.map((item, index) => (
            <li
              key={item.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              data-testid="search-suggestion"
              onMouseDown={(event) => {
                event.preventDefault();
                go(`/p/${item.slug}`);
              }}
              onMouseEnter={() => setActive(index)}
              className={`cursor-pointer px-4 py-2 text-sm ${
                index === active
                  ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white'
                  : 'text-slate-700 dark:text-slate-300'
              }`}
            >
              {item.title}
            </li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}

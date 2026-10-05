'use client';

import { Input, Modal } from '@cip/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, unwrap } from '@/lib/api';

interface Hit {
  label: string;
  href: string;
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setHits([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void (async () => {
        const results: Hit[] = [];
        const number = Number(query.replace('#', ''));
        if (Number.isInteger(number) && number > 0) {
          const orders = await api.GET('/v1/admin/orders', {
            params: { query: { number, limit: 5 } },
            signal: controller.signal,
          });
          if (orders.data)
            for (const o of orders.data.data)
              results.push({ label: `Order #${o.number} · ${o.email}`, href: `/orders/${o.id}` });
        }
        const products = await api.GET('/v1/admin/products', {
          params: { query: { q: query, limit: 8 } },
          signal: controller.signal,
        });
        if (products.data)
          for (const p of unwrap(products).data)
            results.push({ label: `Product · ${p.title}`, href: `/products/${p.id}` });
        setHits(results);
        setActive(0);
      })().catch(() => undefined);
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, open]);

  const go = (hit: Hit | undefined) => {
    if (!hit) return;
    onClose();
    setQuery('');
    router.push(hit.href);
  };

  return (
    <Modal open={open} onClose={onClose} title="Go to order or product">
      <Input
        autoFocus
        placeholder="Order number or product name"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') setActive((i) => Math.min(hits.length - 1, i + 1));
          if (event.key === 'ArrowUp') setActive((i) => Math.max(0, i - 1));
          if (event.key === 'Enter') go(hits[active]);
        }}
      />
      <ul role="listbox" className="max-h-72 overflow-y-auto">
        {hits.map((hit, index) => (
          <li key={hit.href} role="option" aria-selected={index === active}>
            <button
              type="button"
              className={`w-full rounded px-2 py-1.5 text-left ${index === active ? 'bg-slate-100 dark:bg-slate-800' : ''}`}
              onClick={() => go(hit)}
            >
              {hit.label}
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

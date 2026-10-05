'use client';

import { Badge, Button, cn, Select } from '@cip/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useSession } from '@/lib/session';
import { CommandPalette } from './command-palette';
import { visibleNav } from './nav';

export function Shell({ children }: { children: ReactNode }) {
  const session = useSession();
  const pathname = usePathname();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const nav = visibleNav(session.can, session.user.isPlatformAdmin);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 border-r border-slate-200 bg-white p-4 md:block dark:border-slate-800 dark:bg-slate-900">
        <Link href="/live" className="mb-6 block text-lg font-semibold">
          CIP Admin
        </Link>
        <nav aria-label="Main" className="space-y-5">
          {nav.map((group) => (
            <div key={group.label}>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {group.label}
              </p>
              <ul className="space-y-0.5">
                {group.items.map((item) => (
                  <li key={item.href}>
                    {item.soon ? (
                      <span className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm text-slate-500 dark:text-slate-400">
                        {item.label}
                        <Badge>{item.soon}</Badge>
                      </span>
                    ) : (
                      <Link
                        href={item.href}
                        data-testid={`nav-${item.href.replace(/\//g, '-').slice(1)}`}
                        className={cn(
                          'block rounded-md px-2 py-1.5 text-sm',
                          pathname.startsWith(item.href)
                            ? 'bg-slate-100 font-medium text-slate-900 dark:bg-slate-800 dark:text-white'
                            : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800',
                        )}
                      >
                        {item.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-6 py-3 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-3">
            {session.memberships.length > 0 ? (
              <Select
                aria-label="Store"
                data-testid="tenant-switcher"
                className="w-56"
                value={session.tenant?.tenantId ?? ''}
                onChange={(event) => session.switchTenant(event.target.value)}
              >
                {session.memberships.map((m) => (
                  <option key={m.tenantId} value={m.tenantId}>
                    {m.name} · {m.role}
                  </option>
                ))}
              </Select>
            ) : (
              <span className="text-sm text-slate-500 dark:text-slate-400">No store membership</span>
            )}
            <Button variant="ghost" size="sm" onClick={() => setPaletteOpen(true)}>
              Search ⌘K
            </Button>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-600 dark:text-slate-300" data-testid="current-user">
              {session.user.email}
            </span>
            <Button variant="secondary" size="sm" onClick={() => void session.logout()} data-testid="logout">
              Log out
            </Button>
          </div>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}

export function PageHeader({
  title,
  actions,
  description,
}: {
  title: string;
  actions?: ReactNode;
  description?: string;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex gap-2">{actions}</div> : null}
    </div>
  );
}

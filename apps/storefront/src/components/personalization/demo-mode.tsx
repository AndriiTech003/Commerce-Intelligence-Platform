'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import { DEMO_KEY, demoParam, readDemo, writeDemo } from '@/lib/demo-mode';

const listeners = new Set<() => void>();
let override: boolean | null = null;

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== DEMO_KEY && event.key !== null) return;
    override = null;
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

function getSnapshot(): boolean {
  return override ?? readDemo(storage());
}

function getServerSnapshot(): boolean {
  return false;
}

export function setDemoMode(enabled: boolean): void {
  override = enabled;
  writeDemo(storage(), enabled);
  for (const listener of listeners) listener();
}

export function useDemoMode(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function DemoModeToggle() {
  const enabled = useDemoMode();
  const pathname = usePathname();

  useEffect(() => {
    const requested = demoParam(window.location.search);
    if (requested !== null && requested !== getSnapshot()) setDemoMode(requested);
  }, [pathname]);

  return (
    <button
      type="button"
      data-testid="demo-mode-toggle"
      aria-pressed={enabled}
      onClick={() => setDemoMode(!enabled)}
      className="inline-flex items-center gap-2 self-start rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:border-[var(--brand)] hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] dark:border-slate-700 dark:text-slate-300 dark:hover:text-white"
    >
      <span
        aria-hidden="true"
        className={`inline-block h-2 w-2 rounded-full ${enabled ? 'bg-emerald-500' : 'bg-slate-400'}`}
      />
      Demo mode: {enabled ? 'on' : 'off'}
    </button>
  );
}

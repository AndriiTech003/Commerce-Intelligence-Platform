'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function DialogBody({
  title,
  subtitle,
  testId,
  onClose,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  testId: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
    closeRef.current?.focus();
    return () => {
      if (dialog.open && typeof dialog.close === 'function') dialog.close();
      previous?.focus();
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || !ref.current) return;
    const focusable = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (element) => !element.hasAttribute('disabled') && element.getClientRects().length > 0,
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) {
      event.preventDefault();
      return;
    }
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !ref.current.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !ref.current.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-modal="true"
      data-testid={testId}
      onKeyDown={onKeyDown}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      className="m-auto max-h-[min(88vh,52rem)] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-0 text-left text-slate-900 shadow-2xl backdrop:bg-slate-950/60 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
    >
      <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
        <div className="min-w-0">
          <h2 id={titleId} className="text-base font-semibold">
            {title}
          </h2>
          {subtitle ? (
            <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{subtitle}</div>
          ) : null}
        </div>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          data-testid="why-this-close"
          aria-label="Close explanation"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-lg leading-none text-slate-500 dark:text-slate-400 hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] dark:hover:bg-slate-800 dark:hover:text-white"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <div className="space-y-6 px-5 py-5 text-sm">{children}</div>
    </dialog>
  );
}

export function WhyThisTrigger({
  label = 'Why this?',
  title,
  subtitle,
  buttonTestId,
  panelTestId,
  tone = 'light',
  children,
}: {
  label?: string;
  title: string;
  subtitle?: ReactNode;
  buttonTestId: string;
  panelTestId: string;
  tone?: 'light' | 'onBrand';
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <>
      <button
        type="button"
        data-testid={buttonTestId}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }}
        className={`inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-xs font-semibold shadow-sm ring-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${
          tone === 'onBrand'
            ? 'bg-white/95 text-slate-900 ring-white/40 hover:bg-white focus-visible:ring-white focus-visible:ring-offset-[var(--brand)]'
            : 'bg-white text-slate-700 ring-slate-300 hover:text-slate-900 focus-visible:ring-[var(--brand)] dark:bg-slate-800 dark:text-slate-100 dark:ring-slate-600'
        }`}
      >
        <span aria-hidden="true">ⓘ</span>
        {label}
      </button>
      {mounted && open
        ? createPortal(
            <DialogBody title={title} subtitle={subtitle} testId={panelTestId} onClose={() => setOpen(false)}>
              {children}
            </DialogBody>,
            document.body,
          )
        : null}
    </>
  );
}

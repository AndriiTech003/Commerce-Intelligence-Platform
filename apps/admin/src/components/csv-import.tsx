'use client';

import { Badge, Button, Card, ErrorNote, Table, Td, Th } from '@cip/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { postText } from '@/lib/api';
import { CSV_COLUMNS, csvDataUri, csvTemplate } from '@/lib/csv';
import { queryKeys } from '@/lib/query-keys';
import { useTenantId } from '@/lib/session';
import type { ImportAccepted } from '@/lib/types';
import { isJobDone, jobProgress, useJob } from '@/lib/use-job';
import { ProblemNote } from './problem-note';

export function CsvImport() {
  const tenantId = useTenantId();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useJob(jobId);
  const done = isJobDone(job.data);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const text = await file.text();
      return postText<ImportAccepted>('/v1/admin/products/import', text, 'text/csv');
    },
    onSuccess: (result) => setJobId(result.jobId),
  });

  useEffect(() => {
    if (done) void queryClient.invalidateQueries({ queryKey: queryKeys.products.all(tenantId) });
  }, [done, queryClient, tenantId]);

  const result = job.data?.result ?? null;
  const created = typeof result?.productsCreated === 'number' ? result.productsCreated : null;
  const failure = typeof result?.error === 'string' ? result.error : null;
  const progress = jobProgress(job.data);
  const busy = upload.isPending || (jobId !== null && !done);

  return (
    <Card className="mb-4" data-testid="csv-import">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Import products from CSV</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Columns: <code>{CSV_COLUMNS.join(',')}</code>. Rows sharing a handle become variants of one
            product; category is the category slug; prices like 129.00.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={csvDataUri(csvTemplate())}
            download="products-template.csv"
            className="text-sm text-[var(--brand,#2563eb)] hover:underline dark:text-blue-400"
            data-testid="import-template"
          >
            Download template
          </a>
          <label className="sr-only" htmlFor="import-csv-input">
            CSV file
          </label>
          <input
            ref={inputRef}
            id="import-csv-input"
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            data-testid="import-csv-input"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              setFileName(file.name);
              setJobId(null);
              upload.mutate(file);
              event.target.value = '';
            }}
          />
          <Button
            size="sm"
            variant="secondary"
            loading={busy}
            onClick={() => inputRef.current?.click()}
            data-testid="import-csv-button"
          >
            Choose CSV…
          </Button>
        </div>
      </div>
      <ProblemNote error={upload.error} testId="import-upload-error" />
      {jobId ? (
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-300">
            <span>
              {fileName ?? 'file'} ·{' '}
              {job.data ? `${job.data.processed} / ${job.data.total} rows processed` : 'queued'}
            </span>
            <Badge tone={job.data?.status === 'failed' ? 'red' : done ? 'green' : 'yellow'}>
              {job.data?.status ?? 'queued'}
            </Badge>
          </div>
          <div
            role="progressbar"
            aria-label="Import progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
            data-testid="import-progress"
            data-status={job.data?.status ?? 'queued'}
            className="h-2 rounded bg-slate-100 dark:bg-slate-800"
          >
            <div
              className="h-2 rounded bg-[var(--brand,#2563eb)] transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          {failure ? <ErrorNote error={new Error(failure)} /> : null}
          {done ? (
            <div data-testid="import-errors" data-count={job.data?.errors.length ?? 0} className="space-y-2">
              <p className="text-sm">
                <strong data-testid="import-created">{created ?? 0}</strong> products created ·{' '}
                {job.data?.errors.length ?? 0} row errors
              </p>
              {job.data && job.data.errors.length > 0 ? (
                <Table>
                  <thead>
                    <tr>
                      <Th className="w-20">Row</Th>
                      <Th>Error</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {job.data.errors.map((e, index) => (
                      <tr key={`${e.row}-${index}`} data-testid="import-error-row">
                        <Td className="tabular-nums">{e.row}</Td>
                        <Td className="text-red-700 dark:text-red-300">{e.message}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              ) : null}
            </div>
          ) : null}
          <ErrorNote error={job.error} />
        </div>
      ) : null}
    </Card>
  );
}

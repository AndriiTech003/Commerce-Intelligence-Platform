'use client';

import {
  Badge,
  Button,
  Card,
  CardTitle,
  EmptyState,
  ErrorNote,
  Field,
  formatDateTime,
  formatNumber,
  Input,
  Select,
  Skeleton,
  Table,
  Td,
  Th,
} from '@cip/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ProblemNote } from '@/components/problem-note';
import { PageHeader } from '@/components/shell';
import { api, unwrap } from '@/lib/api';
import { ALL_TONES } from '@/lib/creatives';
import { pct } from '@/lib/experiment';
import { queryKeys } from '@/lib/query-keys';
import { normalizeShares, PERSONAS, DEFAULT_SHARES, type Persona } from '@/lib/simulator';
import type { SimulatorState } from '@/lib/types';

type Command =
  | { action: 'start'; rate: number; personas: Record<string, number> }
  | { action: 'stop' }
  | { action: 'shift'; shift: { persona: string; toneMultipliers: Record<string, number> } }
  | { action: 'reset_shift' };

function initialShares(state: SimulatorState | undefined): Record<Persona, string> {
  const source = state && Object.keys(state.personas).length > 0 ? state.personas : DEFAULT_SHARES;
  return Object.fromEntries(PERSONAS.map((p) => [p, String(source[p] ?? 0)])) as Record<Persona, string>;
}

function ControlCard({
  state,
  onCommand,
  pending,
}: {
  state: SimulatorState;
  onCommand: (c: Command) => void;
  pending: boolean;
}) {
  const [rate, setRate] = useState(String(state.rate || 3));
  const [shares, setShares] = useState<Record<Persona, string>>(() => initialShares(state));
  const numeric = Object.fromEntries(PERSONAS.map((p) => [p, Math.max(0, Number(shares[p]) || 0)])) as Record<
    Persona,
    number
  >;
  const normalized = normalizeShares(numeric);
  const rateValue = Number(rate);
  const valid = rateValue >= 0.1 && rateValue <= 500 && Object.values(numeric).some((v) => v > 0);
  return (
    <Card>
      <CardTitle
        actions={
          <Badge tone={state.running ? 'green' : 'neutral'}>
            <span data-testid="simulator-status">{state.running ? 'running' : 'stopped'}</span>
          </Badge>
        }
      >
        Control
      </CardTitle>
      <div className="space-y-4">
        <Field label={`Sessions per second: ${rate}`} htmlFor="rate">
          <div className="flex items-center gap-3">
            <input
              id="rate-slider"
              type="range"
              min={0.5}
              max={50}
              step={0.5}
              value={Math.min(50, Number(rate) || 0.5)}
              onChange={(e) => setRate(e.target.value)}
              className="flex-1"
              aria-label="Sessions per second slider"
            />
            <div className="w-24 shrink-0">
              <Input
                id="rate"
                type="number"
                min={0.1}
                max={500}
                step={0.5}
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                data-testid="simulator-rate"
              />
            </div>
          </div>
        </Field>
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">Persona mix</legend>
          <ul className="space-y-2">
            {PERSONAS.map((persona) => (
              <li
                key={persona}
                className="grid grid-cols-[minmax(0,9rem)_5rem_1fr_3rem] items-center gap-2 text-sm"
              >
                <label htmlFor={`share-${persona}`} className="truncate font-mono text-xs">
                  {persona}
                </label>
                <Input
                  id={`share-${persona}`}
                  type="number"
                  min={0}
                  step={0.05}
                  value={shares[persona]}
                  onChange={(e) => setShares((s) => ({ ...s, [persona]: e.target.value }))}
                  data-testid={`persona-share-${persona}`}
                />
                <span className="h-2 rounded bg-slate-100 dark:bg-slate-800" aria-hidden="true">
                  <span
                    className="block h-2 rounded bg-[var(--brand,#2563eb)]"
                    style={{ width: `${normalized[persona] * 100}%` }}
                  />
                </span>
                <span className="text-right text-xs tabular-nums text-slate-500 dark:text-slate-400">
                  {pct(normalized[persona], 0)}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Weights are normalized; they don’t need to sum to 1.
          </p>
        </fieldset>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => onCommand({ action: 'start', rate: rateValue, personas: numeric })}
            loading={pending}
            disabled={!valid}
            data-testid="simulator-start"
          >
            {state.running ? 'Apply' : 'Start'}
          </Button>
          <Button
            variant="secondary"
            onClick={() => onCommand({ action: 'stop' })}
            disabled={!state.running}
            data-testid="simulator-stop"
          >
            Stop
          </Button>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Mode <code>{state.mode}</code> · updated {formatDateTime(state.updatedAt)}
        </p>
      </div>
    </Card>
  );
}

function ShiftCard({
  state,
  onCommand,
  pending,
}: {
  state: SimulatorState;
  onCommand: (c: Command) => void;
  pending: boolean;
}) {
  const [persona, setPersona] = useState<Persona>('marathon_runner');
  const [multipliers, setMultipliers] = useState<Record<string, string>>({
    performance: '0.6',
    lifestyle: '1.8',
    value: '1',
    premium: '1',
  });
  const parsed = Object.fromEntries(ALL_TONES.map((t) => [t, Number(multipliers[t])]));
  const valid = Object.values(parsed).every((v) => Number.isFinite(v) && v >= 0 && v <= 10);
  const shifted = Object.entries(state.shifted);
  return (
    <Card>
      <CardTitle>Shift preferences</CardTitle>
      <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
        Change a persona’s hidden tone multipliers on the fly and watch the bandit re-route traffic.
      </p>
      <div className="space-y-3">
        <Field label="Persona" htmlFor="shift-persona">
          <Select id="shift-persona" value={persona} onChange={(e) => setPersona(e.target.value as Persona)}>
            {PERSONAS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          {ALL_TONES.map((tone) => (
            <Field key={tone} label={`${tone} ×`} htmlFor={`mult-${tone}`}>
              <Input
                id={`mult-${tone}`}
                type="number"
                min={0}
                max={10}
                step={0.1}
                value={multipliers[tone] ?? ''}
                onChange={(e) => setMultipliers((m) => ({ ...m, [tone]: e.target.value }))}
                data-testid={`shift-${tone}`}
              />
            </Field>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => onCommand({ action: 'shift', shift: { persona, toneMultipliers: parsed } })}
            disabled={!valid}
            loading={pending}
            data-testid="simulator-shift"
          >
            Shift preferences
          </Button>
          <Button
            variant="secondary"
            onClick={() => onCommand({ action: 'reset_shift' })}
            disabled={shifted.length === 0}
            data-testid="simulator-reset-shift"
          >
            Reset shift
          </Button>
        </div>
        {shifted.length > 0 ? (
          <ul className="space-y-1 text-xs" data-testid="simulator-shifted">
            {shifted.map(([p, tones]) => (
              <li key={p}>
                <Badge tone="yellow">shifted</Badge> <code>{p}</code>:{' '}
                {Object.entries(tones)
                  .map(([t, v]) => `${t} ×${v}`)
                  .join(', ')}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Card>
  );
}

function GroundTruth({ running }: { running: boolean }) {
  const truth = useQuery({
    queryKey: queryKeys.platform.groundTruth(),
    queryFn: async () => unwrap(await api.GET('/v1/platform/simulator/ground-truth')),
    refetchInterval: running ? 5000 : false,
  });
  const data = truth.data;
  return (
    <Card>
      <CardTitle>Ground truth vs learned{data?.campaignName ? ` · ${data.campaignName}` : ''}</CardTitle>
      <ErrorNote error={truth.error} />
      {truth.isLoading ? (
        <Skeleton className="h-40" />
      ) : !data || data.rows.length === 0 ? (
        <EmptyState
          title="Nothing learned yet"
          description="Start the simulator against a store with an active campaign; rows appear as personas get served."
        />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Persona</Th>
                <Th>True best tone</Th>
                <Th>Mostly lands in</Th>
                <Th>Bandit picked</Th>
                <Th className="text-right">Impressions</Th>
                <Th className="text-center">Match</Th>
              </tr>
            </thead>
            <tbody
              className="divide-y divide-slate-100 dark:divide-slate-800"
              data-testid="ground-truth-table"
            >
              {data.rows.map((row) => (
                <tr key={row.persona} data-testid="ground-truth-row" data-correct={row.correct}>
                  <Td>
                    <code className="text-xs">{row.persona}</code>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">
                      {formatNumber(row.sessions)} sessions
                    </span>
                  </Td>
                  <Td>
                    <span className="font-medium">{row.trueBestTone}</span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">
                      {Object.entries(row.toneMultipliers)
                        .map(([t, v]) => `${t} ×${v}`)
                        .join(' · ')}
                    </span>
                  </Td>
                  <Td>
                    {row.segmentKey ? <code className="text-xs">{row.segmentKey}</code> : '—'}
                    <span className="ml-1 text-xs text-slate-500 dark:text-slate-400">
                      ({pct(row.segmentShare, 0)})
                    </span>
                  </Td>
                  <Td>
                    {row.learnedTone ?? '—'}
                    {row.pBest !== null ? (
                      <span className="ml-1 text-xs text-slate-500 dark:text-slate-400">
                        P(best) {pct(row.pBest, 0)}
                      </span>
                    ) : null}
                  </Td>
                  <Td className="text-right tabular-nums">{formatNumber(row.impressions)}</Td>
                  <Td className="text-center">
                    {row.correct ? (
                      <span className="text-emerald-700 dark:text-emerald-400" aria-label="matches">
                        ✓
                      </span>
                    ) : (
                      <span className="text-red-600 dark:text-red-400" aria-label="does not match">
                        ✗
                      </span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            {data.rows.filter((r) => r.correct).length} of {data.rows.length} personas: the bandit found the
            hidden preference without being told.
          </p>
        </>
      )}
      {data?.regret ? (
        <p className="mt-3 text-sm" data-testid="simulator-regret">
          Over {formatNumber(data.regret.decisions)} decisions Thompson lost{' '}
          <strong>{formatNumber(Math.round(data.regret.thompson))}</strong> clicks, uniform A/B lost{' '}
          <strong>{formatNumber(Math.round(data.regret.uniform))}</strong>.
        </p>
      ) : null}
    </Card>
  );
}

export default function SimulatorPage() {
  const queryClient = useQueryClient();
  const state = useQuery({
    queryKey: queryKeys.platform.simulator(),
    queryFn: async () => unwrap(await api.GET('/v1/platform/simulator')),
    refetchInterval: (query) => (query.state.data?.running ? 5000 : false),
  });
  const command = useMutation({
    mutationFn: async (body: Command) => unwrap(await api.POST('/v1/platform/simulator', { body })),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.platform.simulator(), data);
      void queryClient.invalidateQueries({ queryKey: queryKeys.platform.groundTruth() });
    },
  });
  const s = state.data;
  const stats = Object.entries(s?.stats ?? {});
  return (
    <div className="space-y-4">
      <PageHeader
        title="Traffic simulator"
        description="Personas browse the demo stores through the real public APIs. Their tone preferences are hidden from the system."
      />
      <ErrorNote error={state.error} />
      <ProblemNote error={command.error} />
      {!s ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <ControlCard state={s} onCommand={(c) => command.mutate(c)} pending={command.isPending} />
          <ShiftCard state={s} onCommand={(c) => command.mutate(c)} pending={command.isPending} />
          <Card>
            <CardTitle>Stats</CardTitle>
            {stats.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">No stats reported yet.</p>
            ) : (
              <dl className="grid grid-cols-2 gap-3" data-testid="simulator-stats">
                {stats.map(([key, value]) => (
                  <div key={key}>
                    <dt className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      {key.replace(/_/g, ' ')}
                    </dt>
                    <dd className="text-lg font-semibold tabular-nums">
                      {formatNumber(Math.round(value * 100) / 100)}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </Card>
        </div>
      )}
      <GroundTruth running={Boolean(s?.running)} />
    </div>
  );
}

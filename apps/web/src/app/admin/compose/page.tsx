'use client';

import {
  ACTIONS,
  type Direction,
  type DraftInput,
  type DraftRow,
  type EntryType,
  type FeedEvent,
  formatPoints,
  formatPrice,
  type InstrumentSpec,
  MAX_TARGETS,
  type Priority,
  type AdminTradeDetail,
  toDec,
  composeSignal,
  defaultSignalTemplateKind,
  isSignalReady,
  isTemplateForDirection,
  previewSignalEvent,
  ENTRY_WINDOW_CHOICES,
  entryWindowLabel,
  type PlatformSettings,
} from '@signaldesk/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { ArrowDownRight, ArrowUpRight, CheckCircle2, ExternalLink, FileEdit, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { DispatchStatus } from '@/components/admin/dispatch';
import { FeedCard } from '@/components/trade';
import {
  Button,
  buttonClass,
  Card,
  CardHeader,
  Dialog,
  ErrorState,
  Field,
  FormError,
  Input,
  Kbd,
  Loading,
  PageHeader,
  Labeled,
  Segmented,
  Select,
  Skeleton,
  Switch,
  Textarea,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { formatDateTime, formatRelative } from '@/lib/format';

type InstrumentRow = InstrumentSpec & { id: string; active: boolean; sortOrder: number };

interface TemplateRow {
  id: string;
  kind: string;
  name: string;
  tone: string;
  title: string;
  body: string;
  active: boolean;
  favorite: boolean;
  isDefault: boolean;
}

interface FormState {
  instrumentId: string;
  direction: Direction | null;
  entryType: EntryType;
  entryLow: string;
  entryHigh: string;
  custom: boolean;
  targets: [string, string, string];
  stopLoss: string;
  /** A range announced ahead: targets and stop-loss are set when it is activated. */
  levelsLater: boolean;
  priority: Priority;
  templateId: string;
  commentary: string;
  /** DEFAULT follows the platform's start mode. */
  startAs: 'DEFAULT' | 'AWAITING_ENTRY' | 'ACTIVE';
  /** DEFAULT: the platform window. NONE: no limit. CUSTOM: the time in `deadline`. Otherwise minutes. */
  window: string;
  deadline: string;
}

const EMPTY: FormState = {
  instrumentId: '',
  direction: null,
  entryType: 'SINGLE',
  entryLow: '',
  entryHigh: '',
  custom: false,
  targets: ['', '', ''],
  stopLoss: '',
  levelsLater: false,
  priority: 'NORMAL',
  templateId: '',
  commentary: '',
  startAs: 'DEFAULT',
  window: 'DEFAULT',
  deadline: '',
};

const STORAGE_KEY = 'sd-composer';
const RECENT_KEY = 'sd-recent-instruments';

function readStorage<T>(store: 'local' | 'session', key: string): T | null {
  try {
    const raw = (store === 'local' ? localStorage : sessionStorage).getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeStorage(store: 'local' | 'session', key: string, value: unknown): void {
  try {
    const target = store === 'local' ? localStorage : sessionStorage;
    if (value === null) target.removeItem(key);
    else target.setItem(key, JSON.stringify(value));
  } catch {
    // Preservation is a convenience: the form still works without it.
  }
}

function Composer() {
  const router = useRouter();
  const params = useSearchParams();
  const client = useQueryClient();
  const instruments = useQuery({
    queryKey: ['admin', 'instruments'],
    queryFn: () => api.get<{ instruments: InstrumentRow[] }>('/admin/instruments'),
  });
  const templates = useQuery({
    queryKey: ['admin', 'templates'],
    queryFn: () => api.get<{ templates: TemplateRow[] }>('/admin/templates'),
  });
  const drafts = useQuery({
    queryKey: ['admin', 'drafts'],
    queryFn: () => api.get<{ drafts: DraftRow[] }>('/admin/drafts'),
  });
  const platform = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: () => api.get<PlatformSettings>('/admin/settings'),
  });

  const [form, setForm] = useState<FormState>(EMPTY);
  const [mode, setMode] = useState<'quick' | 'advanced'>('quick');
  const [draftRef, setDraftRef] = useState<{ id: string; version: number } | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [published, setPublished] = useState<AdminTradeDetail | null>(null);
  const [cycle, setCycle] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const hydrated = useRef(false);
  const entryInput = useRef<HTMLInputElement>(null);

  const active = useMemo(() => (instruments.data?.instruments ?? []).filter((i) => i.active), [instruments.data]);
  const ordered = useMemo(
    () =>
      [...active].sort((a, b) => {
        const ra = recent.indexOf(a.id);
        const rb = recent.indexOf(b.id);
        if (ra !== -1 || rb !== -1) return (ra === -1 ? 99 : ra) - (rb === -1 ? 99 : rb);
        return a.sortOrder - b.sortOrder;
      }),
    [active, recent],
  );
  const spec = active.find((i) => i.id === form.instrumentId);
  const computed = useMemo(() => composeSignal(form, spec), [form, spec]);

  // Restore work in progress: a refresh or an accidental navigation must not lose a signal.
  useEffect(() => {
    if (hydrated.current || !instruments.data) return;
    hydrated.current = true;
    const recentIds = readStorage<string[]>('local', RECENT_KEY) ?? [];
    setRecent(recentIds);
    // Reusing an earlier trade carries only its instrument and direction. Prices are always fresh.
    const reuse = active.find((i) => i.symbol === params.get('symbol'));
    if (reuse) {
      const direction = params.get('direction');
      setForm((f) => ({
        ...f,
        instrumentId: reuse.id,
        direction: direction === 'BUY' || direction === 'SELL' ? direction : null,
      }));
      return;
    }
    const saved = readStorage<{ form: FormState; draftRef: { id: string; version: number } | null }>(
      'session',
      STORAGE_KEY,
    );
    if (saved?.form) {
      setForm({ ...EMPTY, ...saved.form });
      setDraftRef(saved.draftRef);
      if (saved.form.custom || saved.form.commentary || saved.form.priority !== 'NORMAL' || saved.form.templateId)
        setMode('advanced');
      return;
    }
    const first = active.slice().sort((a, b) => {
      const ra = recentIds.indexOf(a.id);
      const rb = recentIds.indexOf(b.id);
      if (ra !== -1 || rb !== -1) return (ra === -1 ? 99 : ra) - (rb === -1 ? 99 : rb);
      return a.sortOrder - b.sortOrder;
    })[0];
    if (first) setForm((f) => ({ ...f, instrumentId: first.id }));
  }, [active, instruments.data, params]);

  useEffect(() => {
    if (hydrated.current) writeStorage('session', STORAGE_KEY, { form, draftRef });
  }, [draftRef, form]);

  const set = useCallback(
    <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value })),
    [],
  );

  const loadDraft = useCallback(
    (row: DraftRow) => {
      const d = row.draft;
      const targets = [...(d.targets ?? []), '', '', ''].slice(0, 3) as [string, string, string];
      setForm({
        ...EMPTY,
        instrumentId: d.instrumentId ?? active[0]?.id ?? '',
        direction: d.direction ?? null,
        entryType: d.entryType ?? 'SINGLE',
        entryLow: d.entryLow ?? '',
        entryHigh: d.entryHigh ?? '',
        custom: (d.targets?.length ?? 0) > 0 || Boolean(d.stopLoss),
        targets,
        stopLoss: d.stopLoss ?? '',
        priority: d.priority ?? 'NORMAL',
        templateId: d.templateId ?? '',
        commentary: d.commentary ?? '',
      });
      setDraftRef({ id: row.id, version: row.version });
      if ((d.targets?.length ?? 0) > 0 || d.commentary || d.templateId) setMode('advanced');
      toast.success('Draft opened');
    },
    [active],
  );

  const draftParam = params.get('draft');
  useEffect(() => {
    const row = drafts.data?.drafts.find((d) => d.id === draftParam);
    if (row && !draftRef) loadDraft(row);
  }, [draftParam, drafts.data, draftRef, loadDraft]);

  // Same contents, same key: a double click or a retry after a lost response cannot publish twice.
  const fields = useMemo(
    () => ({
      instrumentId: form.instrumentId,
      direction: form.direction as Direction,
      entryType: form.entryType,
      entryLow: computed.entry?.low ?? '',
      entryHigh: computed.entry?.high ?? '',
      targets: computed.targets,
      stopLoss: computed.upcoming ? undefined : computed.stopLoss,
      priority: form.priority,
      templateId: computed.upcoming ? null : form.templateId || null,
      commentary: form.commentary.trim() || undefined,
    }),
    [form, computed],
  );
  const defaultMode = platform.data?.signalStartMode ?? 'AWAITING_ENTRY';
  const defaultWindow = platform.data?.entryExpiryMinutesDefault ?? 0;
  const startsActive =
    !computed.upcoming && (form.startAs === 'DEFAULT' ? defaultMode === 'ACTIVE' : form.startAs === 'ACTIVE');
  const windowOptions = [...new Set([...ENTRY_WINDOW_CHOICES])].filter((m) => m !== defaultWindow);
  /** Worked out when the button is pressed, so a long review does not shorten the window. */
  const startFields = () => ({
    activateOnPublish: computed.upcoming || form.startAs === 'DEFAULT' ? undefined : form.startAs === 'ACTIVE',
    entryExpiresAt: startsActive
      ? undefined
      : form.window === 'NONE'
        ? null
        : form.window === 'CUSTOM'
          ? form.deadline
            ? new Date(form.deadline).toISOString()
            : undefined
          : form.window === 'DEFAULT'
            ? undefined
            : new Date(Date.now() + Number(form.window) * 60_000).toISOString(),
  });
  const fieldsKey = `${JSON.stringify(fields)}#${form.startAs}#${form.window}#${form.deadline}#${cycle}`;
  const idempotencyKey = useMemo(() => {
    void fieldsKey;
    return crypto.randomUUID();
  }, [fieldsKey]);

  const publish = useMutation({
    mutationFn: (confirmDuplicate: boolean) =>
      api.post<{ tradeId: string; replayed: boolean; trade: AdminTradeDetail }>('/admin/signals', {
        ...fields,
        ...startFields(),
        idempotencyKey,
        confirmDuplicate,
        draftId: draftRef?.id,
        draftVersion: draftRef?.version,
      }),
    onSuccess: (result) => {
      setPublished(result.trade);
      setReviewOpen(false);
      const nextRecent = [form.instrumentId, ...recent.filter((id) => id !== form.instrumentId)].slice(0, 8);
      setRecent(nextRecent);
      writeStorage('local', RECENT_KEY, nextRecent);
      writeStorage('session', STORAGE_KEY, null);
      void client.invalidateQueries({ queryKey: ['admin'] });
    },
  });

  const saveDraft = useMutation({
    mutationFn: async () => {
      const body: DraftInput = {
        instrumentId: form.instrumentId || null,
        direction: form.direction,
        entryType: form.entryType,
        entryLow: form.entryLow.trim() || null,
        entryHigh: form.entryHigh.trim() || null,
        targets: form.custom ? form.targets.map((t) => t.trim()).filter(Boolean) : [],
        stopLoss: form.custom ? form.stopLoss.trim() || null : null,
        priority: form.priority,
        templateId: form.templateId || null,
        commentary: form.commentary.trim() || undefined,
      };
      return draftRef
        ? api.put<DraftRow>(`/admin/drafts/${draftRef.id}`, body)
        : api.post<DraftRow>('/admin/drafts', body);
    },
    onSuccess: (row) => {
      setDraftRef({ id: row.id, version: row.version });
      void client.invalidateQueries({ queryKey: ['admin', 'drafts'] });
      toast.success('Draft saved');
    },
    onError: (e) => toast.error((e as ApiError).message),
  });

  const discardDraft = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/drafts/${id}`),
    onSuccess: (_r, id) => {
      if (draftRef?.id === id) setDraftRef(null);
      void client.invalidateQueries({ queryKey: ['admin', 'drafts'] });
    },
  });

  const canReview = Boolean(spec && form.direction && isSignalReady(computed));

  const reset = useCallback(() => {
    setPublished(null);
    setDraftRef(null);
    publish.reset();
    setCycle((c) => c + 1);
    setForm((f) => ({ ...EMPTY, instrumentId: f.instrumentId }));
    router.replace('/admin/compose');
    setTimeout(() => entryInput.current?.focus(), 0);
  }, [publish, router]);

  // Single-key shortcuts for the fastest path. Never while typing in a field or with a dialog open.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (published) {
        if (event.key.toLowerCase() === 'n') {
          event.preventDefault();
          reset();
        }
        return;
      }
      if (reviewOpen || typing) return;
      const key = event.key.toLowerCase();
      if (key === 'b') {
        event.preventDefault();
        set('direction', 'BUY');
        entryInput.current?.focus();
      } else if (key === 's') {
        event.preventDefault();
        set('direction', 'SELL');
        entryInput.current?.focus();
      } else if (/^[1-9]$/.test(key)) {
        const chosen = ordered[Number(key) - 1];
        if (chosen) {
          event.preventDefault();
          set('instrumentId', chosen.id);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ordered, published, reset, reviewOpen, set]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (canReview) setReviewOpen(true);
  };

  const signalTemplates = (templates.data?.templates ?? []).filter(
    (t) => t.active && isTemplateForDirection(t.kind, form.direction),
  );
  const chosenTemplate = useMemo(() => {
    const all = templates.data?.templates ?? [];
    if (form.templateId && !computed.upcoming) return all.find((t) => t.id === form.templateId);
    const kind = defaultSignalTemplateKind(form.direction, form.priority, computed.upcoming);
    return all.find((t) => t.kind === kind && t.isDefault);
  }, [computed.upcoming, form.direction, form.priority, form.templateId, templates.data]);

  const previewEvent: FeedEvent | null = useMemo(
    () =>
      spec && form.direction
        ? previewSignalEvent({
            spec,
            direction: form.direction,
            composed: computed,
            priority: form.priority,
            commentary: form.commentary,
            template: chosenTemplate,
          })
        : null,
    [chosenTemplate, computed, form.commentary, form.direction, form.priority, spec],
  );

  if (instruments.isPending) return <Loading rows={2} label="Loading the composer" />;
  if (instruments.isError) return <ErrorState error={instruments.error} onRetry={() => void instruments.refetch()} />;
  if (active.length === 0) {
    return (
      <ErrorState
        error={new ApiError(0, 'NONE', 'No instruments are switched on. Add or enable one first.')}
        title="Nothing to publish on"
      />
    );
  }

  if (published) return <Published trade={published} onAnother={reset} />;

  const duplicate =
    publish.error instanceof ApiError && publish.error.code === 'DUPLICATE_SIGNAL' ? publish.error : null;
  const fieldError = (field: string) => computed.issues.find((i) => i.field === field)?.message;
  // A bad entry makes every calculated level wrong too. Only the cause is worth showing.
  const entryIsBad = computed.issues.some((i) => i.field === 'entryLow' || i.field === 'entryHigh');
  const generalIssues = entryIsBad
    ? []
    : computed.issues.filter((i) => !(form.custom && (i.field === 'stopLoss' || i.field.startsWith('targets.'))));

  return (
    <>
      <PageHeader
        title="New signal"
        description={
          <span className="hidden md:inline">
            Keyboard: <Kbd>1</Kbd>–<Kbd>9</Kbd> instrument, <Kbd>B</Kbd>/<Kbd>S</Kbd> direction, <Kbd>Enter</Kbd>{' '}
            review, <Kbd>Enter</Kbd> publish.
          </span>
        }
        action={
          <Segmented
            label="Composer mode"
            value={mode}
            onChange={setMode}
            className="w-52"
            options={[
              { value: 'quick', label: 'Quick' },
              { value: 'advanced', label: 'Advanced' },
            ]}
          />
        }
      />
      {(drafts.data?.drafts.length ?? 0) > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <FileEdit className="size-4 text-muted" aria-hidden />
          <span className="text-[13px] text-muted">Drafts:</span>
          {drafts.data?.drafts.slice(0, 5).map((d) => (
            <span key={d.id} className="inline-flex items-center rounded-lg border border-line bg-surface">
              <button
                type="button"
                onClick={() => loadDraft(d)}
                className={clsx(
                  'rounded-l-lg px-2.5 py-1.5 text-[13px] hover:text-text max-md:min-h-11',
                  draftRef?.id === d.id ? 'font-semibold text-text' : 'text-muted',
                )}
              >
                {d.draft.direction ?? 'Untitled'} {active.find((i) => i.id === d.draft.instrumentId)?.symbol ?? ''}{' '}
                {d.draft.entryLow ?? ''} · {formatRelative(d.updatedAt)}
              </button>
              <button
                type="button"
                aria-label="Discard draft"
                onClick={() => discardDraft.mutate(d.id)}
                className="rounded-r-lg px-2 py-1.5 text-muted hover:text-stop max-md:min-h-11"
              >
                <Trash2 className="size-3.5" aria-hidden />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <Card className="flex flex-col gap-4 p-4 sm:p-5">
            <fieldset>
              <legend className="mb-1.5 text-[13px] font-medium text-muted">Instrument</legend>
              <div className="flex flex-wrap gap-2">
                {ordered.map((i, n) => {
                  const on = form.instrumentId === i.id;
                  return (
                    <label
                      key={i.id}
                      className={clsx(
                        'relative flex h-11 cursor-pointer select-none items-center gap-2 rounded-lg border px-3.5 text-sm font-semibold transition-colors has-focus-visible:outline-2 has-focus-visible:outline-text',
                        on
                          ? 'border-text bg-raised'
                          : 'border-line text-muted hover:border-line-strong hover:text-text',
                      )}
                    >
                      <input
                        type="radio"
                        name="instrument"
                        className="sr-only"
                        checked={on}
                        onChange={() => set('instrumentId', i.id)}
                      />
                      {i.symbol}
                      {n < 9 && <Kbd>{n + 1}</Kbd>}
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <Segmented
              label="Direction"
              size="lg"
              value={form.direction}
              onChange={(v) => {
                set('direction', v);
                entryInput.current?.focus();
              }}
              options={[
                {
                  value: 'BUY',
                  label: (
                    <>
                      <ArrowUpRight className="size-5" aria-hidden /> BUY / long <Kbd>B</Kbd>
                    </>
                  ),
                  activeClassName: 'bg-buy-soft text-buy font-bold',
                },
                {
                  value: 'SELL',
                  label: (
                    <>
                      <ArrowDownRight className="size-5" aria-hidden /> SELL / short <Kbd>S</Kbd>
                    </>
                  ),
                  activeClassName: 'bg-sell-soft text-sell font-bold',
                },
              ]}
            />

            <div>
              <div className="mb-1.5 flex items-center justify-between gap-3">
                <span className="text-[13px] font-medium text-muted" id="entry-type-label">
                  Entry
                </span>
                <Segmented
                  label="Entry type"
                  value={form.entryType}
                  onChange={(v) => set('entryType', v)}
                  className="w-44"
                  options={[
                    { value: 'SINGLE', label: 'Price' },
                    { value: 'RANGE', label: 'Range' },
                  ]}
                />
              </div>
              <div className={clsx('grid gap-3', form.entryType === 'RANGE' && 'grid-cols-2')}>
                <Field
                  label={form.entryType === 'RANGE' ? 'Lower price' : 'Entry price'}
                  error={fieldError('entryLow')}
                >
                  {(c) => (
                    <Input
                      {...c}
                      ref={entryInput}
                      autoFocus
                      className="num h-12 text-lg font-semibold"
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder={spec ? `e.g. ${Number(1).toFixed(spec.pricePrecision).replace('1', '3300')}` : ''}
                      value={form.entryLow}
                      onChange={(e) => set('entryLow', e.target.value)}
                    />
                  )}
                </Field>
                {form.entryType === 'RANGE' && (
                  <Field label="Upper price" error={fieldError('entryHigh')}>
                    {(c) => (
                      <Input
                        {...c}
                        className="num h-12 text-lg font-semibold"
                        inputMode="decimal"
                        autoComplete="off"
                        value={form.entryHigh}
                        onChange={(e) => set('entryHigh', e.target.value)}
                      />
                    )}
                  </Field>
                )}
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Targets and stop-loss"
              description={
                computed.upcoming
                  ? 'Set when you activate the trade.'
                  : form.custom
                  ? 'Using your own prices.'
                  : spec
                    ? `Automatic: ${formatPoints(spec.defaultTargetPoints)} pts target, ${formatPoints(spec.defaultStopPoints)} pts stop. 1 pt = ${spec.pointSize} ${spec.quoteCurrency} on ${spec.symbol}.`
                    : undefined
              }
              action={
                mode === 'advanced' && !computed.upcoming ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (!form.custom && computed.auto) {
                        const [a = '', b = '', c = ''] = computed.auto.targets;
                        setForm((f) => ({
                          ...f,
                          custom: true,
                          targets: [a, b, c],
                          stopLoss: computed.auto?.stopLoss ?? '',
                        }));
                      } else {
                        setForm((f) => ({ ...f, custom: !f.custom }));
                      }
                    }}
                  >
                    {form.custom ? 'Use Automatic Levels' : ACTIONS.editLevelsManually}
                  </Button>
                ) : undefined
              }
            />
            <div className="border-t border-line px-4 py-4 sm:px-5">
              {form.entryType === 'RANGE' && (
                <div className="mb-4">
                  <Segmented<'NOW' | 'LATER'>
                    label="When to set them"
                    value={form.levelsLater ? 'LATER' : 'NOW'}
                    onChange={(v) => set('levelsLater', v === 'LATER')}
                    options={[
                      { value: 'NOW', label: 'Now' },
                      { value: 'LATER', label: 'At activation' },
                    ]}
                  />
                </div>
              )}
              {computed.upcoming ? (
                <p className="text-sm text-muted">
                  Subscribers see an upcoming trade with this entry zone. Enter the final entry, targets and stop-loss
                  when you activate it.
                </p>
              ) : !form.direction || !computed.entry ? (
                <p className="text-sm text-muted">Choose a direction and enter a price, and the levels appear here.</p>
              ) : form.custom ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {Array.from({ length: MAX_TARGETS }, (_, i) => (
                    <Field key={i} label={`Target ${i + 1}`} error={fieldError(`targets.${i}`)}>
                      {(c) => (
                        <Input
                          {...c}
                          className="num"
                          inputMode="decimal"
                          value={form.targets[i]}
                          onChange={(e) => {
                            const next = [...form.targets] as FormState['targets'];
                            next[i] = e.target.value;
                            set('targets', next);
                          }}
                        />
                      )}
                    </Field>
                  ))}
                  <Field label="Stop-loss" error={fieldError('stopLoss')}>
                    {(c) => (
                      <Input
                        {...c}
                        className="num"
                        inputMode="decimal"
                        value={form.stopLoss}
                        onChange={(e) => set('stopLoss', e.target.value)}
                      />
                    )}
                  </Field>
                </div>
              ) : (
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
                  {computed.auto?.targets.map((t, i) => (
                    <div key={i}>
                      <dt className="text-xs text-muted">Target {i + 1}</dt>
                      <dd className="num text-lg font-semibold">{spec ? formatPrice(spec, t) : t}</dd>
                    </div>
                  ))}
                  <div>
                    <dt className="text-xs text-muted">Stop-loss</dt>
                    <dd className="num text-lg font-semibold text-stop">
                      {spec ? formatPrice(spec, computed.auto?.stopLoss ?? '0') : ''}
                    </dd>
                  </div>
                </dl>
              )}
              {!form.custom && !computed.upcoming && computed.auto && (
                <details className="mt-3 text-[13px] text-muted">
                  <summary className="cursor-pointer select-none">How this was calculated</summary>
                  <ul className="num mt-1.5 flex flex-col gap-0.5 text-xs">
                    {computed.auto.explanation.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                  {computed.entry?.type === 'RANGE' && (
                    <p className="mt-1.5">
                      For a range, the target is measured from the far edge in the profit direction and the stop from
                      the far edge against it.
                    </p>
                  )}
                </details>
              )}
              {generalIssues.length > 0 && (
                <ul role="alert" className="mt-3 flex flex-col gap-1 text-[13px] text-stop">
                  {generalIssues.map((i) => (
                    <li key={`${i.field}-${i.code}`}>{i.message}</li>
                  ))}
                </ul>
              )}
            </div>
          </Card>

          <Card className="flex flex-col gap-4 p-4 sm:p-5">
            {!computed.upcoming && (
            <Labeled
              label="Starts as"
              hint={
                startsActive
                  ? 'Active as soon as it is published. That is not a fill.'
                  : 'Waits for entry. Activate it from the trade page when the entry is reached.'
              }
            >
              <Segmented<'AWAITING_ENTRY' | 'ACTIVE'>
                label="Starts as"
                value={startsActive ? 'ACTIVE' : 'AWAITING_ENTRY'}
                onChange={(v) => set('startAs', v === defaultMode ? 'DEFAULT' : v)}
                options={[
                  {
                    value: 'AWAITING_ENTRY',
                    label: `Awaiting entry${defaultMode === 'AWAITING_ENTRY' ? ' (default)' : ''}`,
                  },
                  { value: 'ACTIVE', label: `Active now${defaultMode === 'ACTIVE' ? ' (default)' : ''}` },
                ]}
              />
            </Labeled>
            )}
            {!startsActive && (
              <div className={clsx('grid gap-4', form.window === 'CUSTOM' && 'sm:grid-cols-2')}>
                <Field
                  label="Entry window"
                  hint="If it is not activated in time, it is cancelled automatically and subscribers are told not to enter."
                >
                  {(c) => (
                    <Select {...c} value={form.window} onChange={(e) => set('window', e.target.value)}>
                      <option value="DEFAULT">
                        {defaultWindow > 0 ? `${entryWindowLabel(defaultWindow)} (default)` : 'No limit (default)'}
                      </option>
                      {windowOptions.map((m) => (
                        <option key={m} value={String(m)}>
                          {entryWindowLabel(m)}
                        </option>
                      ))}
                      {defaultWindow > 0 && <option value="NONE">No limit</option>}
                      <option value="CUSTOM">Until a set time…</option>
                    </Select>
                  )}
                </Field>
                {form.window === 'CUSTOM' && (
                  <Field label="Cancel if not active by">
                    {(c) => (
                      <Input
                        {...c}
                        type="datetime-local"
                        value={form.deadline}
                        onChange={(e) => set('deadline', e.target.value)}
                      />
                    )}
                  </Field>
                )}
              </div>
            )}
          </Card>

          {mode === 'advanced' && (
            <Card className="flex flex-col gap-4 p-4 sm:p-5">
              <div className="rounded-lg border border-line px-3">
                <Switch
                  label="Priority"
                  description="Means time-critical: louder alerts for subscribers. It says nothing about how likely the trade is to work."
                  checked={form.priority === 'PRIORITY'}
                  onChange={(v) => set('priority', v ? 'PRIORITY' : 'NORMAL')}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Template">
                  {(c) => (
                    <Select {...c} value={form.templateId} onChange={(e) => set('templateId', e.target.value)}>
                      <option value="">Automatic</option>
                      {signalTemplates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.favorite ? '★ ' : ''}
                          {t.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </div>
              <Field label="Commentary" hint="Optional. Shown to subscribers with the signal.">
                {(c) => (
                  <Textarea
                    {...c}
                    rows={2}
                    maxLength={1000}
                    value={form.commentary}
                    onChange={(e) => set('commentary', e.target.value)}
                  />
                )}
              </Field>
            </Card>
          )}

          <div className="sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom)+8px)] z-20 flex items-center gap-2 lg:bottom-3">
            <Button type="submit" variant="primary" size="lg" disabled={!canReview} className="flex-1 shadow-float">
              Review and publish <Kbd>Enter</Kbd>
            </Button>
            <Button
              size="lg"
              className="shadow-float"
              loading={saveDraft.isPending}
              onClick={() => saveDraft.mutate()}
              disabled={!form.instrumentId}
            >
              Save draft
            </Button>
          </div>
        </form>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-7 lg:self-start" aria-label="Preview">
          <Card>
            <CardHeader title="What subscribers will see" />
            <div className="border-t border-line p-3">
              {previewEvent ? <FeedCard event={previewEvent} /> : <Skeleton className="h-36 w-full" />}
            </div>
          </Card>
          {computed.risk && spec && computed.entry && (
            <Card>
              <CardHeader
                title="Distances"
                description={
                  computed.risk.isRange
                    ? `From the least favourable entry in the range (${formatPrice(spec, computed.risk.referenceEntry)}).`
                    : undefined
                }
              />
              <dl className="flex flex-col border-t border-line px-4 py-3 text-sm sm:px-5">
                <div className="flex justify-between gap-3 py-1">
                  <dt className="text-muted">To stop-loss</dt>
                  <dd className="num">
                    {formatPoints(computed.risk.stopPoints)} pts{' '}
                    <span className="text-muted">
                      ·{' '}
                      {toDec(computed.risk.stopDistance)
                        .dividedBy(toDec(computed.risk.referenceEntry))
                        .times(100)
                        .toFixed(2)}
                      %
                    </span>
                  </dd>
                </div>
                {computed.risk.targets.map((t) => (
                  <div key={t.index} className="flex justify-between gap-3 py-1">
                    <dt className="text-muted">To target {t.index}</dt>
                    <dd className="num">
                      {formatPoints(t.points)} pts <span className="text-muted">· ratio {t.rewardToRisk}</span>
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="border-t border-line px-4 py-2.5 text-xs leading-relaxed text-subtle sm:px-5">
                Target distance divided by stop distance. Geometry only: it says nothing about probability or payoff.
              </p>
            </Card>
          )}
        </aside>
      </div>

      <Dialog
        open={reviewOpen}
        onOpenChange={(open) => {
          setReviewOpen(open);
          if (!open) publish.reset();
        }}
        title="Publish this signal?"
        description="It goes to every active subscriber straight away. Later changes are shown as updates; a published signal cannot be edited silently."
      >
        <div className="flex flex-col gap-4">
          {previewEvent && <FeedCard event={previewEvent} />}
          {previewEvent && (
            <div className="rounded-lg bg-bg p-3">
              <p className="text-xs font-medium text-muted">Message text</p>
              <p className="mt-1 text-sm font-semibold">{previewEvent.title}</p>
              <p className="mt-0.5 whitespace-pre-line text-sm text-muted">{previewEvent.body}</p>
            </div>
          )}
          {duplicate ? (
            <div className="rounded-lg bg-update-soft p-3 text-sm text-update" role="alert">
              <p className="font-semibold">Possible duplicate</p>
              <p className="mt-0.5">{duplicate.message}</p>
              {duplicate.details?.tradeId && (
                <Link
                  href={`/admin/trades/${duplicate.details.tradeId}`}
                  className="mt-1 inline-block underline underline-offset-2"
                >
                  Open {duplicate.details.ref}
                </Link>
              )}
            </div>
          ) : (
            <FormError error={publish.error} />
          )}
          <Button
            autoFocus
            variant="primary"
            size="lg"
            loading={publish.isPending}
            onClick={() => publish.mutate(duplicate !== null)}
          >
            {duplicate ? 'Publish anyway' : 'Publish now'}
          </Button>
        </div>
      </Dialog>
    </>
  );
}

function Published({ trade, onAnother }: { trade: AdminTradeDetail; onAnother: () => void }) {
  const live = useQuery({
    queryKey: ['admin', 'trade', trade.id],
    queryFn: () => api.get<AdminTradeDetail>(`/admin/trades/${trade.id}`),
    initialData: trade,
    refetchInterval: (query) => {
      const stage = query.state.data?.events[0]?.dispatch?.stage;
      return stage === 'COMPLETED' || stage === 'FAILED' ? false : 1000;
    },
  });
  const event = live.data.events[0];
  return (
    <div className="mx-auto max-w-xl pt-6">
      <div role="status">
        <CheckCircle2 className="size-9 text-success" aria-hidden />
        <h1 className="mt-3 text-[22px] font-semibold tracking-tight">
          Published as <span className="num">{live.data.ref}</span>
        </h1>
        <p className="mt-1 text-sm text-muted">
          {live.data.status === 'PUBLISHED' && live.data.stopLoss === null
            ? 'Subscribers see it as an upcoming trade. Activate it from the trade page with its final entry, targets and stop-loss.'
            : live.data.status === 'PUBLISHED'
            ? live.data.entryExpiresAt
              ? `It is in every active subscriber’s feed, awaiting entry. If it is not activated by ${formatDateTime(live.data.entryExpiresAt)}, it is cancelled automatically.`
              : 'It is in every active subscriber’s feed, awaiting entry. Activate it from the trade page when the entry is reached.'
            : 'It is now in every active subscriber’s feed, and the trade is active straight away.'}
        </p>
      </div>
      <Card className="mt-4 p-4">
        <p className="text-sm font-semibold">{event?.title}</p>
        <p className="mt-0.5 whitespace-pre-line text-sm text-muted">{event?.body}</p>
        <div className="mt-3 border-t border-line pt-3">
          <DispatchStatus dispatch={event?.dispatch ?? null} />
          <p className="mt-2 text-xs text-subtle">
            &ldquo;Accepted&rdquo; means a push service took the message. Browsers do not report whether a person saw
            it.
          </p>
        </div>
      </Card>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link href={`/admin/trades/${trade.id}`} className={buttonClass('primary', 'lg')}>
          <ExternalLink className="size-4" aria-hidden /> Open trade
        </Link>
        <Button size="lg" autoFocus onClick={onAnother}>
          <Plus className="size-4" aria-hidden /> Publish another <Kbd>N</Kbd>
        </Button>
      </div>
    </div>
  );
}

export default function ComposePage() {
  return (
    <Suspense>
      <Composer />
    </Suspense>
  );
}

'use client';

import {
  type AdminTradeDetail,
  BASIS_LABELS,
  type CalculationBasis,
  CLOSE_REASON_LABELS,
  CLOSE_REASONS,
  type CloseReason,
  defaultExitBasis,
  formatPoints,
  formatPrice,
  isDecimalLiteral,
  type PlatformSettings,
  previewExit,
  remainingFraction,
  toDec,
  trailStopPrice,
  type InstrumentSpec,
  type TrailingStopWording,
} from '@signaldesk/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button, Dialog, Field, FormError, Input, Segmented, Select, Textarea } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { money, signedPoints } from '@/lib/format';

export type ActionKind =
  | 'ACTIVATE'
  | 'RECORD_EXECUTION'
  | 'MOVE_STOP'
  | 'MOVE_STOP_BREAKEVEN'
  | 'TRAIL_STOP'
  | 'TARGET_HIT'
  | 'MODIFY_TARGETS'
  | 'BOOK_PARTIAL'
  | 'CLOSE'
  | 'URGENT'
  | 'CANCEL'
  | 'EXPIRE'
  | 'CORRECT';

const TITLES: Record<ActionKind, string> = {
  ACTIVATE: 'Activate trade',
  RECORD_EXECUTION: 'Record my execution',
  MOVE_STOP: 'Move stop-loss',
  MOVE_STOP_BREAKEVEN: 'Move stop-loss to breakeven',
  TRAIL_STOP: 'Trail stop-loss',
  TARGET_HIT: 'Mark target reached',
  MODIFY_TARGETS: 'Change remaining targets',
  BOOK_PARTIAL: 'Book partial profit',
  CLOSE: 'Close trade',
  URGENT: 'Send urgent instruction',
  CANCEL: 'Cancel signal',
  EXPIRE: 'Mark as expired without entry',
  CORRECT: 'Correct a published error',
};

const INTERNAL: ActionKind[] = ['RECORD_EXECUTION'];

function specOf(trade: AdminTradeDetail): Pick<InstrumentSpec, 'pricePrecision' | 'pointSize'> & InstrumentSpec {
  return {
    symbol: trade.symbol,
    displayName: trade.displayName,
    assetClass: '',
    quoteCurrency: trade.quoteCurrency,
    pricePrecision: trade.pricePrecision,
    tickSize: trade.tickSize,
    pointSize: trade.pointSize,
    defaultTargetPoints: '0',
    defaultStopPoints: '0',
    defaultTarget2Points: null,
    defaultTarget3Points: null,
    contractMultiplier: trade.contractMultiplier,
    unitLabel: trade.unitLabel,
  };
}

interface Props {
  trade: AdminTradeDetail;
  kind: ActionKind;
  targetIndex?: number;
  onClose: () => void;
}

/** A single dialog for every action, so each is two taps from the trade and always shows its effect. */
export function ActionDialog({ trade, kind, targetIndex, onClose }: Props) {
  const client = useQueryClient();
  // One key for this dialog: pressing twice, or retrying after a timeout, applies the action once.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  // The version on screen when this opened. If the trade moves on, sending must fail, not follow it.
  const [expectedVersion] = useState(trade.version);
  const [confirmWiden, setConfirmWiden] = useState(false);

  const run = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post<{ trade: AdminTradeDetail }>(`/admin/trades/${trade.id}/events`, {
        action: kind,
        expectedVersion,
        idempotencyKey,
        ...body,
      }),
    onSuccess: (result) => {
      client.setQueryData(['admin', 'trade', trade.id], result.trade);
      void client.invalidateQueries({ queryKey: ['admin'] });
      toast.success(
        INTERNAL.includes(kind) ? 'Recorded. Subscribers are not notified of this.' : 'Published to subscribers',
      );
      onClose();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'STALE_VERSION') {
        toast.warning('This trade just changed. Check the latest state and try again.');
        void client.invalidateQueries({ queryKey: ['admin', 'trade', trade.id] });
        onClose();
      }
      if (error instanceof ApiError && error.code === 'WIDENS_RISK') setConfirmWiden(true);
    },
  });

  const shared = {
    trade,
    run: (body: Record<string, unknown>) => run.mutate(body),
    pending: run.isPending,
    error: run.error,
    confirmWiden,
  };
  let form: ReactNode;
  switch (kind) {
    case 'ACTIVATE':
      form = <ActivateForm {...shared} />;
      break;
    case 'RECORD_EXECUTION':
      form = <ExecutionForm {...shared} />;
      break;
    case 'MOVE_STOP':
      form = <MoveStopForm {...shared} />;
      break;
    case 'MOVE_STOP_BREAKEVEN':
      form = <BreakevenForm {...shared} />;
      break;
    case 'TRAIL_STOP':
      form = <TrailForm {...shared} />;
      break;
    case 'TARGET_HIT':
      form = <TargetHitForm {...shared} initial={targetIndex} />;
      break;
    case 'MODIFY_TARGETS':
      form = <TargetsForm {...shared} />;
      break;
    case 'BOOK_PARTIAL':
      form = <ExitForm {...shared} final={false} />;
      break;
    case 'CLOSE':
      form = <ExitForm {...shared} final />;
      break;
    case 'URGENT':
      form = <UrgentForm {...shared} />;
      break;
    case 'CANCEL':
    case 'EXPIRE':
      form = <CommentOnlyForm {...shared} kind={kind} />;
      break;
    case 'CORRECT':
      form = <CorrectForm {...shared} />;
      break;
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={TITLES[kind]}
      wide={kind === 'CLOSE' || kind === 'BOOK_PARTIAL' || kind === 'CORRECT'}
      description={
        <>
          {trade.direction} {trade.symbol} · <span className="num">{trade.ref}</span> · Stop-loss{' '}
          <span className="num">{formatPrice(trade, trade.stopLoss)}</span>
        </>
      }
    >
      {form}
    </Dialog>
  );
}

interface FormProps {
  trade: AdminTradeDetail;
  run: (body: Record<string, unknown>) => void;
  pending: boolean;
  error: unknown;
  confirmWiden: boolean;
}

function Actions({
  pending,
  error,
  label,
  disabled,
  danger,
  note,
}: {
  pending: boolean;
  error: unknown;
  label: string;
  disabled?: boolean;
  danger?: boolean;
  note?: ReactNode;
}) {
  const hideError = error instanceof ApiError && (error.code === 'WIDENS_RISK' || error.code === 'STALE_VERSION');
  return (
    <>
      {!hideError && <FormError error={error} />}
      {note && <p className="text-xs text-subtle">{note}</p>}
      <Button
        type="submit"
        variant={danger ? 'danger' : 'primary'}
        size="lg"
        loading={pending}
        disabled={disabled}
        autoFocus={false}
      >
        {label}
      </Button>
    </>
  );
}

function CommentField({ value, onChange, hint }: { value: string; onChange: (v: string) => void; hint?: string }) {
  return (
    <Field label="Comment" hint={hint ?? 'Optional. Shown to subscribers.'}>
      {(c) => <Textarea {...c} rows={2} maxLength={1000} value={value} onChange={(e) => onChange(e.target.value)} />}
    </Field>
  );
}

function PriceInput({
  label,
  value,
  onChange,
  hint,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: ReactNode;
  autoFocus?: boolean;
}) {
  return (
    <Field label={label} hint={hint}>
      {(c) => (
        <Input
          {...c}
          className="num text-base font-semibold"
          inputMode="decimal"
          autoComplete="off"
          autoFocus={autoFocus}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  );
}

const optional = (value: string) => value.trim() || undefined;

function ActivateForm({ trade, run, pending, error }: FormProps) {
  const [entry, setEntry] = useState('');
  const [quantity, setQuantity] = useState('');
  const [comment, setComment] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run({ actualEntry: optional(entry), quantity: optional(quantity), comment: optional(comment) });
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        Tells subscribers the entry is live. A published signal never activates on its own.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <PriceInput
          label="My actual entry"
          value={entry}
          onChange={setEntry}
          hint="Optional. Without it, results cannot be declared as an execution."
        />
        <PriceInput
          label={`Quantity (${trade.unitLabel})`}
          value={quantity}
          onChange={setQuantity}
          hint="Optional. Private: never shown to subscribers."
        />
      </div>
      <CommentField value={comment} onChange={setComment} />
      <Actions pending={pending} error={error} label="Activate and notify" />
    </form>
  );
}

function ExecutionForm({ trade, run, pending, error }: FormProps) {
  const [entry, setEntry] = useState(trade.execution?.entryPrice ?? '');
  const [quantity, setQuantity] = useState(trade.execution?.quantity ?? '');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run({ actualEntry: entry.trim(), quantity: optional(quantity) });
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        Your own fill, for internal results. It stays private and is labelled as declared by you, not independently
        verified.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <PriceInput label="Actual entry" value={entry} onChange={setEntry} autoFocus />
        <PriceInput
          label={`Quantity (${trade.unitLabel})`}
          value={quantity}
          onChange={setQuantity}
          hint="Needed for a monetary result."
        />
      </div>
      <Actions pending={pending} error={error} label="Save record" disabled={!isDecimalLiteral(entry.trim())} />
    </form>
  );
}

function MoveStopForm({ trade, run, pending, error, confirmWiden }: FormProps) {
  const [price, setPrice] = useState('');
  const [comment, setComment] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run({ price: price.trim(), comment: optional(comment), allowWiden: confirmWiden });
  };
  const widen = (
    <div role="alert" className="rounded-lg bg-update-soft p-3 text-sm text-update">
      <p className="font-semibold">This increases risk</p>
      <p>
        The new stop-loss is further from the trade than the current one ({formatPrice(trade, trade.stopLoss)}). Press
        the button again to confirm.
      </p>
    </div>
  );
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <PriceInput
        label="New stop-loss"
        value={price}
        onChange={setPrice}
        autoFocus
        hint={
          <>
            Currently <span className="num">{formatPrice(trade, trade.stopLoss)}</span>. The original stays in the
            history.
          </>
        }
      />
      <CommentField value={comment} onChange={setComment} />
      {confirmWiden && widen}
      <Actions
        pending={pending}
        error={error}
        label={confirmWiden ? 'Yes, widen and notify' : 'Move and notify'}
        danger={confirmWiden}
        disabled={!isDecimalLiteral(price.trim())}
      />
    </form>
  );
}

function BreakevenForm({ trade, run, pending, error }: FormProps) {
  const known = trade.execution?.entryPrice ?? (trade.entryType === 'SINGLE' ? trade.entryLow : null);
  const [price, setPrice] = useState('');
  const [comment, setComment] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run({ price: known ? undefined : price.trim(), comment: optional(comment) });
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {known ? (
        <p className="text-sm">
          The stop-loss moves from <span className="num font-semibold">{formatPrice(trade, trade.stopLoss)}</span> to{' '}
          <span className="num font-semibold text-stop">{formatPrice(trade, known)}</span>
          {trade.execution ? ', your recorded entry.' : ', the recommended entry.'}
        </p>
      ) : (
        <PriceInput
          label="Breakeven price"
          value={price}
          onChange={setPrice}
          autoFocus
          hint="This signal recommended a range and has no recorded entry, so state the price."
        />
      )}
      <CommentField value={comment} onChange={setComment} />
      <Actions
        pending={pending}
        error={error}
        label="Move and notify"
        disabled={!known && !isDecimalLiteral(price.trim())}
      />
    </form>
  );
}

function TrailForm({ trade, run, pending, error }: FormProps) {
  const settings = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: () => api.get<PlatformSettings>('/admin/settings'),
  });
  const [by, setBy] = useState<'DISTANCE' | 'PRICE'>('DISTANCE');
  const [reference, setReference] = useState('');
  const [points, setPoints] = useState('');
  const [price, setPrice] = useState('');
  const [chosen, setChosen] = useState<TrailingStopWording | null>(null);
  const [comment, setComment] = useState('');
  const spec = specOf(trade);
  const wording: TrailingStopWording =
    by === 'PRICE' ? 'GENERAL' : (chosen ?? settings.data?.trailingStopWording ?? 'GENERAL');
  const computed = useMemo(() => {
    if (by === 'PRICE') return isDecimalLiteral(price.trim()) ? toDec(price.trim()) : null;
    return trailStopPrice(spec, trade.direction, reference, points);
  }, [by, points, price, reference, spec, trade.direction]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(
      by === 'PRICE'
        ? { price: price.trim(), comment: optional(comment) }
        : { referencePrice: reference.trim(), trailPoints: points.trim(), wording, comment: optional(comment) },
    );
  };
  const next = computed ? formatPrice(trade, computed) : null;
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        This platform has no market data. It records the instruction at the price you give, and does not move the stop
        by itself afterwards.
      </p>
      <Segmented<'DISTANCE' | 'PRICE'>
        label="Trail by"
        value={by}
        onChange={setBy}
        options={[
          { value: 'DISTANCE', label: 'Distance from price' },
          { value: 'PRICE', label: 'New stop-loss' },
        ]}
      />
      {by === 'DISTANCE' ? (
        <div className="grid grid-cols-2 gap-3">
          <PriceInput label="Current market price" value={reference} onChange={setReference} autoFocus />
          <PriceInput
            label="Trail distance (points)"
            value={points}
            onChange={setPoints}
            hint={`1 pt = ${trade.pointSize} ${trade.quoteCurrency}`}
          />
        </div>
      ) : (
        <PriceInput label="New stop-loss" value={price} onChange={setPrice} autoFocus />
      )}
      {by === 'DISTANCE' && (
        <Field label="Alert wording">
          {(c) => (
            <Select {...c} value={wording} onChange={(e) => setChosen(e.target.value as TrailingStopWording)}>
              <option value="GENERAL">General: the new stop-loss only</option>
              <option value="DETAILED">Detailed: also the distance in points</option>
            </Select>
          )}
        </Field>
      )}
      {next && (
        <div className="rounded-lg bg-bg p-3 text-sm">
          <p>
            New stop-loss: <span className="num font-semibold text-stop">{next}</span>{' '}
            <span className="text-muted">(was {formatPrice(trade, trade.stopLoss)})</span>
          </p>
          <p className="mt-1 text-[13px] text-muted">
            Subscribers read:{' '}
            {wording === 'GENERAL'
              ? `“Trail the stop-loss on trade ${trade.ref} to ${next}.”`
              : `“Stop-loss on trade ${trade.ref} trailed from ${formatPrice(trade, trade.stopLoss)} to ${next} (${formatPoints(points.trim() || '0')} pts from ${formatPrice(trade, reference.trim() || '0')}).”`}
          </p>
        </div>
      )}
      <CommentField value={comment} onChange={setComment} />
      <Actions pending={pending} error={error} label="Trail and notify" disabled={!computed} />
    </form>
  );
}

function TargetHitForm({ trade, run, pending, error, initial }: FormProps & { initial?: number }) {
  const open = trade.targets.filter((t) => t.status === 'OPEN');
  const [index, setIndex] = useState(initial ?? open[0]?.index ?? 1);
  const [comment, setComment] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run({ targetIndex: index, comment: optional(comment) });
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label="Target reached" hint="Any earlier targets are marked as reached too.">
        {(c) => (
          <Select {...c} value={index} onChange={(e) => setIndex(Number(e.target.value))}>
            {open.map((t) => (
              <option key={t.index} value={t.index}>
                Target {t.index} at {formatPrice(trade, t.price)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <CommentField value={comment} onChange={setComment} />
      <Actions pending={pending} error={error} label="Mark reached and notify" disabled={open.length === 0} />
    </form>
  );
}

function TargetsForm({ trade, run, pending, error }: FormProps) {
  const hit = trade.targets.filter((t) => t.status === 'HIT');
  const open = trade.targets.filter((t) => t.status === 'OPEN').map((t) => t.price);
  const slots = 3 - hit.length;
  const [values, setValues] = useState<string[]>(Array.from({ length: slots }, (_, i) => open[i] ?? ''));
  const [comment, setComment] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run({ targets: values.map((v) => v.trim()).filter(Boolean), comment: optional(comment) });
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {hit.length > 0 && (
        <p className="text-sm text-muted">
          Reached targets stay as they are: {hit.map((t) => formatPrice(trade, t.price)).join(', ')}.
        </p>
      )}
      <div className="grid grid-cols-3 gap-3">
        {values.map((value, i) => (
          <PriceInput
            key={i}
            label={`Target ${hit.length + i + 1}`}
            value={value}
            autoFocus={i === 0}
            onChange={(v) => {
              const next = [...values];
              next[i] = v;
              setValues(next);
            }}
          />
        ))}
      </div>
      <CommentField value={comment} onChange={setComment} />
      <Actions pending={pending} error={error} label="Change and notify" />
    </form>
  );
}

function ExitForm({ trade, run, pending, error, final }: FormProps & { final: boolean }) {
  const defaultBasis = defaultExitBasis(trade);
  const [exitPrice, setExitPrice] = useState('');
  const [reason, setReason] = useState<CloseReason>('MANUAL');
  const [basis, setBasis] = useState<CalculationBasis>(defaultBasis);
  const [hypothetical, setHypothetical] = useState(trade.entryType === 'SINGLE' ? trade.entryLow : '');
  const [fees, setFees] = useState('');
  const [percent, setPercent] = useState('50');
  const [comment, setComment] = useState('');
  const [exitedAt, setExitedAt] = useState('');
  const hasBasisLocked = trade.closures.some((c) => !c.superseded);
  const openTargets = trade.targets.filter((t) => t.status === 'OPEN');

  const remaining = remainingFraction(trade);
  const exit = useMemo(
    () => previewExit({ trade, basis, exitPrice, hypotheticalEntry: hypothetical, fees, final, percent }),
    [basis, exitPrice, fees, final, hypothetical, percent, trade],
  );
  const preview = exit?.result ?? null;
  const quantity = exit?.quantity ?? null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    run({
      exitPrice: exitPrice.trim(),
      basis,
      fees: basis === 'ADMIN_DECLARED_EXECUTION' ? optional(fees) : undefined,
      hypotheticalEntry:
        basis === 'HYPOTHETICAL_OUTCOME' && trade.entryType === 'RANGE' ? optional(hypothetical) : undefined,
      exitedAt: exitedAt ? new Date(exitedAt).toISOString() : undefined,
      comment: optional(comment),
      ...(final ? { reason, confirm: true } : { percent: percent.trim() }),
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {final && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Quick fill">
          {openTargets.map((t) => (
            <Button
              key={t.index}
              size="sm"
              onClick={() => {
                setExitPrice(t.price);
                setReason('TARGET_ACHIEVED');
              }}
            >
              At target {t.index} ({formatPrice(trade, t.price)})
            </Button>
          ))}
          <Button
            size="sm"
            onClick={() => {
              setExitPrice(trade.stopLoss);
              setReason('STOP_LOSS_HIT');
            }}
          >
            At stop-loss ({formatPrice(trade, trade.stopLoss)})
          </Button>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <PriceInput label="Exit price" value={exitPrice} onChange={setExitPrice} autoFocus />
        {final ? (
          <Field label="Reason">
            {(c) => (
              <Select {...c} value={reason} onChange={(e) => setReason(e.target.value as CloseReason)}>
                {CLOSE_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {CLOSE_REASON_LABELS[r]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : (
          <Field
            label="Portion of the original position (%)"
            hint={`${remaining.times(100).toDecimalPlaces(2).toFixed()}% still open.`}
          >
            {(c) => (
              <Input
                {...c}
                className="num"
                inputMode="decimal"
                value={percent}
                onChange={(e) => setPercent(e.target.value)}
              />
            )}
          </Field>
        )}
      </div>
      <Field
        label="What is this result based on?"
        hint={hasBasisLocked ? 'Fixed by the earlier exit on this trade: bases cannot be mixed.' : undefined}
      >
        {(c) => (
          <Select
            {...c}
            value={basis}
            disabled={hasBasisLocked}
            onChange={(e) => setBasis(e.target.value as CalculationBasis)}
          >
            <option value="HYPOTHETICAL_OUTCOME">{BASIS_LABELS.HYPOTHETICAL_OUTCOME}</option>
            <option value="ADMIN_DECLARED_EXECUTION" disabled={!trade.execution}>
              {BASIS_LABELS.ADMIN_DECLARED_EXECUTION}
              {trade.execution ? '' : ' (record your execution first)'}
            </option>
            <option value="NONE">{BASIS_LABELS.NONE}: record the exit only</option>
          </Select>
        )}
      </Field>
      {basis === 'HYPOTHETICAL_OUTCOME' && trade.entryType === 'RANGE' && (
        <PriceInput
          label="Measure from which entry?"
          value={hypothetical}
          onChange={setHypothetical}
          hint={`Must be within ${formatPrice(trade, trade.entryLow)} to ${formatPrice(trade, trade.entryHigh)}. A range is never assumed to be a fill.`}
        />
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {basis === 'ADMIN_DECLARED_EXECUTION' && quantity && (
          <Field label={`Fees (${trade.quoteCurrency})`} hint="Optional.">
            {(c) => (
              <Input
                {...c}
                className="num"
                inputMode="decimal"
                value={fees}
                onChange={(e) => setFees(e.target.value)}
              />
            )}
          </Field>
        )}
        <Field label="Exit time" hint="Optional. Leave empty for now.">
          {(c) => <Input {...c} type="datetime-local" value={exitedAt} onChange={(e) => setExitedAt(e.target.value)} />}
        </Field>
      </div>
      <CommentField value={comment} onChange={setComment} />
      <div className="rounded-lg bg-bg p-3 text-sm" aria-live="polite">
        <p className="text-xs font-medium text-muted">What will be recorded</p>
        {!preview && <p className="mt-1 text-muted">Enter an exit price to see the result.</p>}
        {preview && (
          <dl className="mt-1 flex flex-col gap-0.5">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Move</dt>
              <dd className="num">{preview.points ? signedPoints(preview.points) : 'Not measured'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Monetary result</dt>
              <dd className="num">
                {preview.netPnl ? money(preview.netPnl, trade.quoteCurrency) : 'None: no position recorded'}
              </dd>
            </div>
          </dl>
        )}
        {preview?.points && (
          <p className="mt-2 text-xs text-subtle">
            Subscribers see the move and its basis. Quantity, fees and money stay private.
          </p>
        )}
      </div>
      <Actions
        pending={pending}
        error={error}
        label={final ? 'Close trade and notify' : 'Book partial and notify'}
        disabled={!isDecimalLiteral(exitPrice.trim())}
        danger={final}
      />
    </form>
  );
}

function UrgentForm({ run, pending, error }: FormProps) {
  const [message, setMessage] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run({ message: message.trim() });
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label="Instruction" hint="Sent right away and marked as priority.">
        {(c) => (
          <Textarea
            {...c}
            rows={3}
            maxLength={1000}
            autoFocus
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        )}
      </Field>
      <Actions pending={pending} error={error} label="Send to subscribers" disabled={!message.trim()} />
    </form>
  );
}

function CommentOnlyForm({ run, pending, error, kind }: FormProps & { kind: 'CANCEL' | 'EXPIRE' }) {
  const [comment, setComment] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run({ comment: optional(comment) });
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <p className="text-sm text-muted">Subscribers are told not to enter this signal. This cannot be undone.</p>
      <CommentField value={comment} onChange={setComment} />
      <Actions
        pending={pending}
        error={error}
        label={kind === 'CANCEL' ? 'Cancel signal and notify' : 'Mark expired and notify'}
        danger
      />
    </form>
  );
}

function CorrectForm({ trade, run, pending, error }: FormProps) {
  const closed = trade.status === 'CLOSED';
  const currentClosures = trade.closures.filter((c) => !c.superseded);
  const [reason, setReason] = useState('');
  const [stop, setStop] = useState('');
  const [low, setLow] = useState('');
  const [high, setHigh] = useState('');
  const [targets, setTargets] = useState('');
  const [closureId, setClosureId] = useState(currentClosures[0]?.id ?? '');
  const [exitPrice, setExitPrice] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const hasExit = exitPrice.trim() !== '';
    run({
      reason: reason.trim(),
      stopLoss: optional(stop),
      entryLow: optional(low),
      entryHigh: optional(high),
      targets: targets.trim()
        ? targets
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean)
        : undefined,
      closureId: hasExit ? closureId : undefined,
      exitPrice: hasExit ? exitPrice.trim() : undefined,
    });
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        Subscribers see what changed, from what, to what, and why. The original record stays visible.
      </p>
      <Field label="Why is this being corrected?" required>
        {(c) => <Input {...c} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} />}
      </Field>
      {!closed && (
        <div className="grid gap-3 sm:grid-cols-2">
          <PriceInput
            label={trade.entryType === 'RANGE' ? 'Lower entry' : 'Entry'}
            value={low}
            onChange={setLow}
            hint={`Now ${formatPrice(trade, trade.entryLow)}`}
          />
          {trade.entryType === 'RANGE' && (
            <PriceInput
              label="Upper entry"
              value={high}
              onChange={setHigh}
              hint={`Now ${formatPrice(trade, trade.entryHigh)}`}
            />
          )}
          <PriceInput
            label="Stop-loss"
            value={stop}
            onChange={setStop}
            hint={`Now ${formatPrice(trade, trade.stopLoss)}`}
          />
          <Field label="Open targets" hint="Comma separated, nearest first.">
            {(c) => (
              <Input
                {...c}
                className="num"
                inputMode="decimal"
                value={targets}
                placeholder={trade.targets
                  .filter((t) => t.status === 'OPEN')
                  .map((t) => t.price)
                  .join(', ')}
                onChange={(e) => setTargets(e.target.value)}
              />
            )}
          </Field>
        </div>
      )}
      {currentClosures.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Exit record">
            {(c) => (
              <Select {...c} value={closureId} onChange={(e) => setClosureId(e.target.value)}>
                {currentClosures.map((closure) => (
                  <option key={closure.id} value={closure.id}>
                    {closure.kind === 'FINAL' ? 'Final exit' : 'Partial exit'} at{' '}
                    {formatPrice(trade, closure.exitPrice)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <PriceInput label="Correct exit price" value={exitPrice} onChange={setExitPrice} />
        </div>
      )}
      <Actions
        pending={pending}
        error={error}
        label="Publish correction"
        disabled={reason.trim().length < 3}
        note={`Point value on this trade: 1 pt = ${formatPoints(trade.pointSize)} ${trade.quoteCurrency}.`}
      />
    </form>
  );
}

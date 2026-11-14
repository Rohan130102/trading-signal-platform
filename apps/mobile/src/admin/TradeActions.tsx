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
  money,
  type PlatformSettings,
  previewCorrectedExit,
  previewExit,
  remainingFraction,
  signedPoints,
  toDec,
  type TrailingStopWording,
  trailStopPrice,
  canon,
  type InstrumentSpec,
  singleEntry,
  validateSignalLevels,
} from '@signaldesk/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useMemo, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { ApiError, api } from '@/lib/api';
import { newKey } from '@/lib/ids';
import { localTimeText, parseLocalTime } from '@/lib/local-time';
import { useColors } from '@/theme';
import { radius, space } from '@/theme/tokens';
import {
  Button,
  Chip,
  ChipRow,
  cleanPrice,
  Field,
  FormError,
  Notice,
  PriceField,
  Segmented,
  Sheet,
  T,
  useToast,
} from '@/ui';

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
  ACTIVATE: 'Activate Trade',
  RECORD_EXECUTION: 'Record my execution',
  MOVE_STOP: 'Update Stop-Loss',
  MOVE_STOP_BREAKEVEN: 'Stop-loss to breakeven',
  TRAIL_STOP: 'Trail stop-loss',
  TARGET_HIT: 'Mark target reached',
  MODIFY_TARGETS: 'Change remaining targets',
  BOOK_PARTIAL: 'Book partial profit',
  CLOSE: 'Close Trade',
  URGENT: 'Send urgent instruction',
  CANCEL: 'Cancel signal',
  EXPIRE: 'Mark as expired without entry',
  CORRECT: 'Correct Trade',
};

const optional = (value: string) => value.trim() || undefined;

/** An upcoming trade has no stop-loss until it is activated. */
function stopText(trade: AdminTradeDetail): string {
  return trade.stopLoss === null ? 'not set yet' : formatPrice(trade, trade.stopLoss);
}

function specOf(trade: AdminTradeDetail): InstrumentSpec {
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

interface FormProps {
  trade: AdminTradeDetail;
  run: (body: Record<string, unknown>) => void;
  pending: boolean;
  error: unknown;
  confirmWiden: boolean;
  frame: { testID: string; title: string; subtitle: string; onClose: () => void };
}

/** One sheet for every action, so each is two taps from the trade and always shows its effect. */
export function ActionSheet({
  trade,
  kind,
  onClose,
}: {
  trade: AdminTradeDetail;
  kind: ActionKind;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const toast = useToast();
  // One key for this sheet: pressing twice, or retrying after a timeout, applies the action once.
  const [idempotencyKey] = useState(newKey);
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
      toast({
        title:
          kind === 'RECORD_EXECUTION' ? 'Recorded. Subscribers are not notified of this.' : 'Published to subscribers',
        tone: 'success',
      });
      onClose();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'STALE_VERSION') {
        toast({ title: 'This trade just changed', body: 'Check the latest state and try again.', tone: 'warning' });
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
    frame: {
      testID: `action-${kind}`,
      title: TITLES[kind],
      subtitle:
        trade.stopLoss === null
          ? `${trade.direction} ${trade.symbol} · ${trade.ref}`
          : `${trade.direction} ${trade.symbol} · ${trade.ref} · Stop-loss ${stopText(trade)}`,
      onClose,
    },
  };
  switch (kind) {
    case 'ACTIVATE':
      return trade.stopLoss === null ? <UpcomingActivateForm {...shared} /> : <ActivateForm {...shared} />;
    case 'RECORD_EXECUTION':
      return <ExecutionForm {...shared} />;
    case 'MOVE_STOP':
      return <MoveStopForm {...shared} />;
    case 'MOVE_STOP_BREAKEVEN':
      return <BreakevenForm {...shared} />;
    case 'TRAIL_STOP':
      return <TrailForm {...shared} />;
    case 'TARGET_HIT':
      return <TargetHitForm {...shared} />;
    case 'MODIFY_TARGETS':
      return <TargetsForm {...shared} />;
    case 'BOOK_PARTIAL':
      return <ExitForm {...shared} final={false} />;
    case 'CLOSE':
      return <ExitForm {...shared} final />;
    case 'URGENT':
      return <UrgentForm {...shared} />;
    case 'CANCEL':
    case 'EXPIRE':
      return <CommentOnlyForm {...shared} kind={kind} />;
    case 'CORRECT':
      return <CorrectForm {...shared} />;
  }
}

type Shared = FormProps;

function Submit({
  pending,
  error,
  label,
  disabled,
  danger,
  note,
  onPress,
}: {
  pending: boolean;
  error: unknown;
  label: string;
  disabled?: boolean;
  danger?: boolean;
  note?: string;
  onPress: () => void;
}) {
  const hide = error instanceof ApiError && (error.code === 'WIDENS_RISK' || error.code === 'STALE_VERSION');
  return (
    <>
      {!hide && <FormError error={error} />}
      {note && (
        <T v="caption" c="subtle">
          {note}
        </T>
      )}
      <Button
        testID="action-submit"
        heavy
        variant={danger ? 'danger' : 'primary'}
        large
        label={label}
        loading={pending}
        disabled={disabled}
        onPress={onPress}
      />
    </>
  );
}

function Comment({ value, onChange, hint }: { value: string; onChange: (v: string) => void; hint?: string }) {
  return (
    <Field
      testID="action-comment"
      label="Comment"
      hint={hint ?? 'Optional. Shown to subscribers.'}
      value={value}
      onChangeText={onChange}
      multiline
      maxLength={1000}
    />
  );
}

function Row({ children }: { children: ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

function Half({ children }: { children: ReactNode }) {
  return <View style={styles.half}>{children}</View>;
}

/**
 * Turns an upcoming trade into a trade: the final entry, at least one target and the stop-loss, checked by the same
 * rules the server applies.
 */
function UpcomingActivateForm({ frame, trade, run, pending, error }: Shared) {
  const [entry, setEntry] = useState('');
  const [stop, setStop] = useState('');
  const [targets, setTargets] = useState(['', '', '']);
  const [comment, setComment] = useState('');
  const filled = targets.map((t) => t.trim()).filter(Boolean);
  const wellFormed = [entry.trim(), stop.trim(), ...filled].every(isDecimalLiteral) && filled.length > 0;
  const issues = wellFormed
    ? validateSignalLevels({
        spec: specOf(trade),
        direction: trade.direction,
        entry: singleEntry(canon(entry.trim())),
        targets: filled.map((t) => canon(t)),
        stopLoss: canon(stop.trim()),
      })
    : [];
  return (
    <Sheet
      {...frame}
      footer={
        <Submit
          pending={pending}
          error={error}
          label="Activate Trade and notify"
          disabled={!wellFormed || issues.length > 0}
          onPress={() => run({ entryPrice: entry.trim(), targets: filled, stopLoss: stop.trim(), comment: optional(comment) })}
        />
      }
    >
      <T c="muted">
        Published zone {formatPrice(trade, trade.entryLow)} – {formatPrice(trade, trade.entryHigh)}. The same trade becomes
        active with these levels.
      </T>
      <Row>
        <Half>
          <PriceField testID="activate-final-entry" label="Final entry" value={entry} onChange={setEntry} autoFocus />
        </Half>
        <Half>
          <PriceField testID="activate-stop" label="Stop-loss" value={stop} onChange={setStop} />
        </Half>
        {targets.map((value, i) => (
          <Half key={i}>
            <PriceField
              testID={`activate-target-${i + 1}`}
              label={i === 0 ? 'Target 1' : `Target ${i + 1} (optional)`}
              value={value}
              onChange={(v) => setTargets((prev) => prev.map((t, j) => (j === i ? v : t)))}
            />
          </Half>
        ))}
      </Row>
      {issues.length > 0 && (
        <Notice tone="stop">{issues.map((issue) => issue.message).join('\n')}</Notice>
      )}
      <Comment value={comment} onChange={setComment} />
    </Sheet>
  );
}

function ActivateForm({ frame, trade, run, pending, error }: Shared) {
  const [entry, setEntry] = useState('');
  const [quantity, setQuantity] = useState('');
  const [comment, setComment] = useState('');
  return (
    <Sheet
      {...frame}
      footer={
        <Submit
          pending={pending}
          error={error}
          label="Activate and notify"
          onPress={() =>
            run({ actualEntry: optional(entry), quantity: optional(quantity), comment: optional(comment) })
          }
        />
      }
    >
      <T c="muted">Tells subscribers the entry is live. A published signal never activates on its own.</T>
      <Row>
        <Half>
          <PriceField
            testID="activate-entry"
            label="My actual entry"
            value={entry}
            onChange={setEntry}
            hint="Optional. Without it, results cannot be declared as an execution."
          />
        </Half>
        <Half>
          <PriceField
            testID="activate-quantity"
            label={`Quantity (${trade.unitLabel})`}
            value={quantity}
            onChange={setQuantity}
            hint="Optional. Private: never shown to subscribers."
          />
        </Half>
      </Row>
      <Comment value={comment} onChange={setComment} />
    </Sheet>
  );
}

function ExecutionForm({ frame, trade, run, pending, error }: Shared) {
  const [entry, setEntry] = useState(trade.execution?.entryPrice ?? '');
  const [quantity, setQuantity] = useState(trade.execution?.quantity ?? '');
  return (
    <Sheet
      {...frame}
      footer={
        <Submit
          pending={pending}
          error={error}
          label="Save record"
          disabled={!isDecimalLiteral(entry.trim())}
          onPress={() => run({ actualEntry: entry.trim(), quantity: optional(quantity) })}
        />
      }
    >
      <T c="muted">
        Your own fill, for internal results. It stays private and is labelled as declared by you, not independently
        verified.
      </T>
      <Row>
        <Half>
          <PriceField testID="execution-entry" label="Actual entry" value={entry} onChange={setEntry} autoFocus />
        </Half>
        <Half>
          <PriceField
            testID="execution-quantity"
            label={`Quantity (${trade.unitLabel})`}
            value={quantity}
            onChange={setQuantity}
            hint="Needed for a monetary result."
          />
        </Half>
      </Row>
    </Sheet>
  );
}

function MoveStopForm({ frame, trade, run, pending, error, confirmWiden }: Shared) {
  const [price, setPrice] = useState('');
  const [comment, setComment] = useState('');
  return (
    <Sheet
      {...frame}
      footer={
        <Submit
          pending={pending}
          error={error}
          label={confirmWiden ? 'Yes, widen and notify' : 'Move and notify'}
          danger={confirmWiden}
          disabled={!isDecimalLiteral(price.trim())}
          onPress={() => run({ price: price.trim(), comment: optional(comment), allowWiden: confirmWiden })}
        />
      }
    >
      <PriceField
        testID="stop-price"
        big
        label="New stop-loss"
        value={price}
        onChange={setPrice}
        autoFocus
        hint={`Currently ${stopText(trade)}. The original stays in the history.`}
      />
      <Comment value={comment} onChange={setComment} />
      {confirmWiden && (
        <Notice tone="update" title="This increases risk" icon="warning">
          {`The new stop-loss is further from the trade than the current one (${stopText(trade)}). Press the button again to confirm.`}
        </Notice>
      )}
    </Sheet>
  );
}

function BreakevenForm({ frame, trade, run, pending, error }: Shared) {
  const known = trade.execution?.entryPrice ?? (trade.entryType === 'SINGLE' ? trade.entryLow : null);
  const [price, setPrice] = useState('');
  const [comment, setComment] = useState('');
  return (
    <Sheet
      {...frame}
      footer={
        <Submit
          pending={pending}
          error={error}
          label="Move and notify"
          disabled={!known && !isDecimalLiteral(price.trim())}
          onPress={() => run({ price: known ? undefined : price.trim(), comment: optional(comment) })}
        />
      }
    >
      {known ? (
        <View style={styles.change}>
          <T c="muted">The stop-loss moves from</T>
          <T v="price">{stopText(trade)}</T>
          <T c="muted">to</T>
          <T v="price" c="stop">
            {formatPrice(trade, known)}
          </T>
          <T c="muted">{trade.execution ? 'your recorded entry.' : 'the recommended entry.'}</T>
        </View>
      ) : (
        <PriceField
          testID="breakeven-price"
          label="Breakeven price"
          value={price}
          onChange={setPrice}
          autoFocus
          hint="This signal recommended a range and has no recorded entry, so state the price."
        />
      )}
      <Comment value={comment} onChange={setComment} />
    </Sheet>
  );
}

function TrailForm({ frame, trade, run, pending, error }: Shared) {
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
  const wording: TrailingStopWording =
    by === 'PRICE' ? 'GENERAL' : (chosen ?? settings.data?.trailingStopWording ?? 'GENERAL');
  const computed = useMemo(() => {
    if (by === 'PRICE') return isDecimalLiteral(price.trim()) ? toDec(price.trim()) : null;
    return trailStopPrice(trade, trade.direction, reference, points);
  }, [by, points, price, reference, trade]);
  const next = computed ? formatPrice(trade, computed) : null;
  return (
    <Sheet
      {...frame}
      footer={
        <Submit
          pending={pending}
          error={error}
          label="Trail and notify"
          disabled={!computed}
          onPress={() =>
            run(
              by === 'PRICE'
                ? { price: price.trim(), comment: optional(comment) }
                : { referencePrice: reference.trim(), trailPoints: points.trim(), wording, comment: optional(comment) },
            )
          }
        />
      }
    >
      <T c="muted">
        This platform has no market data. It records the instruction at the price you give, and does not move the stop
        by itself afterwards.
      </T>
      <Segmented<'DISTANCE' | 'PRICE'>
        label="Trail by"
        value={by}
        onChange={setBy}
        options={[
          { value: 'DISTANCE', label: 'Distance', testID: 'trail-by-distance' },
          { value: 'PRICE', label: 'New stop-loss', testID: 'trail-by-price' },
        ]}
      />
      {by === 'DISTANCE' ? (
        <Row>
          <Half>
            <PriceField
              testID="trail-reference"
              label="Current market price"
              value={reference}
              onChange={setReference}
              autoFocus
            />
          </Half>
          <Half>
            <PriceField
              testID="trail-points"
              label="Trail distance (points)"
              value={points}
              onChange={setPoints}
              hint={`1 pt = ${trade.pointSize} ${trade.quoteCurrency}`}
            />
          </Half>
        </Row>
      ) : (
        <PriceField testID="trail-price" big label="New stop-loss" value={price} onChange={setPrice} autoFocus />
      )}
      {by === 'DISTANCE' && (
        <>
          <T v="small" c="muted">
            Alert wording
          </T>
          <ChipRow>
            <Chip
              testID="trail-wording-general"
              label="General"
              on={wording === 'GENERAL'}
              onPress={() => setChosen('GENERAL')}
            />
            <Chip
              testID="trail-wording-detailed"
              label="Show points"
              on={wording === 'DETAILED'}
              onPress={() => setChosen('DETAILED')}
            />
          </ChipRow>
        </>
      )}
      {next && (
        <View style={styles.change} testID="trail-result">
          <T c="muted">New stop-loss</T>
          <T v="price" c="stop">
            {next}
          </T>
          <T c="muted">{`(was ${stopText(trade)})`}</T>
        </View>
      )}
      {next && (
        <T v="small" c="muted" testID="trail-preview">
          {wording === 'GENERAL'
            ? `Subscribers read: “Trail the stop-loss on trade ${trade.ref} to ${next}.”`
            : `Subscribers read: “Stop-loss on trade ${trade.ref} trailed from ${stopText(trade)} to ${next} (${formatPoints(points.trim() || '0')} pts from ${formatPrice(trade, reference.trim() || '0')}).”`}
        </T>
      )}
      <Comment value={comment} onChange={setComment} />
    </Sheet>
  );
}

function TargetHitForm({ frame, trade, run, pending, error }: Shared) {
  const open = trade.targets.filter((t) => t.status === 'OPEN');
  const [index, setIndex] = useState(open[0]?.index ?? 1);
  const [comment, setComment] = useState('');
  return (
    <Sheet
      {...frame}
      footer={
        <Submit
          pending={pending}
          error={error}
          label="Mark reached and notify"
          disabled={open.length === 0}
          onPress={() => run({ targetIndex: index, comment: optional(comment) })}
        />
      }
    >
      <View style={{ gap: space.sm }}>
        <T v="small" c="muted">
          Target reached. Any earlier targets are marked as reached too.
        </T>
        <ChipRow>
          {open.map((t) => (
            <Chip
              key={t.index}
              testID={`target-${t.index}`}
              label={`Target ${t.index}: ${formatPrice(trade, t.price)}`}
              on={index === t.index}
              onPress={() => setIndex(t.index)}
            />
          ))}
        </ChipRow>
      </View>
      <Comment value={comment} onChange={setComment} />
    </Sheet>
  );
}

function TargetsForm({ frame, trade, run, pending, error }: Shared) {
  const hit = trade.targets.filter((t) => t.status === 'HIT');
  const open = trade.targets.filter((t) => t.status === 'OPEN').map((t) => t.price);
  const slots = 3 - hit.length;
  const [values, setValues] = useState<string[]>(Array.from({ length: slots }, (_, i) => open[i] ?? ''));
  const [comment, setComment] = useState('');
  return (
    <Sheet
      {...frame}
      footer={
        <Submit
          pending={pending}
          error={error}
          label="Change and notify"
          onPress={() => run({ targets: values.map((v) => v.trim()).filter(Boolean), comment: optional(comment) })}
        />
      }
    >
      {hit.length > 0 && (
        <T c="muted">{`Reached targets stay as they are: ${hit.map((t) => formatPrice(trade, t.price)).join(', ')}.`}</T>
      )}
      {values.map((value, i) => (
        <PriceField
          key={i}
          testID={`new-target-${i + 1}`}
          label={`Target ${hit.length + i + 1}`}
          value={value}
          onChange={(v) => {
            const next = [...values];
            next[i] = v;
            setValues(next);
          }}
        />
      ))}
      <Comment value={comment} onChange={setComment} />
    </Sheet>
  );
}

function ExitForm({ frame, trade, run, pending, error, final }: Shared & { final: boolean }) {
  const c = useColors();
  const [exitPrice, setExitPrice] = useState('');
  const [reason, setReason] = useState<CloseReason>('MANUAL');
  const [basis, setBasis] = useState<CalculationBasis>(defaultExitBasis(trade));
  const [hypothetical, setHypothetical] = useState(trade.entryType === 'SINGLE' ? trade.entryLow : '');
  const [fees, setFees] = useState('');
  const [portion, setPortion] = useState('50');
  const [comment, setComment] = useState('');
  const basisLocked = trade.closures.some((closure) => !closure.superseded);
  const openTargets = trade.targets.filter((t) => t.status === 'OPEN');
  const remaining = remainingFraction(trade);
  const exit = useMemo(
    () => previewExit({ trade, basis, exitPrice, hypotheticalEntry: hypothetical, fees, final, percent: portion }),
    [basis, exitPrice, fees, final, hypothetical, portion, trade],
  );
  const preview = exit?.result ?? null;
  const send = () =>
    run({
      exitPrice: exitPrice.trim(),
      basis,
      fees: basis === 'ADMIN_DECLARED_EXECUTION' ? optional(fees) : undefined,
      hypotheticalEntry:
        basis === 'HYPOTHETICAL_OUTCOME' && trade.entryType === 'RANGE' ? optional(hypothetical) : undefined,
      comment: optional(comment),
      ...(final ? { reason, confirm: true } : { percent: portion.trim() }),
    });
  const options = [
    { value: 'HYPOTHETICAL_OUTCOME' as const, label: 'Hypothetical' },
    ...(trade.execution ? [{ value: 'ADMIN_DECLARED_EXECUTION' as const, label: 'Declared' }] : []),
    { value: 'NONE' as const, label: 'Exit only' },
  ];
  return (
    <Sheet
      {...frame}
      footer={
        <Submit
          pending={pending}
          error={error}
          label={final ? 'Close trade and notify' : 'Book partial and notify'}
          disabled={!isDecimalLiteral(exitPrice.trim())}
          danger={final}
          onPress={() => {
            if (!final) return send();
            Alert.alert(
              'Close this trade?',
              'Subscribers are notified and this cannot be undone. A wrong figure can be corrected later, in the open.',
              [
                { text: 'Not yet', style: 'cancel' },
                { text: 'Close Trade', style: 'destructive', onPress: send },
              ],
            );
          }}
        />
      }
    >
      {final && (
        <ChipRow>
          {openTargets.map((t) => (
            <Chip
              key={t.index}
              testID={`exit-target-${t.index}`}
              label={`At target ${t.index}`}
              onPress={() => {
                setExitPrice(t.price);
                setReason('TARGET_ACHIEVED');
              }}
            />
          ))}
          <Chip
            testID="exit-stop"
            label="At stop-loss"
            onPress={() => {
              setExitPrice(trade.stopLoss ?? '');
              setReason('STOP_LOSS_HIT');
            }}
          />
        </ChipRow>
      )}
      <PriceField testID="exit-price" big label="Exit price" value={exitPrice} onChange={setExitPrice} />
      {final ? (
        <View style={{ gap: space.sm }}>
          <T v="small" c="muted">
            Reason
          </T>
          <ChipRow>
            {CLOSE_REASONS.map((r) => (
              <Chip
                key={r}
                testID={`reason-${r}`}
                label={CLOSE_REASON_LABELS[r]}
                on={reason === r}
                onPress={() => setReason(r)}
              />
            ))}
          </ChipRow>
        </View>
      ) : (
        <View style={{ gap: space.sm }}>
          <ChipRow>
            {['25', '33', '50', '75'].map((p) => (
              <Chip key={p} label={`${p}%`} on={portion === p} onPress={() => setPortion(p)} />
            ))}
          </ChipRow>
          <Field
            testID="exit-portion"
            label="Portion of the original position (%)"
            hint={`${remaining.times(100).toDecimalPlaces(2).toFixed()}% still open.`}
            num
            keyboardType="decimal-pad"
            value={portion}
            onChangeText={(v) => setPortion(cleanPrice(v))}
          />
        </View>
      )}
      <View style={{ gap: space.sm }}>
        <T v="small" c="muted">
          What is this result based on?
        </T>
        {basisLocked ? (
          <T v="small">{`${BASIS_LABELS[basis]}. Fixed by the earlier exit on this trade: bases cannot be mixed.`}</T>
        ) : (
          <Segmented
            label="Basis"
            options={options.map((o) => ({ ...o, testID: `basis-${o.value}` }))}
            value={basis}
            onChange={setBasis}
          />
        )}
        {!trade.execution && !basisLocked && (
          <T v="caption" c="subtle">
            To declare a real result, record your execution first.
          </T>
        )}
      </View>
      {basis === 'HYPOTHETICAL_OUTCOME' && trade.entryType === 'RANGE' && (
        <PriceField
          testID="exit-hypothetical"
          label="Measure from which entry?"
          value={hypothetical}
          onChange={setHypothetical}
          hint={`Must be within ${formatPrice(trade, trade.entryLow)} to ${formatPrice(trade, trade.entryHigh)}. A range is never assumed to be a fill.`}
        />
      )}
      {basis === 'ADMIN_DECLARED_EXECUTION' && exit?.quantity && (
        <PriceField
          testID="exit-fees"
          label={`Fees (${trade.quoteCurrency})`}
          hint="Optional."
          value={fees}
          onChange={setFees}
        />
      )}
      <Comment value={comment} onChange={setComment} />
      <View
        style={[styles.preview, { backgroundColor: c.raised }]}
        accessibilityLiveRegion="polite"
        testID="exit-preview"
      >
        <T v="caption" c="muted" style={{ fontWeight: '600' }}>
          What will be recorded
        </T>
        {!preview && (
          <T v="small" c="muted">
            Enter an exit price to see the result.
          </T>
        )}
        {preview && (
          <>
            <View style={styles.previewRow}>
              <T v="small" c="muted">
                Move
              </T>
              <T v="small" num style={{ fontWeight: '600' }}>
                {preview.points ? signedPoints(preview.points) : 'Not measured'}
              </T>
            </View>
            <View style={styles.previewRow}>
              <T v="small" c="muted">
                Monetary result
              </T>
              <T v="small" num style={{ fontWeight: '600' }}>
                {preview.netPnl ? money(preview.netPnl, trade.quoteCurrency) : 'None: no position recorded'}
              </T>
            </View>
          </>
        )}
        {preview?.points && (
          <T v="caption" c="subtle">
            Subscribers see the move and its basis. Quantity, fees and money stay private.
          </T>
        )}
      </View>
    </Sheet>
  );
}

function UrgentForm({ frame, run, pending, error }: Shared) {
  const [message, setMessage] = useState('');
  return (
    <Sheet
      {...frame}
      footer={
        <Submit
          pending={pending}
          error={error}
          label="Send to subscribers"
          disabled={!message.trim()}
          onPress={() => run({ message: message.trim() })}
        />
      }
    >
      <Field
        testID="urgent-message"
        label="Instruction"
        hint="Sent right away and marked as priority."
        value={message}
        onChangeText={setMessage}
        multiline
        maxLength={1000}
        autoFocus
      />
    </Sheet>
  );
}

function CommentOnlyForm({ frame, run, pending, error, kind }: Shared & { kind: 'CANCEL' | 'EXPIRE' }) {
  const [comment, setComment] = useState('');
  const label = kind === 'CANCEL' ? 'Cancel signal and notify' : 'Mark expired and notify';
  return (
    <Sheet
      {...frame}
      footer={
        <Submit
          pending={pending}
          error={error}
          label={label}
          danger
          onPress={() =>
            Alert.alert(
              kind === 'CANCEL' ? 'Cancel this signal?' : 'Mark as expired?',
              'Subscribers are notified and this cannot be undone.',
              [
                { text: 'Keep it', style: 'cancel' },
                { text: label, style: 'destructive', onPress: () => run({ comment: optional(comment) }) },
              ],
            )
          }
        />
      }
    >
      <T c="muted">Subscribers are told not to enter this signal. This cannot be undone.</T>
      <Comment value={comment} onChange={setComment} />
    </Sheet>
  );
}

const TIME_FORMAT_ERROR = 'Use the form 2026-11-12 19:22';

function CorrectForm({ frame, trade, run, pending, error }: Shared) {
  const c = useColors();
  const currentClosures = trade.closures.filter((closure) => !closure.superseded);
  const everActive = trade.activatedAt !== null;
  const [reason, setReason] = useState('');
  const [stop, setStop] = useState('');
  const [low, setLow] = useState('');
  const [high, setHigh] = useState('');
  const [targetPrices, setTargetPrices] = useState<Record<number, string>>({});
  const [actualEntry, setActualEntry] = useState('');
  const [activatedAt, setActivatedAt] = useState('');
  const [closureId, setClosureId] = useState(currentClosures.at(-1)?.id ?? '');
  const [exitPrice, setExitPrice] = useState('');
  const [exitedAt, setExitedAt] = useState('');
  const [fees, setFees] = useState('');
  const [closeReason, setCloseReason] = useState<CloseReason | null>(null);
  const selected = currentClosures.find((closure) => closure.id === closureId);
  const activatedIso = activatedAt.trim() ? parseLocalTime(activatedAt) : undefined;
  const exitedIso = exitedAt.trim() ? parseLocalTime(exitedAt) : undefined;
  const badTime = activatedIso === null || exitedIso === null;
  const exitTouched = Boolean(exitPrice.trim() || exitedAt.trim() || fees.trim() || closeReason);
  const results = currentClosures
    .map((closure) => {
      const editing = closure.id === closureId;
      const next = previewCorrectedExit({ trade, closure, actualEntry, exitPrice: editing ? exitPrice : '' });
      return { closure, next, changed: (editing && exitPrice.trim() !== '') || actualEntry.trim() !== '' };
    })
    .filter((r) => r.changed);
  const send = () => {
    const edits = Object.entries(targetPrices)
      .filter(([, value]) => value.trim() !== '')
      .map(([index, value]) => ({ index: Number(index), price: value.trim() }));
    run({
      reason: reason.trim(),
      stopLoss: optional(stop),
      entryLow: optional(low),
      entryHigh: optional(high),
      targetPrices: edits.length > 0 ? edits : undefined,
      actualEntry: optional(actualEntry),
      activatedAt: activatedIso ?? undefined,
      closureId: exitTouched ? closureId : undefined,
      exitPrice: optional(exitPrice),
      exitedAt: exitedIso ?? undefined,
      fees: optional(fees),
      closeReason: closeReason ?? undefined,
    });
  };
  return (
    <Sheet
      {...frame}
      footer={
        <Submit
          pending={pending}
          error={error}
          label="Publish correction"
          disabled={reason.trim().length < 3 || badTime}
          note={`Point value on this trade: 1 pt = ${formatPoints(trade.pointSize)} ${trade.quoteCurrency}.`}
          onPress={send}
        />
      }
    >
      <T c="muted">
        Fill in only what is wrong. Subscribers see what changed, from what, to what, and why. The original record stays
        visible.
      </T>
      <Field
        testID="correct-reason"
        label="Why is this being corrected?"
        value={reason}
        onChangeText={setReason}
        autoFocus
      />

      <SectionTitle>Published levels</SectionTitle>
      <Row>
        <Half>
          <PriceField
            testID="correct-entry"
            label={trade.entryType === 'RANGE' ? 'Lower entry' : 'Entry'}
            value={low}
            onChange={setLow}
            hint={`Now ${formatPrice(trade, trade.entryLow)}`}
          />
        </Half>
        {trade.entryType === 'RANGE' && (
          <Half>
            <PriceField
              label="Upper entry"
              value={high}
              onChange={setHigh}
              hint={`Now ${formatPrice(trade, trade.entryHigh)}`}
            />
          </Half>
        )}
        {trade.stopLoss !== null && (
          <Half>
            <PriceField
              testID="correct-stop"
              label="Stop-loss"
              value={stop}
              onChange={setStop}
              hint={`Now ${stopText(trade)}`}
            />
          </Half>
        )}
        {trade.targets.map((target) => (
          <Half key={target.index}>
            <PriceField
              testID={`correct-target-${target.index}`}
              label={`Target ${target.index}${target.status === 'HIT' ? ' (reached)' : ''}`}
              value={targetPrices[target.index] ?? ''}
              onChange={(value) => setTargetPrices((prev) => ({ ...prev, [target.index]: value }))}
              hint={`Now ${formatPrice(trade, target.price)}`}
            />
          </Half>
        ))}
      </Row>

      {everActive && (
        <>
          <SectionTitle>Entry</SectionTitle>
          <PriceField
            testID="correct-actual-entry"
            label="Actual entry price"
            value={actualEntry}
            onChange={setActualEntry}
            hint={
              trade.execution
                ? `Now ${formatPrice(trade, trade.execution.entryPrice)}`
                : 'Not recorded. Exits are measured from it once added.'
            }
          />
          <Field
            testID="correct-activated"
            label="Activated at"
            keyboardType="numbers-and-punctuation"
            placeholder={localTimeText(trade.activatedAt as string)}
            value={activatedAt}
            onChangeText={setActivatedAt}
            error={activatedIso === null ? TIME_FORMAT_ERROR : null}
            hint={`Now ${localTimeText(trade.activatedAt as string)}, your time.`}
          />
        </>
      )}

      {selected && (
        <>
          <SectionTitle>Exit</SectionTitle>
          {currentClosures.length > 1 && (
            <ChipRow>
              {currentClosures.map((closure) => (
                <Chip
                  key={closure.id}
                  label={`${closure.kind === 'FINAL' ? 'Final' : 'Partial'} at ${formatPrice(trade, closure.exitPrice)}`}
                  on={closureId === closure.id}
                  onPress={() => setClosureId(closure.id)}
                />
              ))}
            </ChipRow>
          )}
          <PriceField
            testID="correct-exit"
            label="Exit price"
            value={exitPrice}
            onChange={setExitPrice}
            hint={`Now ${formatPrice(trade, selected.exitPrice)}`}
          />
          <Field
            testID="correct-exit-time"
            label="Exit time"
            keyboardType="numbers-and-punctuation"
            placeholder={localTimeText(selected.exitedAt)}
            value={exitedAt}
            onChangeText={setExitedAt}
            error={exitedIso === null ? TIME_FORMAT_ERROR : null}
            hint={`Now ${localTimeText(selected.exitedAt)}, your time.`}
          />
          {selected.kind === 'FINAL' && (
            <View style={{ gap: space.sm }}>
              <T v="small" c="muted">
                Close reason (now {selected.reason ? CLOSE_REASON_LABELS[selected.reason] : 'not stated'})
              </T>
              <ChipRow>
                {CLOSE_REASONS.map((r) => (
                  <Chip
                    key={r}
                    testID={`correct-reason-${r}`}
                    label={CLOSE_REASON_LABELS[r]}
                    on={closeReason === r}
                    onPress={() => setCloseReason(closeReason === r ? null : r)}
                  />
                ))}
              </ChipRow>
            </View>
          )}
          {selected.quantity !== null && (
            <PriceField
              label={`Fees (${trade.quoteCurrency})`}
              value={fees}
              onChange={setFees}
              hint={`Now ${selected.fees ?? 'none'}`}
            />
          )}
        </>
      )}

      {results.length > 0 && (
        <View
          style={[styles.preview, { backgroundColor: c.raised }]}
          accessibilityLiveRegion="polite"
          testID="correct-preview"
        >
          <T v="caption" c="muted" style={{ fontWeight: '600' }}>
            Result after this correction
          </T>
          {results.map(({ closure, next }) => (
            <View key={closure.id} style={styles.previewRow}>
              <T v="small" c="muted">
                {currentClosures.length > 1
                  ? `${closure.kind === 'FINAL' ? 'Final' : 'Partial'} at ${formatPrice(trade, closure.exitPrice)}`
                  : `Was ${closure.points ? signedPoints(closure.points) : 'not measured'}`}
              </T>
              <T v="small" num style={{ fontWeight: '600' }}>
                {next ? signedPoints(next) : 'Not measured'}
              </T>
            </View>
          ))}
          {actualEntry.trim() !== '' && (
            <T v="small" c="muted">
              Shown to subscribers as declared by the administrator.
            </T>
          )}
        </View>
      )}
    </Sheet>
  );
}

function SectionTitle({ children }: { children: string }) {
  return (
    <T v="caption" c="muted" style={{ fontWeight: '600', textTransform: 'uppercase', marginTop: space.sm }}>
      {children}
    </T>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  half: { flexBasis: '46%', flexGrow: 1 },
  change: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 6, rowGap: 2 },
  preview: { padding: space.md, borderRadius: radius.md, gap: 6 },
  previewRow: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md },
});

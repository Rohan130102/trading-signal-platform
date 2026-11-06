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
  previewExit,
  remainingFraction,
  signedPoints,
  trailStopPrice,
} from '@signaldesk/domain';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useMemo, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { ApiError, api } from '@/lib/api';
import { newKey } from '@/lib/ids';
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
  ACTIVATE: 'Activate trade',
  RECORD_EXECUTION: 'Record my execution',
  MOVE_STOP: 'Move stop-loss',
  MOVE_STOP_BREAKEVEN: 'Stop-loss to breakeven',
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

const optional = (value: string) => value.trim() || undefined;

interface FormProps {
  trade: AdminTradeDetail;
  run: (body: Record<string, unknown>) => void;
  pending: boolean;
  error: unknown;
  confirmWiden: boolean;
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
  };
  const content = (() => {
    switch (kind) {
      case 'ACTIVATE':
        return <ActivateForm {...shared} />;
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
  })();
  return (
    <Sheet
      testID={`action-${kind}`}
      title={TITLES[kind]}
      subtitle={`${trade.direction} ${trade.symbol} · ${trade.ref} · Stop-loss ${formatPrice(trade, trade.stopLoss)}`}
      onClose={onClose}
    >
      {content}
    </Sheet>
  );
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

function ActivateForm({ trade, run, pending, error }: Shared) {
  const [entry, setEntry] = useState('');
  const [quantity, setQuantity] = useState('');
  const [comment, setComment] = useState('');
  return (
    <>
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
      <Submit
        pending={pending}
        error={error}
        label="Activate and notify"
        onPress={() => run({ actualEntry: optional(entry), quantity: optional(quantity), comment: optional(comment) })}
      />
    </>
  );
}

function ExecutionForm({ trade, run, pending, error }: Shared) {
  const [entry, setEntry] = useState(trade.execution?.entryPrice ?? '');
  const [quantity, setQuantity] = useState(trade.execution?.quantity ?? '');
  return (
    <>
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
      <Submit
        pending={pending}
        error={error}
        label="Save record"
        disabled={!isDecimalLiteral(entry.trim())}
        onPress={() => run({ actualEntry: entry.trim(), quantity: optional(quantity) })}
      />
    </>
  );
}

function MoveStopForm({ trade, run, pending, error, confirmWiden }: Shared) {
  const [price, setPrice] = useState('');
  const [comment, setComment] = useState('');
  return (
    <>
      <PriceField
        testID="stop-price"
        big
        label="New stop-loss"
        value={price}
        onChange={setPrice}
        autoFocus
        hint={`Currently ${formatPrice(trade, trade.stopLoss)}. The original stays in the history.`}
      />
      <Comment value={comment} onChange={setComment} />
      {confirmWiden && (
        <Notice tone="update" title="This increases risk" icon="warning">
          {`The new stop-loss is further from the trade than the current one (${formatPrice(trade, trade.stopLoss)}). Press the button again to confirm.`}
        </Notice>
      )}
      <Submit
        pending={pending}
        error={error}
        label={confirmWiden ? 'Yes, widen and notify' : 'Move and notify'}
        danger={confirmWiden}
        disabled={!isDecimalLiteral(price.trim())}
        onPress={() => run({ price: price.trim(), comment: optional(comment), allowWiden: confirmWiden })}
      />
    </>
  );
}

function BreakevenForm({ trade, run, pending, error }: Shared) {
  const known = trade.execution?.entryPrice ?? (trade.entryType === 'SINGLE' ? trade.entryLow : null);
  const [price, setPrice] = useState('');
  const [comment, setComment] = useState('');
  return (
    <>
      {known ? (
        <View style={styles.change}>
          <T c="muted">The stop-loss moves from</T>
          <T v="price">{formatPrice(trade, trade.stopLoss)}</T>
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
      <Submit
        pending={pending}
        error={error}
        label="Move and notify"
        disabled={!known && !isDecimalLiteral(price.trim())}
        onPress={() => run({ price: known ? undefined : price.trim(), comment: optional(comment) })}
      />
    </>
  );
}

function TrailForm({ trade, run, pending, error }: Shared) {
  const [reference, setReference] = useState('');
  const [points, setPoints] = useState('');
  const [comment, setComment] = useState('');
  const computed = useMemo(() => trailStopPrice(trade, trade.direction, reference, points), [points, reference, trade]);
  return (
    <>
      <T c="muted">
        This platform has no market data. It records the instruction at the price you give, and does not move the stop
        by itself afterwards.
      </T>
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
      {computed && (
        <View style={styles.change} testID="trail-result">
          <T c="muted">New stop-loss</T>
          <T v="price" c="stop">
            {formatPrice(trade, computed)}
          </T>
          <T c="muted">{`(was ${formatPrice(trade, trade.stopLoss)})`}</T>
        </View>
      )}
      <Comment value={comment} onChange={setComment} />
      <Submit
        pending={pending}
        error={error}
        label="Trail and notify"
        disabled={!computed}
        onPress={() =>
          run({ referencePrice: reference.trim(), trailPoints: points.trim(), comment: optional(comment) })
        }
      />
    </>
  );
}

function TargetHitForm({ trade, run, pending, error }: Shared) {
  const open = trade.targets.filter((t) => t.status === 'OPEN');
  const [index, setIndex] = useState(open[0]?.index ?? 1);
  const [comment, setComment] = useState('');
  return (
    <>
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
      <Submit
        pending={pending}
        error={error}
        label="Mark reached and notify"
        disabled={open.length === 0}
        onPress={() => run({ targetIndex: index, comment: optional(comment) })}
      />
    </>
  );
}

function TargetsForm({ trade, run, pending, error }: Shared) {
  const hit = trade.targets.filter((t) => t.status === 'HIT');
  const open = trade.targets.filter((t) => t.status === 'OPEN').map((t) => t.price);
  const slots = 3 - hit.length;
  const [values, setValues] = useState<string[]>(Array.from({ length: slots }, (_, i) => open[i] ?? ''));
  const [comment, setComment] = useState('');
  return (
    <>
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
      <Submit
        pending={pending}
        error={error}
        label="Change and notify"
        onPress={() => run({ targets: values.map((v) => v.trim()).filter(Boolean), comment: optional(comment) })}
      />
    </>
  );
}

function ExitForm({ trade, run, pending, error, final }: Shared & { final: boolean }) {
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
    <>
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
              setExitPrice(trade.stopLoss);
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
              { text: 'Close trade', style: 'destructive', onPress: send },
            ],
          );
        }}
      />
    </>
  );
}

function UrgentForm({ run, pending, error }: Shared) {
  const [message, setMessage] = useState('');
  return (
    <>
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
      <Submit
        pending={pending}
        error={error}
        label="Send to subscribers"
        disabled={!message.trim()}
        onPress={() => run({ message: message.trim() })}
      />
    </>
  );
}

function CommentOnlyForm({ run, pending, error, kind }: Shared & { kind: 'CANCEL' | 'EXPIRE' }) {
  const [comment, setComment] = useState('');
  const label = kind === 'CANCEL' ? 'Cancel signal and notify' : 'Mark expired and notify';
  return (
    <>
      <T c="muted">Subscribers are told not to enter this signal. This cannot be undone.</T>
      <Comment value={comment} onChange={setComment} />
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
    </>
  );
}

function CorrectForm({ trade, run, pending, error }: Shared) {
  const closed = trade.status === 'CLOSED';
  const currentClosures = trade.closures.filter((closure) => !closure.superseded);
  const [reason, setReason] = useState('');
  const [stop, setStop] = useState('');
  const [low, setLow] = useState('');
  const [high, setHigh] = useState('');
  const [targets, setTargets] = useState('');
  const [closureId, setClosureId] = useState(currentClosures[0]?.id ?? '');
  const [exitPrice, setExitPrice] = useState('');
  const send = () => {
    const hasExit = exitPrice.trim() !== '';
    run({
      reason: reason.trim(),
      stopLoss: optional(stop),
      entryLow: optional(low),
      entryHigh: optional(high),
      targets: targets.trim()
        ? targets
            .split(/[\s,]+/)
            .map((t) => t.trim())
            .filter(Boolean)
        : undefined,
      closureId: hasExit ? closureId : undefined,
      exitPrice: hasExit ? exitPrice.trim() : undefined,
    });
  };
  return (
    <>
      <T c="muted">Subscribers see what changed, from what, to what, and why. The original record stays visible.</T>
      <Field
        testID="correct-reason"
        label="Why is this being corrected?"
        value={reason}
        onChangeText={setReason}
        autoFocus
      />
      {!closed && (
        <>
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
            <Half>
              <PriceField
                testID="correct-stop"
                label="Stop-loss"
                value={stop}
                onChange={setStop}
                hint={`Now ${formatPrice(trade, trade.stopLoss)}`}
              />
            </Half>
          </Row>
          <Field
            testID="correct-targets"
            label="Open targets"
            hint="Separated by commas, nearest first."
            num
            keyboardType="numbers-and-punctuation"
            value={targets}
            placeholder={trade.targets
              .filter((t) => t.status === 'OPEN')
              .map((t) => t.price)
              .join(', ')}
            onChangeText={setTargets}
          />
        </>
      )}
      {currentClosures.length > 0 && (
        <View style={{ gap: space.sm }}>
          <T v="small" c="muted">
            Exit record
          </T>
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
          <PriceField testID="correct-exit" label="Correct exit price" value={exitPrice} onChange={setExitPrice} />
        </View>
      )}
      <Submit
        pending={pending}
        error={error}
        label="Publish correction"
        disabled={reason.trim().length < 3}
        note={`Point value on this trade: 1 pt = ${formatPoints(trade.pointSize)} ${trade.quoteCurrency}.`}
        onPress={send}
      />
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  half: { flexBasis: '46%', flexGrow: 1 },
  change: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 6, rowGap: 2 },
  preview: { padding: space.md, borderRadius: radius.md, gap: 6 },
  previewRow: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md },
});

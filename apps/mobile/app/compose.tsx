import Ionicons from '@expo/vector-icons/Ionicons';
import {
  ACTIONS,
  type AdminTradeDetail,
  composeSignal,
  defaultSignalTemplateKind,
  type Direction,
  type DraftInput,
  type DraftRow,
  ENTRY_WINDOW_CHOICES,
  entryWindowLabel,
  type EntryType,
  formatDateTime,
  formatPoints,
  formatPrice,
  type InstrumentRow,
  isSignalReady,
  type PlatformSettings,
  isTemplateForDirection,
  previewSignalEvent,
  type Priority,
  type TemplateRow,
} from '@signaldesk/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DispatchStatus } from '@/admin/parts';
import { api, ApiError } from '@/lib/api';
import { newKey } from '@/lib/ids';
import { prefs, secure } from '@/lib/storage';
import { FeedCard, Levels } from '@/trade';
import { useColors } from '@/theme';
import { radius, space } from '@/theme/tokens';
import {
  Button,
  Card,
  Chip,
  ChipRow,
  Divider,
  errorMessage,
  ErrorState,
  Field,
  FormError,
  type InputHandle,
  KeyboardArea,
  Loading,
  ModalFrame,
  Notice,
  PriceField,
  Segmented,
  Sheet,
  T,
  ToggleRow,
  useToast,
} from '@/ui';

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
  /** DEFAULT: the platform's entry window. NONE: no limit. Otherwise minutes. */
  window: string;
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
};

const RECENT_KEY = 'recent-instruments';

function Compose() {
  const router = useRouter();
  const params = useLocalSearchParams<{ direction?: string; symbol?: string; draft?: string }>();
  const c = useColors();
  const client = useQueryClient();
  const toast = useToast();
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
    enabled: Boolean(params.draft),
  });
  const platform = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: () => api.get<PlatformSettings>('/admin/settings'),
  });

  const [form, setForm] = useState<FormState>(EMPTY);
  const [advanced, setAdvanced] = useState(false);
  const [draftRef, setDraftRef] = useState<{ id: string; version: number } | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [published, setPublished] = useState<AdminTradeDetail | null>(null);
  const [cycle, setCycle] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const hydrated = useRef(false);
  const [restored, setRestored] = useState(false);
  const entryInput = useRef<InputHandle>(null);

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
  const issue = computed.issues[0];

  const set = useCallback(
    <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value })),
    [],
  );

  // Restores work in progress: a phone call or a crash must not lose a signal being written.
  useEffect(() => {
    if (hydrated.current || !instruments.data) return;
    hydrated.current = true;
    void (async () => {
      const recentIds = (await prefs.get<string[]>(RECENT_KEY)) ?? [];
      setRecent(recentIds);
      const direction = params.direction === 'BUY' || params.direction === 'SELL' ? params.direction : null;
      const firstChoice = [...active].sort((a, b) => {
        const ra = recentIds.indexOf(a.id);
        const rb = recentIds.indexOf(b.id);
        if (ra !== -1 || rb !== -1) return (ra === -1 ? 99 : ra) - (rb === -1 ? 99 : rb);
        return a.sortOrder - b.sortOrder;
      })[0];
      const reuse = active.find((i) => i.symbol === params.symbol);
      if (reuse || direction) {
        // Reusing an earlier trade carries only its instrument and direction. Prices are always fresh.
        setForm((f) => ({ ...f, instrumentId: reuse?.id ?? firstChoice?.id ?? '', direction }));
        setRestored(true);
        return;
      }
      if (params.draft) {
        setRestored(true);
        return;
      }
      const raw = await secure.getComposer();
      if (raw) {
        try {
          const saved = JSON.parse(raw) as { form: FormState; draftRef: { id: string; version: number } | null };
          if (saved.form.entryLow || saved.form.direction) {
            setForm({ ...EMPTY, ...saved.form });
            setDraftRef(saved.draftRef);
            if (
              saved.form.custom ||
              saved.form.commentary ||
              saved.form.priority !== 'NORMAL' ||
              saved.form.templateId
            ) {
              setAdvanced(true);
            }
            setRestored(true);
            return;
          }
        } catch {
          // A damaged save is not worth an error: start clean.
        }
      }
      if (firstChoice) setForm((f) => ({ ...f, instrumentId: firstChoice.id }));
      setRestored(true);
    })();
  }, [active, instruments.data, params.direction, params.draft, params.symbol]);

  useEffect(() => {
    if (restored) void secure.setComposer(JSON.stringify({ form, draftRef }));
  }, [draftRef, form, restored]);

  const draftRow = drafts.data?.drafts.find((d) => d.id === params.draft);
  useEffect(() => {
    if (!draftRow || draftRef) return;
    const d = draftRow.draft;
    setForm({
      ...EMPTY,
      instrumentId: d.instrumentId ?? active[0]?.id ?? '',
      direction: d.direction ?? null,
      entryType: d.entryType ?? 'SINGLE',
      entryLow: d.entryLow ?? '',
      entryHigh: d.entryHigh ?? '',
      custom: (d.targets?.length ?? 0) > 0 || Boolean(d.stopLoss),
      targets: [...(d.targets ?? []), '', '', ''].slice(0, 3) as [string, string, string],
      stopLoss: d.stopLoss ?? '',
      priority: d.priority ?? 'NORMAL',
      templateId: d.templateId ?? '',
      commentary: d.commentary ?? '',
    });
    setDraftRef({ id: draftRow.id, version: draftRow.version });
    if ((d.targets?.length ?? 0) > 0 || d.commentary || d.templateId) setAdvanced(true);
  }, [active, draftRef, draftRow]);

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
    [computed, form],
  );
  // Same contents, same key: a double tap or a retry after a lost response cannot publish twice.
  const defaultMode = platform.data?.signalStartMode ?? 'AWAITING_ENTRY';
  const defaultWindow = platform.data?.entryExpiryMinutesDefault ?? 0;
  const startsActive =
    !computed.upcoming && (form.startAs === 'DEFAULT' ? defaultMode === 'ACTIVE' : form.startAs === 'ACTIVE');
  const fieldsKey = `${JSON.stringify(fields)}#${cycle}#${form.startAs}#${form.window}`;
  const idempotencyKey = useMemo(() => {
    void fieldsKey;
    return newKey();
  }, [fieldsKey]);
  // The window's end is worked out from the choice, and kept with the key, so a retry keeps the same instant.
  const deadline = useMemo(() => {
    void fieldsKey;
    if (startsActive || form.window === 'DEFAULT') return undefined;
    if (form.window === 'NONE') return null;
    return new Date(Date.now() + Number(form.window) * 60_000).toISOString();
  }, [fieldsKey, form.window, startsActive]);

  const publish = useMutation({
    mutationFn: (confirmDuplicate: boolean) =>
      api.post<{ tradeId: string; replayed: boolean; trade: AdminTradeDetail }>('/admin/signals', {
        ...fields,
        activateOnPublish: computed.upcoming || form.startAs === 'DEFAULT' ? undefined : form.startAs === 'ACTIVE',
        entryExpiresAt: deadline,
        idempotencyKey,
        confirmDuplicate,
        draftId: draftRef?.id,
        draftVersion: draftRef?.version,
      }),
    onSuccess: (result) => {
      setPublished(result.trade);
      setReviewing(false);
      const nextRecent = [form.instrumentId, ...recent.filter((id) => id !== form.instrumentId)].slice(0, 8);
      setRecent(nextRecent);
      void prefs.set(RECENT_KEY, nextRecent);
      void secure.setComposer(null);
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
      void client.invalidateQueries({ queryKey: ['admin'] });
      toast({ title: 'Draft saved', tone: 'success' });
    },
    onError: (error) => toast({ title: 'Draft not saved', body: errorMessage(error), tone: 'error' }),
  });

  const allTemplates = useMemo(() => templates.data?.templates ?? [], [templates.data]);
  const signalTemplates = allTemplates.filter((t) => t.active && isTemplateForDirection(t.kind, form.direction));
  const chosenTemplate = useMemo(() => {
    if (form.templateId && !computed.upcoming) return allTemplates.find((t) => t.id === form.templateId);
    const kind = defaultSignalTemplateKind(form.direction, form.priority, computed.upcoming);
    return allTemplates.find((t) => t.kind === kind && t.isDefault);
  }, [allTemplates, computed.upcoming, form.direction, form.priority, form.templateId]);

  const previewEvent = useMemo(
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

  const ready = Boolean(spec && form.direction && isSignalReady(computed));
  const duplicate =
    publish.error instanceof ApiError && publish.error.code === 'DUPLICATE_SIGNAL' ? publish.error : null;
  const hasWork = Boolean(form.entryLow || form.commentary || form.custom);

  const another = () => {
    setPublished(null);
    setDraftRef(null);
    publish.reset();
    setCycle((n) => n + 1);
    setForm((f) => ({ ...EMPTY, instrumentId: f.instrumentId }));
    setAdvanced(false);
    setTimeout(() => entryInput.current?.focus(), 50);
  };

  if (published) return <Published trade={published} onAnother={another} onDone={() => router.back()} />;

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: c.bg }]} edges={['top', 'bottom']}>
      <View style={[styles.topBar, { borderBottomColor: c.line }]}>
        <T v="heading" accessibilityRole="header" style={{ flex: 1 }}>
          New signal
        </T>
        <Button
          testID="compose-save-draft"
          small
          variant="ghost"
          label="Save draft"
          disabled={!hasWork}
          loading={saveDraft.isPending}
          onPress={() => saveDraft.mutate()}
        />
        <Pressable
          testID="compose-close"
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={8}
          onPress={() => router.back()}
          style={[styles.close, { backgroundColor: c.raised }]}
        >
          <Ionicons name="close" size={20} color={c.text} />
        </Pressable>
      </View>
      <KeyboardArea style={styles.fill}>
        <ScrollView
          testID="compose-scroll"
          style={styles.fill}
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {instruments.isPending && <Loading rows={2} label="Loading instruments" />}
          {instruments.isError && <ErrorState error={instruments.error} onRetry={() => void instruments.refetch()} />}
          {instruments.data && active.length === 0 && (
            <Notice tone="update" title="No instruments are active">
              Add or activate one in the web admin first.
            </Notice>
          )}
          {ordered.length > 0 && (
            <ChipRow>
              {ordered.map((instrument) => (
                <Chip
                  key={instrument.id}
                  testID={`instrument-${instrument.symbol}`}
                  label={instrument.symbol}
                  on={form.instrumentId === instrument.id}
                  onPress={() => set('instrumentId', instrument.id)}
                />
              ))}
            </ChipRow>
          )}
          <View style={styles.directions}>
            <DirectionButton direction="BUY" on={form.direction === 'BUY'} onPress={() => set('direction', 'BUY')} />
            <DirectionButton direction="SELL" on={form.direction === 'SELL'} onPress={() => set('direction', 'SELL')} />
          </View>
          <Segmented
            label="Entry type"
            options={[
              { value: 'SINGLE', label: 'Single price', testID: 'entry-single' },
              { value: 'RANGE', label: 'Price range', testID: 'entry-range' },
            ]}
            value={form.entryType}
            onChange={(value) => set('entryType', value)}
          />
          {form.entryType === 'SINGLE' ? (
            <PriceField
              ref={entryInput}
              testID="entry-price"
              big
              label="Entry"
              value={form.entryLow}
              onChange={(value) => set('entryLow', value)}
              error={issue?.field === 'entryLow' ? issue.message : undefined}
              placeholder={spec ? formatPrice(spec, '0').replace(/,/g, '') : '0.00'}
            />
          ) : (
            <View style={styles.pair}>
              <View style={styles.half}>
                <PriceField
                  ref={entryInput}
                  testID="entry-low"
                  big
                  label="From"
                  value={form.entryLow}
                  onChange={(value) => set('entryLow', value)}
                  error={issue?.field === 'entryLow' ? issue.message : undefined}
                />
              </View>
              <View style={styles.half}>
                <PriceField
                  testID="entry-high"
                  big
                  label="To"
                  value={form.entryHigh}
                  onChange={(value) => set('entryHigh', value)}
                  error={issue?.field === 'entryHigh' ? issue.message : undefined}
                />
              </View>
            </View>
          )}
          <Card style={{ gap: space.md }} testID="compose-levels">
            {form.entryType === 'RANGE' && (
              <Segmented<'NOW' | 'LATER'>
                label="When to set targets and stop-loss"
                value={form.levelsLater ? 'LATER' : 'NOW'}
                onChange={(v) => set('levelsLater', v === 'LATER')}
                options={[
                  { value: 'NOW', label: 'Levels now', testID: 'compose-levels-now' },
                  { value: 'LATER', label: 'At activation', testID: 'compose-levels-later' },
                ]}
              />
            )}
            {computed.upcoming ? (
              <T c="muted" testID="compose-upcoming">
                Subscribers see an upcoming trade with this entry zone. Enter the final entry, targets and stop-loss when
                you activate it.
              </T>
            ) : (
            <>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <T v="label" c="muted" style={{ textTransform: 'uppercase' }}>
                {form.custom ? 'Your levels' : 'Calculated levels'}
              </T>
              {spec && !form.custom && (
                <T v="caption" c="subtle" num>
                  {`${formatPoints(spec.defaultTargetPoints)} / ${formatPoints(spec.defaultStopPoints)} pts`}
                </T>
              )}
            </View>
            {form.custom ? (
              <View style={{ gap: space.md }}>
                {form.targets.map((value, i) => (
                  <PriceField
                    key={i}
                    testID={`custom-target-${i + 1}`}
                    label={i === 0 ? 'Target 1' : `Target ${i + 1} (optional)`}
                    value={value}
                    onChange={(next) => {
                      const targets = [...form.targets] as FormState['targets'];
                      targets[i] = next;
                      set('targets', targets);
                    }}
                  />
                ))}
                <PriceField
                  testID="custom-stop"
                  label="Stop-loss"
                  value={form.stopLoss}
                  onChange={(value) => set('stopLoss', value)}
                />
              </View>
            ) : spec && form.direction && computed.entry && computed.targets.length > 0 ? (
              <Levels
                big
                precision={spec.pricePrecision}
                targets={computed.targets.map((price, i) => ({ index: i + 1, price, status: 'OPEN' as const }))}
                stopLoss={computed.stopLoss}
              />
            ) : (
              <T c="muted">
                {form.direction
                  ? 'Enter an entry price and the target and stop-loss appear here.'
                  : 'Choose BUY or SELL, then enter a price.'}
              </T>
            )}
            {computed.risk && (
              <>
                <Divider />
                <T v="small" c="muted" num testID="compose-risk">
                  {`Stop ${formatPoints(computed.risk.stopPoints)} pts`}
                  {computed.risk.targets
                    .map(
                      (t) =>
                        ` · Target ${t.index} ${formatPoints(t.points)} pts${t.rewardToRisk ? ` (1:${t.rewardToRisk})` : ''}`,
                    )
                    .join('')}
                </T>
              </>
            )}
            {issue && issue.field !== 'entryLow' && issue.field !== 'entryHigh' && (
              <T v="small" c="stop" testID="compose-issue">
                {issue.message}
              </T>
            )}
            <ToggleRow
              testID="compose-custom"
              label={ACTIONS.editLevelsManually}
              value={form.custom}
              onChange={(value) => {
                if (value && computed.auto) {
                  const targets = [...computed.auto.targets, '', '', ''].slice(0, 3) as FormState['targets'];
                  setForm((f) => ({ ...f, custom: true, targets, stopLoss: computed.auto?.stopLoss ?? '' }));
                } else {
                  set('custom', value);
                }
              }}
            />
            </>
            )}
          </Card>
          <Card style={{ gap: space.md }}>
            {!computed.upcoming && (
              <>
                <T v="small" c="muted">
                  Starts as
                </T>
                <Segmented<'AWAITING_ENTRY' | 'ACTIVE'>
                  label="Starts as"
                  value={startsActive ? 'ACTIVE' : 'AWAITING_ENTRY'}
                  onChange={(v) => set('startAs', v === defaultMode ? 'DEFAULT' : v)}
                  options={[
                    { value: 'AWAITING_ENTRY', label: 'Awaiting entry', testID: 'compose-start-waiting' },
                    { value: 'ACTIVE', label: 'Active now', testID: 'compose-start-active' },
                  ]}
                />
              </>
            )}
            {startsActive ? (
              <T v="caption" c="subtle">
                Active as soon as it is published. That is not a fill.
              </T>
            ) : (
              <>
                <T v="small" c="muted">
                  Cancel automatically if not active within
                </T>
                <ChipRow>
                  <Chip
                    testID="compose-window-default"
                    label={defaultWindow > 0 ? `${entryWindowLabel(defaultWindow)} (default)` : 'No limit (default)'}
                    on={form.window === 'DEFAULT'}
                    onPress={() => set('window', 'DEFAULT')}
                  />
                  {ENTRY_WINDOW_CHOICES.filter((m) => m !== defaultWindow).map((m) => (
                    <Chip
                      key={m}
                      testID={`compose-window-${m}`}
                      label={entryWindowLabel(m)}
                      on={form.window === String(m)}
                      onPress={() => set('window', String(m))}
                    />
                  ))}
                  {defaultWindow > 0 && (
                    <Chip label="No limit" on={form.window === 'NONE'} onPress={() => set('window', 'NONE')} />
                  )}
                </ChipRow>
                <T v="caption" c="subtle">
                  Activate it from the trade when the entry is reached. If the window ends first, subscribers are told
                  not to enter.
                </T>
              </>
            )}
          </Card>
          <Pressable
            testID="compose-more"
            accessibilityRole="button"
            accessibilityState={{ expanded: advanced }}
            onPress={() => setAdvanced((v) => !v)}
            style={styles.moreRow}
          >
            <T v="strong" c="muted">
              Priority, wording and comment
            </T>
            <Ionicons name={advanced ? 'chevron-up' : 'chevron-down'} size={18} color={c.muted} />
          </Pressable>
          {advanced && (
            <View style={{ gap: space.md }}>
              <ToggleRow
                testID="compose-priority"
                label="Priority"
                hint="Louder alert, and highlighted in the feed."
                value={form.priority === 'PRIORITY'}
                onChange={(on) => set('priority', on ? 'PRIORITY' : 'NORMAL')}
              />
              {signalTemplates.length > 0 && (
                <View style={{ gap: space.sm }}>
                  <T v="small" c="muted">
                    Wording
                  </T>
                  <ChipRow>
                    <Chip label="Standard" on={!form.templateId} onPress={() => set('templateId', '')} />
                    {signalTemplates.map((template) => (
                      <Chip
                        key={template.id}
                        label={template.name}
                        on={form.templateId === template.id}
                        onPress={() => set('templateId', template.id)}
                      />
                    ))}
                  </ChipRow>
                </View>
              )}
              <Field
                testID="compose-comment"
                label="Comment"
                hint="Optional. Shown to subscribers."
                value={form.commentary}
                onChangeText={(value) => set('commentary', value)}
                multiline
                maxLength={1000}
              />
            </View>
          )}
        </ScrollView>
        <View style={[styles.footer, { borderTopColor: c.line, backgroundColor: c.bg }]}>
          <Button
            testID="compose-review"
            label={ready ? `Review ${form.direction} ${spec?.symbol ?? ''}` : 'Review'}
            variant={form.direction === 'SELL' ? 'sell' : form.direction === 'BUY' ? 'buy' : 'primary'}
            large
            heavy
            disabled={!ready}
            onPress={() => {
              publish.reset();
              setReviewing(true);
            }}
          />
        </View>
      </KeyboardArea>
      {reviewing && previewEvent && (
        <Sheet
          testID="compose-review-sheet"
          title="Review before publishing"
          subtitle="This goes to every active subscriber at once."
          onClose={() => setReviewing(false)}
          footer={
            <>
              {!duplicate && <FormError error={publish.error} />}
              <Button
                testID="compose-publish"
                label={duplicate ? 'Publish anyway' : 'Publish now'}
                variant={duplicate ? 'danger' : form.direction === 'SELL' ? 'sell' : 'buy'}
                large
                heavy
                loading={publish.isPending}
                onPress={() => publish.mutate(duplicate !== null)}
              />
            </>
          }
        >
          <FeedCard event={previewEvent} />
          <View style={{ gap: space.xs }}>
            <T v="label" c="muted" style={{ textTransform: 'uppercase' }}>
              Notification text
            </T>
            <Card testID="compose-notification-preview">
              <T v="strong">{previewEvent.title}</T>
              <T v="small" c="muted">
                {previewEvent.body}
              </T>
            </Card>
          </View>
          <T v="small" c="muted">
            A published signal is a recommendation, not a confirmed trade. It stays in the record and can only be
            changed by a visible update or correction.
          </T>
          {duplicate && (
            <Notice tone="update" title="Possible duplicate" icon="copy-outline">
              {duplicate.message}
            </Notice>
          )}
        </Sheet>
      )}
    </SafeAreaView>
  );
}

function DirectionButton({ direction, on, onPress }: { direction: Direction; on: boolean; onPress: () => void }) {
  const c = useColors();
  const buy = direction === 'BUY';
  const color = buy ? c.buy : c.sell;
  return (
    <Pressable
      testID={`direction-${direction}`}
      accessibilityRole="radio"
      accessibilityState={{ checked: on }}
      accessibilityLabel={direction}
      onPress={onPress}
      style={({ pressed }) => [
        styles.direction,
        {
          backgroundColor: on ? color : buy ? c.buySoft : c.sellSoft,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      <Ionicons name={buy ? 'arrow-up' : 'arrow-down'} size={22} color={on ? c.bg : color} />
      <T v="title" style={{ color: on ? c.bg : color }}>
        {direction}
      </T>
    </Pressable>
  );
}

function Published({
  trade,
  onAnother,
  onDone,
}: {
  trade: AdminTradeDetail;
  onAnother: () => void;
  onDone: () => void;
}) {
  const c = useColors();
  const router = useRouter();
  const live = useQuery({
    queryKey: ['admin', 'trade', trade.id],
    queryFn: () => api.get<AdminTradeDetail>(`/admin/trades/${trade.id}`),
    initialData: trade,
    // Until the worker has finished with this event. Then the figures stop changing.
    refetchInterval: (query) => {
      const stage = query.state.data?.events[0]?.dispatch?.stage;
      return stage === 'COMPLETED' || stage === 'FAILED' ? false : 1500;
    },
  });
  const event = live.data.events[0];
  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: c.bg }]} edges={['top', 'bottom']} testID="compose-published">
      <ScrollView contentContainerStyle={styles.publishedBody}>
        <View style={[styles.published, { backgroundColor: c.successSoft }]}>
          <Ionicons name="checkmark-circle" size={36} color={c.success} />
        </View>
        <T v="title" center accessibilityRole="header">
          Published
        </T>
        <T c="muted" center num>
          {`${trade.direction} ${trade.symbol} · ${trade.ref}`}
        </T>
        <T v="small" c="muted" center testID="published-start">
          {live.data.status === 'PUBLISHED'
            ? live.data.entryExpiresAt
              ? `Awaiting entry. Cancelled automatically if not active by ${formatDateTime(live.data.entryExpiresAt)}.`
              : 'Awaiting entry. Activate it from the trade when the entry is reached.'
            : 'Active now.'}
        </T>
        <Card style={{ alignSelf: 'stretch', gap: space.md }}>
          <Levels
            precision={trade.pricePrecision}
            entryLow={trade.entryLow}
            entryHigh={trade.entryHigh}
            entryType={trade.entryType}
            targets={trade.targets}
            stopLoss={trade.stopLoss}
          />
          <Divider />
          <DispatchStatus dispatch={event?.dispatch ?? null} />
          <T v="caption" c="subtle">
            This shows what was sent, not who saw it. A push service accepting a message does not confirm it arrived.
          </T>
        </Card>
      </ScrollView>
      <View style={[styles.footer, { borderTopColor: c.line }]}>
        <Button testID="published-another" label="Publish another" variant="primary" large onPress={onAnother} />
        <Button
          testID="published-open"
          label="Open trade"
          onPress={() => {
            onDone();
            router.push(`/admin/trades/${trade.id}`);
          }}
        />
        <Button testID="published-done" label="Done" variant="ghost" onPress={onDone} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  close: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  body: { padding: space.lg, gap: space.md, paddingBottom: space.xl },
  directions: { flexDirection: 'row', gap: space.md },
  direction: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    minHeight: 64,
    borderRadius: radius.md,
  },
  pair: { flexDirection: 'row', gap: space.md },
  half: { flex: 1 },
  moreRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  footer: { padding: space.lg, gap: space.sm, borderTopWidth: StyleSheet.hairlineWidth },
  publishedBody: { padding: space.xl, gap: space.md, alignItems: 'center' },
  published: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.xl,
  },
});

export default function ComposeRoute() {
  return (
    <ModalFrame>
      <Compose />
    </ModalFrame>
  );
}

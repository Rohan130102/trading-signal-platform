import { describe, expect, it } from 'vitest';
import {
  ACTION_FROM,
  allowedActions,
  canTransition,
  changeLine,
  isUpcomingSignal,
  previewSignalSchema,
  type ClosureState,
  decide,
  DomainError,
  evolve,
  renderTemplateText,
  defaultTemplate,
  snapshot,
  TERMINAL_STATUSES,
  type TradeCommand,
  type TradeState,
  TRADE_ACTIONS,
  TRADE_STATUSES,
  tradeCommandSchema,
} from '../src/index.js';
import { KEY, NOW, tradeState } from './fixtures.js';

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
type Cmd = DistributiveOmit<TradeCommand, 'expectedVersion' | 'idempotencyKey'>;

const run = (state: TradeState, cmd: Cmd) =>
  decide(state, { expectedVersion: state.version, idempotencyKey: KEY, ...cmd } as TradeCommand, NOW);

const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    if (e instanceof DomainError) return e.code;
    throw e;
  }
  return 'NO_ERROR';
};

describe('state machine', () => {
  it('has no transition out of a terminal state', () => {
    for (const from of TERMINAL_STATUSES) {
      for (const to of TRADE_STATUSES) expect(canTransition(from, to)).toBe(false);
    }
  });

  it('a published signal is never automatically active', () => {
    expect(canTransition('DRAFT', 'ACTIVE')).toBe(false);
    expect(canTransition('PUBLISHED', 'ACTIVE')).toBe(true);
    expect(canTransition('PUBLISHED', 'CLOSED')).toBe(false);
    expect(canTransition('PUBLISHED', 'PARTIALLY_CLOSED')).toBe(false);
  });

  it('every action names at least one source state and drafts allow none', () => {
    for (const action of TRADE_ACTIONS) expect(ACTION_FROM[action].length).toBeGreaterThan(0);
    expect(allowedActions('DRAFT')).toEqual([]);
    // A finished signal can still be corrected, and nothing else.
    expect(allowedActions('CANCELLED')).toEqual(['CORRECT']);
    expect(allowedActions('EXPIRED')).toEqual(['CORRECT']);
  });

  it('rejects an action that is not allowed from the current state', () => {
    const published = tradeState({ status: 'PUBLISHED', activatedAt: null });
    expect(
      code(() =>
        run(published, { action: 'CLOSE', exitPrice: '3450', basis: 'NONE', reason: 'MANUAL', confirm: true }),
      ),
    ).toBe('INVALID_TRANSITION');
    expect(code(() => run(published, { action: 'TARGET_HIT', targetIndex: 1 }))).toBe('INVALID_TRANSITION');
    expect(code(() => run(tradeState(), { action: 'CANCEL' }))).toBe('INVALID_TRANSITION');
    const closed = tradeState({ status: 'CLOSED' });
    expect(code(() => run(closed, { action: 'MOVE_STOP', price: '3200', allowWiden: false }))).toBe(
      'INVALID_TRANSITION',
    );
  });
});

describe('concurrency guard', () => {
  it('rejects a command made against a stale version', () => {
    const state = tradeState({ version: 5 });
    expect(
      code(() => decide(state, { action: 'URGENT', message: 'x', expectedVersion: 4, idempotencyKey: KEY }, NOW)),
    ).toBe('STALE_VERSION');
  });

  it('each event advances the version by exactly one', () => {
    const d = run(tradeState(), { action: 'URGENT', message: 'hold' });
    expect(d.next.version).toBe(3);
    const a = run(tradeState({ status: 'PUBLISHED' }), { action: 'ACTIVATE', actualEntry: '3301', quantity: '2' });
    expect(a.events.map((e) => e.type)).toEqual(['EXECUTION_RECORDED', 'ENTRY_ACTIVATED']);
    expect(a.next.version).toBe(4);
  });
});

describe('activation', () => {
  it('moves to ACTIVE without recording an execution unless one is declared', () => {
    const d = run(tradeState({ status: 'PUBLISHED', activatedAt: null }), { action: 'ACTIVATE' });
    expect(d.next.status).toBe('ACTIVE');
    expect(d.next.activatedAt).toBe(NOW.toISOString());
    expect(d.next.execution).toBeNull();
    expect(d.execution).toBeNull();
  });

  it('keeps a declared quantity out of the broadcast event', () => {
    const d = run(tradeState({ status: 'PUBLISHED' }), { action: 'ACTIVATE', actualEntry: '3301', quantity: '2' });
    const [internal, broadcast] = d.events;
    expect(internal?.broadcast).toBe(false);
    expect(internal?.payload.quantity).toBe('2');
    expect(broadcast?.broadcast).toBe(true);
    expect(JSON.stringify(broadcast?.payload)).not.toContain('quantity');
    expect(d.next.execution).toEqual({ basis: 'ADMIN_DECLARED_EXECUTION', entryPrice: '3301', quantity: '2' });
  });

  it('rejects a quantity with no entry', () => {
    expect(code(() => run(tradeState({ status: 'PUBLISHED' }), { action: 'ACTIVATE', quantity: '2' }))).toBe(
      'VALIDATION',
    );
  });
});

describe('stop-loss changes', () => {
  it('sets the effective stop while the original is retained', () => {
    const d = run(tradeState(), { action: 'MOVE_STOP', price: '3350', allowWiden: false });
    expect(d.next.stopLoss).toBe('3350');
    expect(d.next.originalStopLoss).toBe('3120');
    expect(d.events[0]?.payload).toMatchObject({ previousStop: '3120', newStop: '3350', stopKind: 'MANUAL' });
    expect(d.events[0]?.payload.after?.stopLoss).toBe('3350');
  });

  it('asks for confirmation before widening risk, on both directions', () => {
    expect(
      code(() => run(tradeState({ stopLoss: '3200' }), { action: 'MOVE_STOP', price: '3150', allowWiden: false })),
    ).toBe('WIDENS_RISK');
    expect(
      run(tradeState({ stopLoss: '3200' }), { action: 'MOVE_STOP', price: '3150', allowWiden: true }).next.stopLoss,
    ).toBe('3150');
    const sell = tradeState({
      direction: 'SELL',
      stopLoss: '3400',
      originalStopLoss: '3400',
      targets: [{ index: 1, price: '3150', originalPrice: '3150', status: 'OPEN', hitAt: null }],
    });
    expect(code(() => run(sell, { action: 'MOVE_STOP', price: '3450', allowWiden: false }))).toBe('WIDENS_RISK');
  });

  it('rejects a stop beyond the next open target', () => {
    expect(code(() => run(tradeState(), { action: 'MOVE_STOP', price: '3450', allowWiden: false }))).toBe(
      'STOP_BEYOND_TARGET',
    );
    expect(code(() => run(tradeState(), { action: 'MOVE_STOP', price: '3500', allowWiden: false }))).toBe(
      'STOP_BEYOND_TARGET',
    );
  });

  it('before entry the stop must stay on the loss side of the entry', () => {
    const s = tradeState({ status: 'PUBLISHED' });
    expect(code(() => run(s, { action: 'MOVE_STOP', price: '3310', allowWiden: false }))).toBe('STOP_SIDE');
  });

  it('rejects a no-op and off-tick values', () => {
    expect(code(() => run(tradeState(), { action: 'MOVE_STOP', price: '3120.00', allowWiden: false }))).toBe(
      'NO_CHANGE',
    );
    expect(code(() => run(tradeState(), { action: 'MOVE_STOP', price: '3120.123', allowWiden: false }))).toBe(
      'VALIDATION',
    );
  });

  it('breakeven uses the recorded fill, else a single entry, and never guesses within a range', () => {
    const recorded = tradeState({
      execution: { basis: 'ADMIN_DECLARED_EXECUTION', entryPrice: '3302', quantity: null },
    });
    expect(run(recorded, { action: 'MOVE_STOP_BREAKEVEN' }).next.stopLoss).toBe('3302');
    expect(run(tradeState(), { action: 'MOVE_STOP_BREAKEVEN' }).next.stopLoss).toBe('3300');
    const range = tradeState({ entry: { type: 'RANGE', low: '3290', high: '3300' } });
    expect(code(() => run(range, { action: 'MOVE_STOP_BREAKEVEN' }))).toBe('ENTRY_REQUIRED');
    expect(run(range, { action: 'MOVE_STOP_BREAKEVEN', price: '3295' }).next.stopLoss).toBe('3295');
  });

  it('a trail computes the stop from the reference and can only tighten', () => {
    const d = run(tradeState(), { action: 'TRAIL_STOP', referencePrice: '3400', trailPoints: '50' });
    expect(d.next.stopLoss).toBe('3350');
    // General wording unless the distance is asked for.
    expect(d.events[0]?.templateKind).toBe('STOP_TRAILED_GENERAL');
    expect(d.events[0]?.templateContext.trail).toBeUndefined();
    const detailed = run(tradeState(), {
      action: 'TRAIL_STOP',
      referencePrice: '3400',
      trailPoints: '50',
      wording: 'DETAILED',
    });
    expect(detailed.events[0]?.templateKind).toBe('STOP_TRAILED');
    expect(detailed.events[0]?.templateContext.trail).toBe('50 pts from 3,400.00');
    expect(
      code(() =>
        run(tradeState({ stopLoss: '3380' }), { action: 'TRAIL_STOP', referencePrice: '3400', trailPoints: '50' }),
      ),
    ).toBe('TRAIL_NOT_TIGHTER');
    const sell = tradeState({
      direction: 'SELL',
      stopLoss: '3480',
      originalStopLoss: '3480',
      targets: [{ index: 1, price: '3150', originalPrice: '3150', status: 'OPEN', hitAt: null }],
    });
    expect(run(sell, { action: 'TRAIL_STOP', referencePrice: '3250', trailPoints: '50' }).next.stopLoss).toBe('3300');
  });

  it('a trail can name the new stop directly, which is always worded generally', () => {
    const d = run(tradeState(), { action: 'TRAIL_STOP', price: '3340', wording: 'DETAILED' });
    expect(d.next.stopLoss).toBe('3340');
    expect(d.events[0]?.templateKind).toBe('STOP_TRAILED_GENERAL');
    expect(d.events[0]?.payload.trailPoints).toBeUndefined();
    expect(code(() => run(tradeState(), { action: 'TRAIL_STOP', price: '3340', trailPoints: '10' }))).toBe(
      'VALIDATION',
    );
    expect(code(() => run(tradeState(), { action: 'TRAIL_STOP', referencePrice: '3400' }))).toBe('VALIDATION');
    expect(code(() => run(tradeState({ stopLoss: '3380' }), { action: 'TRAIL_STOP', price: '3340' }))).toBe(
      'TRAIL_NOT_TIGHTER',
    );
  });

  it('the general trail wording renders without any distance', () => {
    const d = run(tradeState(), { action: 'TRAIL_STOP', referencePrice: '3400', trailPoints: '50' });
    const template = defaultTemplate('STOP_TRAILED_GENERAL');
    const body = renderTemplateText(template.body, d.events[0]?.templateContext ?? {});
    expect(body).toMatch(/^Trail the stop-loss on trade T-\d+ to 3,350\.00\.$/);
  });
});

describe('targets', () => {
  const three = tradeState({
    targets: [
      { index: 1, price: '3350', originalPrice: '3350', status: 'OPEN', hitAt: null },
      { index: 2, price: '3400', originalPrice: '3400', status: 'OPEN', hitAt: null },
      { index: 3, price: '3450', originalPrice: '3450', status: 'OPEN', hitAt: null },
    ],
  });

  it('marks a target and any earlier ones as reached', () => {
    const d = run(three, { action: 'TARGET_HIT', targetIndex: 2 });
    expect(d.next.targets.map((t) => t.status)).toEqual(['HIT', 'HIT', 'OPEN']);
    expect(d.next.targets[0]?.hitAt).toBe(NOW.toISOString());
  });

  it('rejects an unknown or already reached target', () => {
    expect(code(() => run(tradeState(), { action: 'TARGET_HIT', targetIndex: 2 }))).toBe('TARGET_NOT_FOUND');
    const hit = run(three, { action: 'TARGET_HIT', targetIndex: 1 }).next;
    expect(code(() => run(hit, { action: 'TARGET_HIT', targetIndex: 1 }))).toBe('NO_CHANGE');
  });

  it('modifying keeps reached targets and renumbers the rest', () => {
    const hit = run(three, { action: 'TARGET_HIT', targetIndex: 1 }).next;
    const d = run(hit, { action: 'MODIFY_TARGETS', targets: ['3420', '3500'] });
    expect(d.next.targets).toMatchObject([
      { index: 1, price: '3350', status: 'HIT' },
      { index: 2, price: '3420', originalPrice: '3400', status: 'OPEN' },
      { index: 3, price: '3500', originalPrice: '3450', status: 'OPEN' },
    ]);
    expect(d.events[0]?.payload.previousTargets).toEqual(['3400', '3450']);
  });

  it('rejects contradictory target changes', () => {
    expect(code(() => run(three, { action: 'MODIFY_TARGETS', targets: ['3250'] }))).toBe('VALIDATION');
    expect(code(() => run(three, { action: 'MODIFY_TARGETS', targets: ['3450', '3400'] }))).toBe('VALIDATION');
    expect(code(() => run(three, { action: 'MODIFY_TARGETS', targets: ['3310', '3320', '3330', '3340'] }))).toBe(
      'VALIDATION',
    );
    const tight = tradeState({ stopLoss: '3320', targets: three.targets });
    expect(code(() => run(tight, { action: 'MODIFY_TARGETS', targets: ['3310'] }))).toBe('STOP_BEYOND_TARGET');
    const hit = run(three, { action: 'TARGET_HIT', targetIndex: 1 }).next;
    expect(code(() => run(hit, { action: 'MODIFY_TARGETS', targets: ['3340'] }))).toBe('VALIDATION');
  });
});

/** As the service stores it: new exits added, superseded ones no longer current. */
const persisted = (s: TradeState, d: ReturnType<typeof decide>, id = 'c1'): TradeState => ({
  ...d.next,
  closures: [
    ...s.closures.filter((c) => !d.closures.some((n) => n.supersedesClosureId === c.id)),
    ...d.closures.map((c, i) => ({ ...c, id: i === 0 ? id : `${id}-${i}` }) as ClosureState),
  ],
});

describe('partial and final closure', () => {
  const declared = tradeState({ execution: { basis: 'ADMIN_DECLARED_EXECUTION', entryPrice: '3300', quantity: '10' } });

  it('books a partial by percentage against a declared position', () => {
    const d = run(declared, {
      action: 'BOOK_PARTIAL',
      exitPrice: '3400',
      percent: '40',
      basis: 'ADMIN_DECLARED_EXECUTION',
      fees: '4',
    });
    expect(d.next.status).toBe('PARTIALLY_CLOSED');
    expect(d.next.closedFraction).toBe('0.4');
    expect(d.closures[0]).toMatchObject({
      quantity: '4',
      fraction: '0.4',
      priceMove: '100',
      grossPnl: '400',
      netPnl: '396',
    });
  });

  it('never closes more than the position across partials', () => {
    const first = run(declared, {
      action: 'BOOK_PARTIAL',
      exitPrice: '3400',
      quantity: '6',
      basis: 'ADMIN_DECLARED_EXECUTION',
    });
    const after = persisted(declared, first);
    expect(after.closedFraction).toBe('0.6');
    expect(
      code(() =>
        run(after, { action: 'BOOK_PARTIAL', exitPrice: '3400', quantity: '5', basis: 'ADMIN_DECLARED_EXECUTION' }),
      ),
    ).toBe('EXCEEDS_POSITION');
    expect(
      code(() =>
        run(after, { action: 'BOOK_PARTIAL', exitPrice: '3400', percent: '50', basis: 'ADMIN_DECLARED_EXECUTION' }),
      ),
    ).toBe('EXCEEDS_POSITION');
    expect(
      code(() =>
        run(after, { action: 'BOOK_PARTIAL', exitPrice: '3400', percent: '40', basis: 'ADMIN_DECLARED_EXECUTION' }),
      ),
    ).toBe('USE_CLOSE');
  });

  it('the final close takes exactly what remains', () => {
    const first = persisted(
      declared,
      run(declared, { action: 'BOOK_PARTIAL', exitPrice: '3400', quantity: '6', basis: 'ADMIN_DECLARED_EXECUTION' }),
    );
    const d = run(first, {
      action: 'CLOSE',
      exitPrice: '3450',
      basis: 'ADMIN_DECLARED_EXECUTION',
      reason: 'TARGET_ACHIEVED',
      confirm: true,
    });
    expect(d.next.status).toBe('CLOSED');
    expect(d.next.closedFraction).toBe('1');
    expect(d.closures[0]).toMatchObject({ quantity: '4', fraction: '0.4', grossPnl: '600', kind: 'FINAL' });
  });

  it('keeps position, fees and money out of broadcast events', () => {
    const d = run(declared, {
      action: 'CLOSE',
      exitPrice: '3450',
      basis: 'ADMIN_DECLARED_EXECUTION',
      reason: 'TARGET_ACHIEVED',
      confirm: true,
      fees: '12',
    });
    const wire = JSON.stringify(d.events[0]?.payload);
    expect(wire).not.toMatch(/quantity|fees|gross|net|Pnl/i);
  });

  it('refuses a declared outcome with no recorded execution', () => {
    expect(
      code(() =>
        run(tradeState(), {
          action: 'CLOSE',
          exitPrice: '3450',
          basis: 'ADMIN_DECLARED_EXECUTION',
          reason: 'MANUAL',
          confirm: true,
        }),
      ),
    ).toBe('EXECUTION_REQUIRED');
  });

  it('a recommended range is never silently treated as a fill', () => {
    const range = tradeState({ entry: { type: 'RANGE', low: '3290', high: '3300' } });
    expect(
      code(() =>
        run(range, {
          action: 'CLOSE',
          exitPrice: '3450',
          basis: 'HYPOTHETICAL_OUTCOME',
          reason: 'MANUAL',
          confirm: true,
        }),
      ),
    ).toBe('HYPOTHETICAL_ENTRY_REQUIRED');
    expect(
      code(() =>
        run(range, {
          action: 'CLOSE',
          exitPrice: '3450',
          basis: 'HYPOTHETICAL_OUTCOME',
          hypotheticalEntry: '3280',
          reason: 'MANUAL',
          confirm: true,
        }),
      ),
    ).toBe('HYPOTHETICAL_OUTSIDE_RANGE');
    const d = run(range, {
      action: 'CLOSE',
      exitPrice: '3450',
      basis: 'HYPOTHETICAL_OUTCOME',
      hypotheticalEntry: '3295',
      reason: 'MANUAL',
      confirm: true,
    });
    expect(d.closures[0]).toMatchObject({ entryPriceUsed: '3295', priceMove: '155', grossPnl: null });
  });

  it('closing with no basis records the exit and produces no figures', () => {
    const d = run(tradeState(), { action: 'CLOSE', exitPrice: '3450', basis: 'NONE', reason: 'MANUAL', confirm: true });
    expect(d.next.status).toBe('CLOSED');
    expect(d.closures[0]).toMatchObject({ priceMove: null, points: null, grossPnl: null, netPnl: null });
    expect(d.events[0]?.templateContext.movement).toBeNull();
  });

  it('does not allow fees without a position', () => {
    expect(
      code(() =>
        run(tradeState(), {
          action: 'CLOSE',
          exitPrice: '3450',
          basis: 'HYPOTHETICAL_OUTCOME',
          fees: '3',
          reason: 'MANUAL',
          confirm: true,
        }),
      ),
    ).toBe('FEES_WITHOUT_POSITION');
  });

  it('refuses mixing bases across exits on one trade', () => {
    const first = persisted(
      tradeState(),
      run(tradeState(), { action: 'BOOK_PARTIAL', exitPrice: '3400', percent: '50', basis: 'HYPOTHETICAL_OUTCOME' }),
    );
    expect(first.closureBasis).toBe('HYPOTHETICAL_OUTCOME');
    expect(
      code(() => run(first, { action: 'CLOSE', exitPrice: '3450', basis: 'NONE', reason: 'MANUAL', confirm: true })),
    ).toBe('BASIS_MISMATCH');
  });

  it('cannot reach the externally verified basis', () => {
    const parsed = tradeCommandSchema.safeParse({
      action: 'CLOSE',
      expectedVersion: 1,
      idempotencyKey: KEY,
      exitPrice: '1',
      basis: 'EXTERNALLY_VERIFIED',
      reason: 'MANUAL',
      confirm: true,
    });
    expect(parsed.success).toBe(false);
  });

  it('requires explicit confirmation to close', () => {
    const parsed = tradeCommandSchema.safeParse({
      action: 'CLOSE',
      expectedVersion: 1,
      idempotencyKey: KEY,
      exitPrice: '1',
      basis: 'NONE',
      reason: 'MANUAL',
      confirm: false,
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a reason that contradicts the numbers', () => {
    expect(
      code(() =>
        run(tradeState(), {
          action: 'CLOSE',
          exitPrice: '3200',
          basis: 'HYPOTHETICAL_OUTCOME',
          reason: 'TARGET_ACHIEVED',
          confirm: true,
        }),
      ),
    ).toBe('REASON_CONTRADICTS_EXIT');
  });

  it('validates exit timing', () => {
    expect(
      code(() =>
        run(tradeState(), {
          action: 'CLOSE',
          exitPrice: '3450',
          basis: 'NONE',
          reason: 'MANUAL',
          confirm: true,
          exitedAt: '2027-01-01T00:00:00Z',
        }),
      ),
    ).toBe('EXIT_IN_FUTURE');
    expect(
      code(() =>
        run(tradeState(), {
          action: 'CLOSE',
          exitPrice: '3450',
          basis: 'NONE',
          reason: 'MANUAL',
          confirm: true,
          exitedAt: '2026-10-01T00:00:00Z',
        }),
      ),
    ).toBe('EXIT_BEFORE_ENTRY');
  });

  it('chooses the wording by reason', () => {
    const close = (reason: 'TARGET_ACHIEVED' | 'STOP_LOSS_HIT' | 'MANUAL', exitPrice: string) =>
      run(tradeState(), { action: 'CLOSE', exitPrice, basis: 'HYPOTHETICAL_OUTCOME', reason, confirm: true }).events[0]
        ?.templateKind;
    expect(close('TARGET_ACHIEVED', '3450')).toBe('FULL_PROFIT_BOOKED');
    expect(close('STOP_LOSS_HIT', '3120')).toBe('STOP_LOSS_HIT');
    expect(close('MANUAL', '3320')).toBe('TRADE_CLOSED');
  });
});

describe('rounding and limits', () => {
  it('thirds of a position close exactly, with no leftover and no overrun', () => {
    let state = tradeState({ execution: { basis: 'ADMIN_DECLARED_EXECUTION', entryPrice: '3300', quantity: '3' } });
    state = persisted(
      state,
      run(state, { action: 'BOOK_PARTIAL', exitPrice: '3400', quantity: '1', basis: 'ADMIN_DECLARED_EXECUTION' }),
      'a',
    );
    state = persisted(
      state,
      run(state, { action: 'BOOK_PARTIAL', exitPrice: '3400', quantity: '1', basis: 'ADMIN_DECLARED_EXECUTION' }),
      'b',
    );
    expect(state.closedFraction).toBe('0.666666666666');
    expect(
      code(() =>
        run(state, { action: 'BOOK_PARTIAL', exitPrice: '3400', quantity: '1', basis: 'ADMIN_DECLARED_EXECUTION' }),
      ),
    ).toBe('USE_CLOSE');
    const final = run(state, {
      action: 'CLOSE',
      exitPrice: '3400',
      basis: 'ADMIN_DECLARED_EXECUTION',
      reason: 'MANUAL',
      confirm: true,
    });
    expect(final.closures[0]).toMatchObject({ quantity: '1', fraction: '0.333333333334', grossPnl: '100' });
    expect(final.next.closedFraction).toBe('1');
  });

  it('computed figures fit the storage scale exactly', () => {
    const spec = { ...tradeState().spec, pointSize: '3' };
    const d = run(tradeState({ spec }), {
      action: 'CLOSE',
      exitPrice: '3301',
      basis: 'HYPOTHETICAL_OUTCOME',
      reason: 'MANUAL',
      confirm: true,
    });
    expect(d.closures[0]?.points).toBe('0.33333333');
  });

  it('refuses results too large to be real instead of failing at the database', () => {
    const state = tradeState({
      execution: { basis: 'ADMIN_DECLARED_EXECUTION', entryPrice: '1', quantity: '99999999999999' },
      spec: { ...tradeState().spec, contractMultiplier: '99999999' },
      entry: { type: 'SINGLE', low: '1', high: '1' },
    });
    expect(
      code(() =>
        run(state, {
          action: 'CLOSE',
          exitPrice: '99999999999999',
          basis: 'ADMIN_DECLARED_EXECUTION',
          reason: 'MANUAL',
          confirm: true,
        }),
      ),
    ).toBe('RESULT_OUT_OF_RANGE');
  });
});

describe('corrections', () => {
  it('records from and to, and updates the effective values', () => {
    const d = run(tradeState({ status: 'PUBLISHED' }), { action: 'CORRECT', reason: 'Typo in stop', stopLoss: '3130' });
    expect(d.next.stopLoss).toBe('3130');
    expect(d.next.originalStopLoss).toBe('3120');
    expect(d.events[0]?.payload.changes).toEqual([{ field: 'Stop-loss', from: '3,120.00', to: '3,130.00' }]);
    expect(d.events[0]?.type).toBe('CORRECTION');
    expect(d.events[0]?.broadcast).toBe(true);
  });

  it('corrects an entry within the same validation rules', () => {
    const d = run(tradeState({ status: 'PUBLISHED' }), { action: 'CORRECT', reason: 'Wrong entry', entryLow: '3305' });
    expect(d.next.entry).toEqual({ type: 'SINGLE', low: '3305', high: '3305' });
    expect(
      code(() =>
        run(tradeState({ status: 'PUBLISHED' }), { action: 'CORRECT', reason: 'Wrong entry', entryLow: '3460' }),
      ),
    ).toBe('VALIDATION');
  });

  it('corrects an exit by superseding, recalculating from the original inputs', () => {
    const base = tradeState();
    const closed = persisted(
      base,
      run(base, { action: 'CLOSE', exitPrice: '3440', basis: 'HYPOTHETICAL_OUTCOME', reason: 'MANUAL', confirm: true }),
    );
    const d = run(closed, { action: 'CORRECT', reason: 'Exit mistyped', closureId: 'c1', exitPrice: '3450' });
    expect(d.closures[0]).toMatchObject({
      supersedesClosureId: 'c1',
      exitPrice: '3450',
      priceMove: '150',
      kind: 'FINAL',
    });
    expect(d.next.status).toBe('CLOSED');
    expect(d.next.closedFraction).toBe('1');
  });

  const closedWith = (base: TradeState, cmd: Cmd) => persisted(base, run(base, cmd));

  it('records the actual entry after the close and measures the exit from it', () => {
    // A range signal closed with no recorded entry, as T-0034 was: no points can be stated.
    const base = tradeState({ entry: { type: 'RANGE', low: '3300', high: '3310' } });
    const closed = closedWith(base, {
      action: 'CLOSE',
      exitPrice: '3460',
      basis: 'NONE',
      reason: 'MANUAL',
      confirm: true,
    });
    expect(closed.closures[0]?.points).toBeNull();

    const d = run(closed, {
      action: 'CORRECT',
      reason: 'Entry was filled at the top of the range',
      actualEntry: '3310',
    });
    expect(d.events.map((e) => [e.type, e.broadcast])).toEqual([
      ['EXECUTION_RECORDED', false],
      ['CORRECTION', true],
    ]);
    expect(d.closures).toHaveLength(1);
    expect(d.closures[0]).toMatchObject({
      supersedesClosureId: 'c1',
      basis: 'ADMIN_DECLARED_EXECUTION',
      entryPriceUsed: '3310',
      exitPrice: '3460',
      points: '150',
      kind: 'FINAL',
    });
    expect(d.next.execution).toEqual({ basis: 'ADMIN_DECLARED_EXECUTION', entryPrice: '3310', quantity: null });
    expect(d.next.closureBasis).toBe('ADMIN_DECLARED_EXECUTION');
    expect(d.next.status).toBe('CLOSED');
    expect(d.events[1]?.payload.changes).toEqual([
      { field: 'Actual entry', from: null, to: '3,310.00' },
      { field: 'Result', from: null, to: '+150 pts (recorded entry)' },
    ]);

    // The stored state is still the replay of its events.
    const replayed = d.events.reduce((state, e) => evolve(state, e.type, e.payload, NOW.toISOString()), closed);
    expect(replayed).toEqual(d.next);
  });

  it('changes a recorded entry and recalculates every exit, keeping quantities', () => {
    const declared = tradeState({
      execution: { basis: 'ADMIN_DECLARED_EXECUTION', entryPrice: '3300', quantity: '10' },
    });
    const part = persisted(
      declared,
      run(declared, { action: 'BOOK_PARTIAL', exitPrice: '3400', percent: '40', basis: 'ADMIN_DECLARED_EXECUTION' }),
      'p1',
    );
    const closed = persisted(
      part,
      run(part, {
        action: 'CLOSE',
        exitPrice: '3450',
        basis: 'ADMIN_DECLARED_EXECUTION',
        reason: 'MANUAL',
        confirm: true,
      }),
      'f1',
    );
    const d = run(closed, { action: 'CORRECT', reason: 'Fill was 3310', actualEntry: '3310' });
    expect(d.closures).toMatchObject([
      { supersedesClosureId: 'p1', quantity: '4', priceMove: '90', grossPnl: '360' },
      { supersedesClosureId: 'f1', quantity: '6', priceMove: '140', grossPnl: '840' },
    ]);
    expect(d.next.execution).toEqual({ basis: 'ADMIN_DECLARED_EXECUTION', entryPrice: '3310', quantity: '10' });
    expect(d.events[1]?.payload.changes?.map((c) => c.field)).toEqual([
      'Actual entry',
      'Result (partial exit at 3,400.00)',
      'Result (final exit at 3,450.00)',
    ]);
  });

  it('corrects the levels of a closed trade without touching its exit', () => {
    const closed = closedWith(tradeState(), {
      action: 'CLOSE',
      exitPrice: '3440',
      basis: 'NONE',
      reason: 'MANUAL',
      confirm: true,
    });
    const d = run(closed, {
      action: 'CORRECT',
      reason: 'Typo in the published stop',
      stopLoss: '3130',
      entryLow: '3305',
    });
    expect(d.next).toMatchObject({ status: 'CLOSED', stopLoss: '3130', entry: { low: '3305', high: '3305' } });
    expect(d.closures).toEqual([]);
  });

  it('corrects any target by number, reached or not', () => {
    const two = tradeState({
      targets: [
        { index: 1, price: '3350', originalPrice: '3350', status: 'HIT', hitAt: '2026-11-02T10:00:00.000Z' },
        { index: 2, price: '3400', originalPrice: '3400', status: 'OPEN', hitAt: null },
      ],
    });
    const d = run(two, { action: 'CORRECT', reason: 'Target 1 was 3355', targetPrices: [{ index: 1, price: '3355' }] });
    expect(d.next.targets).toMatchObject([
      { index: 1, price: '3355', status: 'HIT', hitAt: '2026-11-02T10:00:00.000Z' },
      { index: 2, price: '3400', status: 'OPEN' },
    ]);
    expect(d.events[0]?.payload.changes).toEqual([{ field: 'Target 1 (reached)', from: '3,350.00', to: '3,355.00' }]);
    const fix = (targetPrices: { index: number; price: string }[]) => () =>
      run(two, { action: 'CORRECT', reason: 'targets', targetPrices });
    expect(code(fix([{ index: 2, price: '3340' }]))).toBe('VALIDATION');
    expect(code(fix([{ index: 3, price: '3500' }]))).toBe('TARGET_NOT_FOUND');
    expect(
      code(() =>
        run(two, { action: 'CORRECT', reason: 'both', targets: ['3420'], targetPrices: [{ index: 1, price: '3355' }] }),
      ),
    ).toBe('VALIDATION');
  });

  it('corrects the activation time, an exit time and the close reason', () => {
    const base = tradeState({ publishedAt: '2026-11-01T09:00:00.000Z' });
    const closed = closedWith(base, {
      action: 'CLOSE',
      exitPrice: '3440',
      exitedAt: '2026-11-03T10:00:00.000Z',
      basis: 'NONE',
      reason: 'MANUAL',
      confirm: true,
    });
    const d = run(closed, {
      action: 'CORRECT',
      reason: 'Times were entered late',
      activatedAt: '2026-11-01T09:30:00.000Z',
      closureId: 'c1',
      exitedAt: '2026-11-02T12:00:00.000Z',
      closeReason: 'TARGET_ACHIEVED',
    });
    expect(d.next.activatedAt).toBe('2026-11-01T09:30:00.000Z');
    expect(d.closures[0]).toMatchObject({ exitedAt: '2026-11-02T12:00:00.000Z', reason: 'TARGET_ACHIEVED' });
    expect(d.events[0]?.payload.changes).toEqual([
      { field: 'Activated', from: '2026-11-01 10:00 UTC', to: '2026-11-01 09:30 UTC' },
      { field: 'Exit time', from: '2026-11-03 10:00 UTC', to: '2026-11-02 12:00 UTC' },
      { field: 'Close reason', from: 'Manual close', to: 'Target achieved' },
    ]);
    const at = (cmd: Partial<Extract<Cmd, { action: 'CORRECT' }>>) => () =>
      run(closed, { action: 'CORRECT', reason: 'times', ...cmd });
    expect(code(at({ activatedAt: '2026-11-06T10:00:00.000Z' }))).toBe('ACTIVATION_IN_FUTURE');
    expect(code(at({ activatedAt: '2026-11-01T08:00:00.000Z' }))).toBe('ACTIVATION_BEFORE_PUBLICATION');
    expect(code(at({ activatedAt: '2026-11-03T11:00:00.000Z' }))).toBe('EXIT_BEFORE_ENTRY');
    expect(code(at({ closureId: 'c1', exitedAt: '2026-10-30T10:00:00.000Z' }))).toBe('EXIT_BEFORE_ENTRY');
    expect(code(at({ closureId: 'c1' }))).toBe('NO_CHANGE');
  });

  it('moves a hypothetical outcome with a corrected single entry', () => {
    const closed = closedWith(tradeState(), {
      action: 'CLOSE',
      exitPrice: '3440',
      basis: 'HYPOTHETICAL_OUTCOME',
      reason: 'MANUAL',
      confirm: true,
    });
    const d = run(closed, { action: 'CORRECT', reason: 'Entry was 3310', entryLow: '3310' });
    expect(d.closures[0]).toMatchObject({ entryPriceUsed: '3310', priceMove: '130', basis: 'HYPOTHETICAL_OUTCOME' });
  });

  it('rejects an empty correction and an unknown exit', () => {
    expect(code(() => run(tradeState(), { action: 'CORRECT', reason: 'nothing', stopLoss: '3120' }))).toBe('NO_CHANGE');
    expect(
      code(() =>
        run(tradeState(), {
          action: 'CORRECT',
          reason: 'bad id',
          closureId: '6b1f0a52-4f55-4b8e-9d10-222222222222',
          exitPrice: '3400',
        }),
      ),
    ).toBe('CLOSURE_NOT_FOUND');
  });

  it('corrects a cancelled signal, but records no entry for a trade that never became active', () => {
    const cancelled = tradeState({ status: 'CANCELLED', activatedAt: null });
    expect(run(cancelled, { action: 'CORRECT', reason: 'Stop typo', stopLoss: '3130' }).next.stopLoss).toBe('3130');
    expect(code(() => run(cancelled, { action: 'CORRECT', reason: 'Stop typo', stopLoss: '3310' }))).toBe('STOP_SIDE');
    expect(code(() => run(cancelled, { action: 'CORRECT', reason: 'never filled', actualEntry: '3300' }))).toBe(
      'NOT_ACTIVATED',
    );
  });
});

describe('event integrity', () => {
  it('replaying a trade history reproduces the stored state', () => {
    const start = tradeState({
      status: 'PUBLISHED',
      version: 1,
      activatedAt: null,
      targets: [
        { index: 1, price: '3350', originalPrice: '3350', status: 'OPEN', hitAt: null },
        { index: 2, price: '3450', originalPrice: '3450', status: 'OPEN', hitAt: null },
      ],
    });
    const commands: Cmd[] = [
      { action: 'ACTIVATE', actualEntry: '3301', quantity: '4' },
      { action: 'TARGET_HIT', targetIndex: 1 },
      { action: 'MOVE_STOP_BREAKEVEN' },
      { action: 'MODIFY_TARGETS', targets: ['3500'] },
      { action: 'BOOK_PARTIAL', exitPrice: '3360', percent: '25', basis: 'ADMIN_DECLARED_EXECUTION' },
      { action: 'TRAIL_STOP', referencePrice: '3440', trailPoints: '20' },
      {
        action: 'CLOSE',
        exitPrice: '3500',
        basis: 'ADMIN_DECLARED_EXECUTION',
        reason: 'TARGET_ACHIEVED',
        confirm: true,
      },
    ];
    let state = start;
    let replay = start;
    let i = 0;
    for (const command of commands) {
      const d = run(state, command);
      for (const event of d.events) {
        replay = evolve(replay, event.type, event.payload, NOW.toISOString());
        expect(event.payload.after).toEqual(snapshot(replay));
      }
      state = persisted(state, d, `c${i++}`);
    }
    expect({ ...replay, closures: [] }).toEqual({ ...state, closures: [] });
    expect(state.status).toBe('CLOSED');
    expect(state.stopLoss).toBe('3420');
    expect(state.originalStopLoss).toBe('3120');
  });

  it('does not mutate the state it is given', () => {
    const state = tradeState();
    const frozen = JSON.stringify(state);
    run(state, { action: 'TARGET_HIT', targetIndex: 1 });
    expect(JSON.stringify(state)).toBe(frozen);
  });

  it('rendered text agrees with the structured values', () => {
    const d = run(tradeState(), { action: 'MOVE_STOP', price: '3350', allowWiden: false, comment: 'Lock in gains' });
    const e = d.events[0];
    const title = renderTemplateText(defaultTemplate('STOP_MOVED').title, e?.templateContext ?? {});
    const body = renderTemplateText(defaultTemplate('STOP_MOVED').body, e?.templateContext ?? {});
    expect(title).toBe('Move stop-loss to 3,350.00: BUY XAU/USD');
    expect(body).toContain('moved from 3,120.00 to 3,350.00');
    expect(body).toContain('Lock in gains');
  });
});

describe('upcoming range trades', () => {
  const upcoming = (overrides: Partial<TradeState> = {}) =>
    tradeState({
      status: 'PUBLISHED',
      version: 1,
      entry: { type: 'RANGE', low: '3300', high: '3310' },
      originalStopLoss: null,
      stopLoss: null,
      targets: [],
      activatedAt: null,
      ...overrides,
    });

  it('accepts a range signal with neither target nor stop-loss, and nothing else', () => {
    const base = {
      instrumentId: '6b1f0a52-4f55-4b8e-9d10-222222222222',
      direction: 'BUY',
      entryType: 'RANGE',
      entryLow: '3300',
      entryHigh: '3310',
    };
    expect(previewSignalSchema.safeParse(base).success).toBe(true);
    expect(isUpcomingSignal({ entryType: 'RANGE', targets: [], stopLoss: undefined })).toBe(true);
    expect(previewSignalSchema.safeParse({ ...base, stopLoss: '3200' }).success).toBe(false);
    expect(previewSignalSchema.safeParse({ ...base, targets: ['3400'] }).success).toBe(false);
    expect(previewSignalSchema.safeParse({ ...base, entryType: 'SINGLE', entryHigh: '3300' }).success).toBe(false);
    expect(
      previewSignalSchema.safeParse({
        ...base,
        entryType: 'SINGLE',
        entryHigh: '3300',
        targets: ['3400'],
        stopLoss: '3200',
      }).success,
    ).toBe(true);
  });

  it('refuses activation without the final entry, a target and a stop-loss', () => {
    expect(code(() => run(upcoming(), { action: 'ACTIVATE' }))).toBe('LEVELS_REQUIRED');
    expect(code(() => run(upcoming(), { action: 'ACTIVATE', entryPrice: '3305', targets: ['3400'] }))).toBe(
      'LEVELS_REQUIRED',
    );
    expect(code(() => run(upcoming(), { action: 'ACTIVATE', entryPrice: '3305', stopLoss: '3200' }))).toBe(
      'LEVELS_REQUIRED',
    );
  });

  it('applies the BUY and SELL rules to the final levels', () => {
    expect(
      code(() => run(upcoming(), { action: 'ACTIVATE', entryPrice: '3305', targets: ['3250'], stopLoss: '3200' })),
    ).toBe('VALIDATION');
    expect(
      code(() => run(upcoming(), { action: 'ACTIVATE', entryPrice: '3305', targets: ['3400'], stopLoss: '3350' })),
    ).toBe('VALIDATION');
    const sell = upcoming({ direction: 'SELL' });
    expect(code(() => run(sell, { action: 'ACTIVATE', entryPrice: '3305', targets: ['3200'], stopLoss: '3350' }))).toBe(
      'NO_ERROR',
    );
    expect(code(() => run(sell, { action: 'ACTIVATE', entryPrice: '3305', targets: ['3400'], stopLoss: '3350' }))).toBe(
      'VALIDATION',
    );
  });

  it('activates the same trade with its final levels and keeps the published range in the event', () => {
    const d = run(upcoming(), { action: 'ACTIVATE', entryPrice: '3305', targets: ['3400', '3450'], stopLoss: '3250' });
    expect(d.events.map((e) => e.type)).toEqual(['ENTRY_ACTIVATED']);
    expect(d.next).toMatchObject({
      ref: 'T-0001',
      status: 'ACTIVE',
      entry: { type: 'SINGLE', low: '3305', high: '3305' },
      stopLoss: '3250',
      originalStopLoss: '3250',
    });
    expect(d.next.targets.map((t) => [t.index, t.price, t.originalPrice])).toEqual([
      [1, '3400', '3400'],
      [2, '3450', '3450'],
    ]);
    expect(d.events[0]?.payload).toMatchObject({ finalEntry: '3305', activatedStop: '3250' });
    const text = renderTemplateText(defaultTemplate('ENTRY_ACTIVATED').body, d.events[0]!.templateContext);
    expect(text).toContain('Entry: 3,305.00');
    expect(text).toContain('Target 1: 3,400.00');
    expect(text).toContain('Stop-loss: 3,250.00');
    // Replaying the event reproduces the stored trade.
    expect(evolve(upcoming(), 'ENTRY_ACTIVATED', d.events[0]!.payload, NOW.toISOString())).toMatchObject({
      stopLoss: '3250',
      entry: { type: 'SINGLE', low: '3305' },
    });
  });

  it('refuses levels on a trade that already has them', () => {
    expect(
      code(() =>
        run(tradeState({ status: 'PUBLISHED', version: 1, activatedAt: null }), {
          action: 'ACTIVATE',
          entryPrice: '3300',
          targets: ['3400'],
          stopLoss: '3200',
        }),
      ),
    ).toBe('VALIDATION');
  });

  it('cannot move a stop or targets it does not have, but its range can still be corrected', () => {
    expect(code(() => run(upcoming(), { action: 'MOVE_STOP', price: '3200', allowWiden: false }))).toBe(
      'LEVELS_PENDING',
    );
    expect(code(() => run(upcoming(), { action: 'MODIFY_TARGETS', targets: ['3400'] }))).toBe('LEVELS_PENDING');
    expect(code(() => run(upcoming(), { action: 'CORRECT', reason: 'Typo', stopLoss: '3200' }))).toBe('LEVELS_PENDING');
    const d = run(upcoming(), { action: 'CORRECT', reason: 'Typo', entryLow: '3295', entryHigh: '3310' });
    expect(d.next.entry).toEqual({ type: 'RANGE', low: '3295', high: '3310' });
    expect(d.next.stopLoss).toBeNull();
  });

  it('renders an upcoming trade with no empty target or stop-loss lines', () => {
    const text = renderTemplateText(defaultTemplate('UPCOMING_TRADE').body, {
      entry: '3,300.00 to 3,310.00',
      stop: null,
      target1: null,
    });
    expect(text).toBe('Entry zone: 3,300.00 to 3,310.00\nAwaiting activation');
  });
});

describe('update wording for subscribers', () => {
  it('names the new value and the old one, without the reason or the administrator', () => {
    const d = run(tradeState(), { action: 'CORRECT', reason: 'Fat finger by the desk', stopLoss: '3130' });
    const body = renderTemplateText(defaultTemplate('CORRECTION').body, d.events[0]!.templateContext);
    const title = renderTemplateText(defaultTemplate('CORRECTION').title, d.events[0]!.templateContext);
    expect(title).toBe('Updated: BUY XAU/USD');
    expect(body).toBe('Stop-loss updated: 3,130.00 (was 3,120.00)');
    expect(body).not.toContain('Fat finger');
    // Kept for administrators and the audit trail.
    expect(d.events[0]?.payload.correctionReason).toBe('Fat finger by the desk');
    expect(changeLine({ field: 'Actual entry', from: null, to: '3,310.00' })).toBe('Actual entry: 3,310.00');
  });
});

import {
  aggregateClosures,
  type AdminClosure,
  type CalculationBasis,
  type ClosureRecord,
  type ClosureState,
  eventCategory,
  type EventPayload,
  type EventType,
  type FeedEvent,
  type InstrumentSpec,
  type PublicOutcome,
  type TargetState,
  type TemplateTone,
  type TradeState,
  type TradeSummary,
} from '@signaldesk/domain';
import { Prisma, str } from '../db/prisma.service.js';

type EventRow = Prisma.SignalEventGetPayload<object>;
type ClosureRow = Prisma.TradeClosureGetPayload<object>;
type TradeRow = Prisma.TradeGetPayload<object>;

export function toFeedEvent(row: EventRow, tradeStatus: FeedEvent['tradeStatus']): FeedEvent {
  const type = row.type as EventType;
  return {
    seq: Number(row.seq),
    id: row.id,
    tradeId: row.tradeId,
    tradeVersion: row.tradeVersion,
    type,
    category: eventCategory(type),
    tone: row.tone as TemplateTone,
    priority: row.priority,
    title: row.title,
    body: row.body,
    payload: row.payload as EventPayload,
    tradeStatus,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toClosureState(row: ClosureRow): ClosureState {
  return {
    id: row.id,
    kind: row.kind,
    fraction: str(row.fraction),
    quantity: str(row.quantity),
    exitPrice: str(row.exitPrice),
    exitedAt: row.exitedAt.toISOString(),
    reason: row.reason,
    basis: row.basis,
    entryPriceUsed: str(row.entryPriceUsed),
    multiplierUsed: str(row.multiplierUsed),
    fees: str(row.fees),
    priceMove: str(row.priceMove),
    points: str(row.points),
    grossPnl: str(row.grossPnl),
    netPnl: str(row.netPnl),
    methodologyVersion: row.methodologyVersion,
  };
}

export function toAdminClosure(row: ClosureRow): AdminClosure {
  return {
    ...toClosureState(row),
    superseded: row.supersededByEventId !== null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toClosureRecord(row: ClosureRow): ClosureRecord {
  return {
    fraction: str(row.fraction),
    exitPrice: str(row.exitPrice),
    basis: row.basis as CalculationBasis,
    priceMove: str(row.priceMove),
    points: str(row.points),
    grossPnl: str(row.grossPnl),
    netPnl: str(row.netPnl),
    fees: str(row.fees),
  };
}

/** Requires a published trade. The database CHECK guarantees these columns are present. */
export function toTradeState(row: TradeRow & { closures: ClosureRow[] }): TradeState {
  return {
    ref: row.ref as string,
    status: row.status,
    version: row.version,
    spec: row.instrumentSpec as unknown as InstrumentSpec,
    direction: row.direction as TradeState['direction'],
    entry: {
      type: row.entryType as TradeState['entry']['type'],
      low: str(row.entryLow) as string,
      high: str(row.entryHigh) as string,
    },
    originalStopLoss: str(row.originalStopLoss) as string,
    stopLoss: str(row.stopLoss) as string,
    targets: row.targets as unknown as TargetState[],
    closedFraction: str(row.closedFraction),
    closureBasis: row.closureBasis,
    execution: row.executionEntry
      ? {
          basis: 'ADMIN_DECLARED_EXECUTION',
          entryPrice: str(row.executionEntry),
          quantity: str(row.executionQuantity),
        }
      : null,
    activatedAt: row.activatedAt?.toISOString() ?? null,
    closedAt: row.closedAt?.toISOString() ?? null,
    closures: row.closures.filter((c) => c.supersededByEventId === null).map(toClosureState),
  };
}

export type TradeWithLast = TradeRow & {
  events?: EventRow[];
  _count?: { events: number };
};

export function toTradeSummary(row: TradeWithLast): TradeSummary {
  const spec = row.instrumentSpec as unknown as InstrumentSpec;
  const last = row.events?.[0];
  return {
    id: row.id,
    ref: row.ref as string,
    symbol: spec.symbol,
    displayName: spec.displayName,
    pricePrecision: spec.pricePrecision,
    quoteCurrency: spec.quoteCurrency,
    unitLabel: spec.unitLabel,
    pointSize: spec.pointSize,
    direction: row.direction as TradeSummary['direction'],
    entryType: row.entryType as TradeSummary['entryType'],
    entryLow: str(row.entryLow) as string,
    entryHigh: str(row.entryHigh) as string,
    stopLoss: str(row.stopLoss) as string,
    originalStopLoss: str(row.originalStopLoss) as string,
    targets: row.targets as unknown as TargetState[],
    status: row.status,
    priority: row.priority,
    closedFraction: str(row.closedFraction),
    version: row.version,
    publishedAt: (row.publishedAt as Date).toISOString(),
    activatedAt: row.activatedAt?.toISOString() ?? null,
    closedAt: row.closedAt?.toISOString() ?? null,
    entryExpiresAt: row.entryExpiresAt?.toISOString() ?? null,
    commentary: row.commentary,
    lastEventAt: last?.createdAt.toISOString() ?? null,
    lastEventTitle: last?.title ?? null,
    updatesCount: Math.max(0, (row._count?.events ?? 1) - 1),
  };
}

/** A subscriber's view of an outcome: movement and basis. Position size and money stay internal. */
export function toPublicOutcome(closures: ClosureRow[], fullyClosed: boolean): PublicOutcome | null {
  const current = closures.filter((c) => c.supersededByEventId === null);
  if (current.length === 0) return null;
  const aggregate = aggregateClosures(current.map(toClosureRecord), fullyClosed);
  return {
    basis: aggregate.basis,
    closedFraction: aggregate.closedFraction,
    averageExit: aggregate.averageExit,
    weightedPoints: aggregate.weightedPoints,
    outcome: aggregate.outcome,
    reason: current.find((c) => c.kind === 'FINAL')?.reason ?? null,
  };
}

export function instrumentToSpec(row: Prisma.InstrumentGetPayload<object>): InstrumentSpec {
  return {
    symbol: row.symbol,
    displayName: row.displayName,
    assetClass: row.assetClass,
    quoteCurrency: row.quoteCurrency,
    pricePrecision: row.pricePrecision,
    tickSize: str(row.tickSize),
    pointSize: str(row.pointSize),
    defaultTargetPoints: str(row.defaultTargetPoints),
    defaultStopPoints: str(row.defaultStopPoints),
    defaultTarget2Points: str(row.defaultTarget2Points),
    defaultTarget3Points: str(row.defaultTarget3Points),
    contractMultiplier: str(row.contractMultiplier),
    unitLabel: row.unitLabel,
  };
}

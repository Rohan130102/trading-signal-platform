import type { FeedEvent, PublicOutcome } from '@signaldesk/domain';
import { render, screen } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme';
import { FeedCard, Levels, OutcomeSummary, Timeline } from '@/trade';

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));

const base: FeedEvent = {
  seq: 5,
  id: 'e1',
  tradeId: 'trade-1',
  tradeVersion: 1,
  type: 'SIGNAL_PUBLISHED',
  category: 'NEW_SIGNAL',
  tone: 'BUY',
  priority: 'NORMAL',
  title: 'New signal: BUY XAU/USD',
  body: 'Entry: 3,300.00\nStop-loss: 3,120.00',
  tradeStatus: 'PUBLISHED',
  createdAt: new Date().toISOString(),
  payload: {
    ref: 'T-1',
    symbol: 'XAU/USD',
    direction: 'BUY',
    pricePrecision: 2,
    entryType: 'SINGLE',
    entryLow: '3300',
    entryHigh: '3300',
    after: {
      status: 'PUBLISHED',
      stopLoss: '3120',
      closedFraction: '0',
      targets: [{ index: 1, price: '3450', status: 'OPEN' }],
    },
  },
};

const wrap = (node: React.ReactElement) => render(<ThemeProvider>{node}</ThemeProvider>);

describe('a feed card', () => {
  it('says at once that this is new, which way, and every level', async () => {
    await wrap(<FeedCard event={base} />);
    expect(screen.getByText('New signal')).toBeTruthy();
    expect(screen.getByText('BUY')).toBeTruthy();
    expect(screen.getByText('XAU/USD')).toBeTruthy();
    expect(screen.getByText('Awaiting entry')).toBeTruthy();
    expect(screen.getByText('3,300.00')).toBeTruthy();
    expect(screen.getByText('3,120.00')).toBeTruthy();
    expect(screen.getByText('3,450.00')).toBeTruthy();
  });

  it('says which trade an update changes, and shows before and after', async () => {
    await wrap(
      <FeedCard
        event={{
          ...base,
          type: 'STOP_MOVED',
          category: 'UPDATE',
          tone: 'UPDATE',
          title: 'Stop-loss moved',
          tradeStatus: 'ACTIVE',
          payload: {
            ref: 'T-1',
            symbol: 'XAU/USD',
            direction: 'BUY',
            pricePrecision: 2,
            previousStop: '3120',
            newStop: '3200',
            stopKind: 'MANUAL',
          },
        }}
      />,
    );
    expect(screen.getByText('Update to T-1')).toBeTruthy();
    expect(screen.getByText('3,120.00')).toBeTruthy();
    expect(screen.getByText('3,200.00')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
  });

  it('marks a priority message', async () => {
    await wrap(<FeedCard event={{ ...base, priority: 'PRIORITY' }} />);
    expect(screen.getByText('Priority')).toBeTruthy();
  });

  it('never calls a closure a confirmed result, and always gives its basis', async () => {
    await wrap(
      <FeedCard
        event={{
          ...base,
          type: 'TRADE_CLOSED',
          category: 'CLOSURE',
          tone: 'SUCCESS',
          title: 'Closed',
          tradeStatus: 'CLOSED',
          payload: {
            ref: 'T-1',
            symbol: 'XAU/USD',
            direction: 'BUY',
            pricePrecision: 2,
            exitPrice: '3450',
            movementPoints: '150',
            basis: 'HYPOTHETICAL_OUTCOME',
          },
        }}
      />,
    );
    expect(screen.getByText('Closed: T-1')).toBeTruthy();
    expect(screen.getByText(/\+150 pts \(signal result\)/)).toBeTruthy();
  });

  it('shows an announcement without inventing a trade', async () => {
    await wrap(
      <FeedCard
        event={{
          ...base,
          tradeId: null,
          type: 'ANNOUNCEMENT',
          category: 'ANNOUNCEMENT',
          tone: 'NEUTRAL',
          title: 'Holiday hours',
          tradeStatus: null,
          payload: { message: 'Closed Friday.' },
        }}
      />,
    );
    expect(screen.getByText('Announcement')).toBeTruthy();
    expect(screen.getByText('Closed Friday.')).toBeTruthy();
    expect(screen.queryByText('Awaiting entry')).toBeNull();
  });
});

describe('levels', () => {
  it('shows where the stop-loss was once it has moved', async () => {
    await wrap(<Levels precision={2} targets={[]} stopLoss="3200" originalStopLoss="3120" />);
    expect(screen.getByText('Stop-loss (now)')).toBeTruthy();
    expect(screen.getByText('was 3,120.00')).toBeTruthy();
  });

  it('shows a range as a range', async () => {
    await wrap(
      <Levels precision={2} entryType="RANGE" entryLow="3300" entryHigh="3310" targets={[]} stopLoss="3120" />,
    );
    expect(screen.getByText('Entry range')).toBeTruthy();
    expect(screen.getByText('3,300.00 – 3,310.00')).toBeTruthy();
  });

  it('marks reached targets', async () => {
    await wrap(<Levels precision={2} targets={[{ index: 1, price: '3450', status: 'HIT' }]} stopLoss="3120" />);
    expect(screen.getByText('Target 1, reached')).toBeTruthy();
  });
});

describe('an outcome', () => {
  const outcome: PublicOutcome = {
    basis: 'HYPOTHETICAL_OUTCOME',
    closedFraction: '1',
    averageExit: '3450',
    weightedPoints: '150',
    outcome: 'WIN',
    reason: 'TARGET_ACHIEVED',
  };

  it('describes the signal, not what any subscriber made', async () => {
    await wrap(<OutcomeSummary outcome={outcome} precision={2} />);
    expect(screen.getByText('Favourable')).toBeTruthy();
    expect(screen.getByText('+150 pts')).toBeTruthy();
    expect(screen.getByText(/not what any subscriber achieved/)).toBeTruthy();
  });
});

describe('the timeline', () => {
  it('keeps the original signal separate from what changed after it', async () => {
    await wrap(
      <Timeline
        events={[
          base,
          {
            ...base,
            seq: 6,
            type: 'STOP_MOVED',
            category: 'UPDATE',
            tone: 'UPDATE',
            title: 'Stop-loss moved',
            payload: { pricePrecision: 2, previousStop: '3120', newStop: '3200' },
          },
        ]}
      />,
    );
    expect(screen.getByText('Original signal')).toBeTruthy();
    expect(screen.getByText('Stop-loss moved')).toBeTruthy();
  });
});

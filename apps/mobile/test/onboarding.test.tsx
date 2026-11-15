import type { FeedEvent, MeResponse } from '@signaldesk/domain';
import { act, render, screen } from '@testing-library/react-native';
import { CodeStep } from '@/subscriber/AuthParts';
import { whatsappLinkFor } from '@/subscriber/EnquiryActions';
import { ThemeProvider } from '@/theme';
import { FeedCard } from '@/trade';

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) }));

const wrap = (node: React.ReactElement) => render(<ThemeProvider>{node}</ThemeProvider>);

const upcoming: FeedEvent = {
  seq: 9,
  id: 'u1',
  tradeId: 'trade-9',
  tradeVersion: 1,
  type: 'SIGNAL_PUBLISHED',
  category: 'NEW_SIGNAL',
  tone: 'NEUTRAL',
  priority: 'NORMAL',
  title: 'Upcoming trade: BUY BTC/USD',
  body: 'Entry zone: 65,000.00 to 65,200.00\nAwaiting activation',
  tradeStatus: 'PUBLISHED',
  createdAt: new Date().toISOString(),
  payload: {
    ref: 'T-9',
    symbol: 'BTC/USD',
    direction: 'BUY',
    pricePrecision: 2,
    entryType: 'RANGE',
    entryLow: '65000',
    entryHigh: '65200',
    after: { status: 'PUBLISHED', stopLoss: null, closedFraction: '0', targets: [] },
  },
};

describe('an upcoming trade', () => {
  it('reads as upcoming, with its entry zone and no target or stop-loss', async () => {
    await wrap(<FeedCard event={upcoming} />);
    expect(screen.getByText('Upcoming trade')).toBeTruthy();
    expect(screen.getByText('Awaiting activation')).toBeTruthy();
    expect(screen.getByText('Entry zone')).toBeTruthy();
    expect(screen.getByText('65,000.00 – 65,200.00')).toBeTruthy();
    expect(screen.queryByText(/Stop-loss/)).toBeNull();
    expect(screen.queryByText(/Target/)).toBeNull();
  });

  it('shows its final levels when it is activated', async () => {
    await wrap(
      <FeedCard
        event={{
          ...upcoming,
          type: 'ENTRY_ACTIVATED',
          category: 'UPDATE',
          tone: 'UPDATE',
          title: 'Trade active: BUY BTC/USD',
          tradeStatus: 'ACTIVE',
          payload: { ...upcoming.payload, finalEntry: '65100', activatedTargets: ['65250'], activatedStop: '64920' },
        }}
      />,
    );
    expect(screen.getByText('65,100.00')).toBeTruthy();
    expect(screen.getByText('65,250.00')).toBeTruthy();
    expect(screen.getByText('64,920.00')).toBeTruthy();
  });
});

describe('an updated level', () => {
  it('names the new value and the old one, with no reason or administrator', async () => {
    await wrap(
      <FeedCard
        event={{
          ...upcoming,
          type: 'CORRECTION',
          category: 'UPDATE',
          tone: 'UPDATE',
          title: 'Updated: BUY BTC/USD',
          tradeStatus: 'ACTIVE',
          payload: {
            ...upcoming.payload,
            correctionReason: 'Typed it wrong',
            changes: [{ field: 'Stop-loss', from: '64,800.00', to: '64,920.00' }],
          },
        }}
      />,
    );
    expect(screen.getByText('Stop-loss updated')).toBeTruthy();
    expect(screen.getByText('64,920.00')).toBeTruthy();
    expect(screen.queryByText(/Typed it wrong/)).toBeNull();
    expect(screen.queryByText(/Reason/)).toBeNull();
  });
});

describe('the WhatsApp enquiry', () => {
  it('opens the app with the account details and the configured number', () => {
    const me = {
      support: {
        serviceName: 'Signal Desk',
        whatsapp: '+91-9987255414',
        email: 'help@example.test',
        contact: '',
        renewalInstructions: '',
      },
      profile: { firstName: 'Asha', lastName: 'Rao', email: 'asha@example.test', mobile: '+919876543210' },
    } as MeResponse;
    const link = whatsappLinkFor(me, 'SUBSCRIPTION') as string;
    expect(link.startsWith('whatsapp://send?phone=919987255414&text=')).toBe(true);
    const text = decodeURIComponent(link.split('text=')[1] as string);
    expect(text).toContain('Name: Asha Rao');
    expect(text).toContain('Registered Mobile: +919876543210');
    expect(whatsappLinkFor({ ...me, profile: null }, 'SUBSCRIPTION')).toBeNull();
  });
});

describe('the code screen', () => {
  it('counts down a minute before a new code can be asked for', async () => {
    jest.useFakeTimers();
    const challenge = {
      challengeId: '6b1f0a52-4f55-4b8e-9d10-111111111111',
      email: 'asha@example.test',
      resendAvailableAt: new Date(Date.now() + 60_000).toISOString(),
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    };
    await wrap(
      <CodeStep
        challenge={challenge}
        resendPath="/auth/register/resend"
        verifyPath="/auth/register/verify"
        onVerified={() => undefined}
        onChallenge={() => undefined}
      />,
    );
    expect(screen.getByText('Resend Code in 60s')).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    expect(screen.getByText('Resend Code in 30s')).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(31_000);
    });
    expect(screen.getByText('Resend Code')).toBeTruthy();
    jest.useRealTimers();
  });
});

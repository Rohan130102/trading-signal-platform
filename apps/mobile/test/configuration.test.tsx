import type { AdminSettings, EmailSettingsView, MeResponse, PublicInfo, SubscriberDetail } from '@signaldesk/domain';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';
import SignUp from '../app/(auth)/signup';
import About from '../app/about';
import ConfigurationScreen from '../app/admin/settings';
import { TrialSheet } from '@/admin/SubscriptionSheets';
import { api, ApiError } from '@/lib/api';
import { ThemeProvider } from '@/theme';
import { ToastProvider } from '@/ui';

// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true }),
  useLocalSearchParams: () => ({}),
  Link: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/lib/config', () => ({ API: { origin: 'https://api.test', problem: null }, websiteUrl: () => null }));

let mockInfo: PublicInfo;
let mockEmail: EmailSettingsView;
const mockSettings = {
  serviceName: 'SignalDesk',
  serviceDescription: '',
  businessTimezone: 'Asia/Kolkata',
  aboutBody: '',
  supportWhatsapp: '+919987255414',
  supportEmail: 'help@example.test',
  supportContact: '',
  renewalInstructions: '',
  signupOpen: true,
  defaultTrialDays: 7,
  signalStartMode: 'AWAITING_ENTRY',
  entryExpiryMinutesDefault: 240,
  trailingStopWording: 'GENERAL',
  screenshotsAllowedDefault: false,
  historyScope: 'MEMBERSHIP',
  legalEntityName: '',
  regulatoryStatement: '',
  riskDisclosure: '',
  privacyNotice: '',
  id: 1,
  updatedAt: '2026-11-15T00:00:00.000Z',
  dataResetAt: null,
} satisfies AdminSettings;
jest.mock('@/lib/api', () => ({
  api: {
    get: jest.fn(async (path: string) => {
      if (path === '/public/info') return mockInfo;
      if (path === '/admin/settings/email') return mockEmail;
      if (path === '/admin/settings') return mockSettings;
      return {};
    }),
    post: jest.fn(async () => ({})),
    put: jest.fn(async () => ({})),
    delete: jest.fn(),
  },
  ApiError: class extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
  queryString: () => '',
}));
let mockMe: Partial<MeResponse> | null = null;
jest.mock('@/lib/session', () => ({
  useSession: () => ({ me: mockMe, completeSignUp: jest.fn(), refresh: jest.fn() }),
}));

const wrap = (node: React.ReactElement) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeProvider>
        <ToastProvider>{node}</ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );

const info = (overrides: Partial<PublicInfo> = {}): PublicInfo => ({
  serviceName: 'SignalDesk',
  serviceDescription: 'Clear trade signals.',
  legalEntityName: '',
  regulatoryStatement: '',
  riskDisclosure: '',
  privacyNotice: '',
  supportContact: '',
  supportWhatsapp: '+919987255414',
  supportEmail: 'help@example.test',
  publicResultsAvailable: false,
  aboutBody: 'We publish structured signals.',
  dataResetAt: null,
  signupOpen: true,
  signupAvailable: true,
  ...overrides,
});

beforeEach(() => {
  mockInfo = info();
  mockEmail = {
    enabled: false,
    host: '',
    port: 587,
    security: 'STARTTLS',
    username: '',
    passwordSet: false,
    fromName: '',
    fromAddress: '',
    testedAt: null,
    status: 'NOT_SET_UP',
  };
  mockMe = { isMasterAdmin: true, profile: null };
});

const fillDetails = async () => {
  await fireEvent.changeText(screen.getByTestId('signup-first'), 'Asha');
  await fireEvent.changeText(screen.getByTestId('signup-last'), 'Rao');
  await fireEvent.changeText(screen.getByTestId('signup-email'), 'asha.rao@example.test');
  await fireEvent.changeText(screen.getByTestId('signup-mobile'), '98765 43210');
  await fireEvent.changeText(screen.getByTestId('signup-age'), '34');
  await fireEvent.press(screen.getByTestId('signup-consent'));
};

describe('sign-up', () => {
  it('shows the form even when email is not set up, with no Sign Up tab', async () => {
    mockInfo = info({ signupAvailable: false });
    await wrap(<SignUp />);
    expect(await screen.findByText('Create your account')).toBeTruthy();
    expect(screen.getByText('Step 1 of 3')).toBeTruthy();
    expect(screen.getByTestId('signup-first')).toBeTruthy();
    expect(screen.queryByTestId('tab-signup')).toBeNull();
    expect(screen.queryByText('Sign-up opens soon')).toBeNull();
  });

  it('when no code can be emailed, sends the typed details to the team on WhatsApp, and keeps them on the way back', async () => {
    mockInfo = info({ signupAvailable: false });
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    (api.post as jest.Mock).mockImplementationOnce(async () => {
      throw new ApiError(503, 'EMAIL_NOT_CONFIGURED', 'Email is not set up');
    });
    await wrap(<SignUp />);
    await screen.findByText('Create your account');
    await fillDetails();
    await fireEvent.press(screen.getByTestId('signup-submit'));
    expect(await screen.findByText('We could not send your code')).toBeTruthy();
    expect(screen.getByText('+919876543210')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('signup-whatsapp'));
    const link = String(open.mock.calls[0]?.[0]);
    expect(link).toMatch(/^https:\/\/wa\.me\/919987255414\?text=/);
    const text = decodeURIComponent(link.split('text=')[1] ?? '');
    expect(text).toContain('Name: Asha Rao');
    expect(text).toContain('Email: asha.rao@example.test');
    expect(text).toContain('Mobile: +919876543210');
    expect(screen.getByTestId('signup-email')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('signup-retry'));
    expect(await screen.findByDisplayValue('asha.rao@example.test')).toBeTruthy();
    open.mockRestore();
  });

  it('offers email first when the business has no WhatsApp number', async () => {
    mockInfo = info({ supportWhatsapp: '' });
    (api.post as jest.Mock).mockImplementationOnce(async () => {
      throw new ApiError(503, 'EMAIL_NOT_CONFIGURED', 'Email is not set up');
    });
    await wrap(<SignUp />);
    await screen.findByText('Create your account');
    await fillDetails();
    await fireEvent.press(screen.getByTestId('signup-submit'));
    expect(await screen.findByText('Email my details')).toBeTruthy();
    expect(screen.queryByTestId('signup-whatsapp')).toBeNull();
  });

  it('says it is paused when the Super Admin closed it', async () => {
    mockInfo = info({ signupOpen: false, signupAvailable: false });
    await wrap(<SignUp />);
    expect(await screen.findByText('Sign-up is paused')).toBeTruthy();
    expect(screen.queryByTestId('signup-first')).toBeNull();
  });
});

describe('About us in the app', () => {
  it('shows the text the Super Admin wrote', async () => {
    await wrap(<About />);
    expect(await screen.findByText('We publish structured signals.')).toBeTruthy();
    expect(screen.getByText(/Signals only: we never place trades for you/)).toBeTruthy();
  });
});

describe('the configuration screen', () => {
  it('has the same tabs as the website, and the Email tab says when email is not set up', async () => {
    await wrap(<ConfigurationScreen />);
    for (const tab of ['general', 'contact', 'email', 'signup', 'signals', 'legal']) {
      expect(screen.getByTestId(`config-tab-${tab}`)).toBeTruthy();
    }
    await fireEvent.press(screen.getByTestId('config-tab-email'));
    expect(await screen.findByText('Email is not set up')).toBeTruthy();
    expect(screen.getByTestId('email-test')).toBeTruthy();
  });

  it('is read-only for other administrators, and hides the email account from them', async () => {
    mockMe = { isMasterAdmin: false, profile: null };
    await wrap(<ConfigurationScreen />);
    expect(await screen.findByText(/Only the Super Admin can change the configuration/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('config-tab-email'));
    expect(await screen.findByText('Only the Super Admin can see and change the email account.')).toBeTruthy();
  });
});

describe('free days for a member who already pays', () => {
  it('adds the usual number of days after their last day', async () => {
    const now = Date.now();
    const detail = {
      id: 'sub-1',
      trials: [],
      subscription: {
        state: 'ACTIVE',
        kind: 'PAID',
        timezone: 'Asia/Kolkata',
        startsAt: new Date(now - 86_400_000).toISOString(),
        expiresAt: new Date(now + 20 * 86_400_000).toISOString(),
        lastValidDate: new Date(now + 19 * 86_400_000).toISOString().slice(0, 10),
      },
    } as unknown as SubscriberDetail;
    await wrap(<TrialSheet detail={detail} onClose={jest.fn()} onDone={jest.fn()} />);
    expect(await screen.findByText(/They already have access/)).toBeTruthy();
    expect(await screen.findByText('Add 7 free days')).toBeTruthy();
  });
});

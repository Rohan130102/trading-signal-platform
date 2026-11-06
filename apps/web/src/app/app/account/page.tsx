'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellOff, BellRing, Share, SquarePlus } from 'lucide-react';
import Link from 'next/link';
import { type FormEvent, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Dialog,
  Field,
  FormError,
  Input,
  PageHeader,
  Segmented,
  Switch,
} from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { formatDateTime, formatLocalDate } from '@/lib/format';
import { usePush } from '@/lib/push';
import { signOut, useMe } from '@/lib/session';
import { getTheme, setTheme, type ThemeChoice } from '@/lib/theme';

interface Preferences {
  pushNewSignals: boolean;
  pushUpdates: boolean;
  pushClosures: boolean;
  pushAnnouncements: boolean;
  hidePreview: boolean;
}

function NotificationsCard() {
  const client = useQueryClient();
  const push = usePush();
  const prefs = useQuery({ queryKey: ['prefs'], queryFn: () => api.get<Preferences>('/me/notification-preferences') });
  const devices = useQuery({
    queryKey: ['devices', push.state],
    queryFn: () =>
      api.get<{
        devices: { id: string; deviceLabel: string | null; thisDevice: boolean; lastAcceptedAt: string | null }[];
      }>('/push/devices'),
  });
  const save = useMutation({
    mutationFn: (next: Preferences) => api.put<Preferences>('/me/notification-preferences', next),
    onSuccess: (data) => client.setQueryData(['prefs'], data),
    onError: (e) => toast.error((e as ApiError).message),
  });
  const test = useMutation({
    mutationFn: () => api.post<{ accepted: number; attempted: number }>('/push/test'),
    onSuccess: (r) =>
      toast.success(
        r.accepted > 0
          ? 'Test sent. It should appear on your device in a few seconds.'
          : 'The push service did not accept it. Try turning notifications off and on again.',
      ),
    onError: (e) => toast.error((e as ApiError).message),
  });
  const enable = async () => {
    try {
      await push.enable();
    } catch {
      toast.error('Could not turn on notifications on this device.');
    }
  };
  const toggle = (key: keyof Preferences, value: boolean) => {
    if (prefs.data) save.mutate({ ...prefs.data, [key]: value });
  };

  return (
    <Card id="notifications">
      <CardHeader
        title="Notifications"
        action={
          push.state === 'on' ? (
            <Badge tone="success">
              <BellRing className="size-3" aria-hidden /> On for this device
            </Badge>
          ) : push.state === 'loading' ? null : (
            <Badge>
              <BellOff className="size-3" aria-hidden /> Off for this device
            </Badge>
          )
        }
      />
      <div className="flex flex-col gap-3 px-4 pb-4 sm:px-5">
        {push.state === 'ready' && (
          <div>
            <p className="text-sm text-muted">Get alerts about new signals and changes, even when the app is closed.</p>
            <Button variant="primary" className="mt-2" loading={push.busy} onClick={() => void enable()}>
              Turn on notifications
            </Button>
          </div>
        )}
        {push.state === 'ios-needs-install' && (
          <div className="text-sm">
            <p className="font-medium">On iPhone and iPad, add this app to your Home Screen first.</p>
            <ol className="mt-2 flex flex-col gap-2 text-muted">
              <li className="flex items-center gap-2">
                <Share className="size-4 shrink-0" aria-hidden /> 1. Tap the Share button in Safari.
              </li>
              <li className="flex items-center gap-2">
                <SquarePlus className="size-4 shrink-0" aria-hidden /> 2. Choose &ldquo;Add to Home Screen&rdquo;.
              </li>
              <li className="flex items-center gap-2">
                <BellRing className="size-4 shrink-0" aria-hidden /> 3. Open the app from your Home Screen and come back
                here.
              </li>
            </ol>
          </div>
        )}
        {push.state === 'denied' && (
          <p className="text-sm text-muted">
            Notifications are blocked for this site. Allow them in your browser or phone settings, then reload this
            page. Until then, updates still appear in the feed while the app is open.
          </p>
        )}
        {push.state === 'unsupported' && (
          <p className="text-sm text-muted">
            This browser cannot receive alerts. Updates still appear in the feed while the app is open.
          </p>
        )}
        {push.state === 'unavailable' && (
          <p className="text-sm text-muted">
            Alerts are not available on this service right now. Updates still appear in the feed while the app is open.
          </p>
        )}
        {push.state === 'on' && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" loading={test.isPending} onClick={() => test.mutate()}>
              Send a test
            </Button>
            <Button size="sm" variant="ghost" loading={push.busy} onClick={() => void push.disable()}>
              Turn off on this device
            </Button>
          </div>
        )}
        {prefs.data && (
          <div className="divide-y divide-line border-t border-line pt-1">
            <Switch
              label="New signals"
              checked={prefs.data.pushNewSignals}
              onChange={(v) => toggle('pushNewSignals', v)}
            />
            <Switch
              label="Updates to trades"
              description="Stop-loss moves, targets reached, urgent instructions"
              checked={prefs.data.pushUpdates}
              onChange={(v) => toggle('pushUpdates', v)}
            />
            <Switch
              label="Closed and cancelled trades"
              checked={prefs.data.pushClosures}
              onChange={(v) => toggle('pushClosures', v)}
            />
            <Switch
              label="Announcements"
              checked={prefs.data.pushAnnouncements}
              onChange={(v) => toggle('pushAnnouncements', v)}
            />
            <Switch
              label="Hide details on the lock screen"
              description="Alerts say only &ldquo;New update&rdquo;, with no prices"
              checked={prefs.data.hidePreview}
              onChange={(v) => toggle('hidePreview', v)}
            />
          </div>
        )}
        {(devices.data?.devices.length ?? 0) > 0 && (
          <div className="border-t border-line pt-3">
            <h3 className="text-xs font-medium text-muted">Devices with notifications on</h3>
            <ul className="mt-1 flex flex-col gap-1 text-[13px]">
              {devices.data?.devices.map((d) => (
                <li key={d.id}>
                  {d.deviceLabel ?? 'Device'}
                  {d.thisDevice && <span className="text-muted"> (this one)</span>}
                  {d.lastAcceptedAt && (
                    <span className="text-muted"> · last sent {formatDateTime(d.lastAcceptedAt)}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-xs leading-relaxed text-subtle">
          Phone alerts can arrive late or not at all, depending on your device, its settings and your connection. For
          anything time-sensitive, the feed in this app is the one to trust.
        </p>
      </div>
    </Card>
  );
}

function ChangePassword({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const change = useMutation({
    mutationFn: () => api.post('/auth/change-password', { currentPassword: current, newPassword: next }),
    onSuccess: () => {
      toast.success('Password changed. Your other devices were signed out.');
      setCurrent('');
      setNext('');
      onOpenChange(false);
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    change.mutate();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Change password"
      description="Your other devices will be signed out."
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Current password">
          {(c) => (
            <Input
              {...c}
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          )}
        </Field>
        <Field label="New password" hint="At least 10 characters.">
          {(c) => (
            <Input
              {...c}
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          )}
        </Field>
        <FormError error={change.error} />
        <Button type="submit" variant="primary" loading={change.isPending} disabled={!current || next.length < 10}>
          Change password
        </Button>
      </form>
    </Dialog>
  );
}

export default function AccountPage() {
  const me = useMe();
  const [theme, setThemeState] = useState<ThemeChoice>('dark');
  const [passwordOpen, setPasswordOpen] = useState(false);
  useEffect(() => setThemeState(getTheme()), []);
  const sub = me.data?.subscription;
  const endAll = useMutation({
    mutationFn: () => api.post('/auth/logout-all'),
    onSuccess: () => window.location.assign('/login'),
  });
  return (
    <>
      <PageHeader title="Account" />
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader title="Subscription" />
          <div className="px-4 pb-4 sm:px-5">
            {me.data?.role === 'ADMIN' ? (
              <p className="text-sm text-muted">
                You are signed in as an administrator, so no subscription applies.{' '}
                <Link href="/admin" className="underline">
                  Back to the admin area
                </Link>
              </p>
            ) : (
              sub && (
                <>
                  <p className="text-[15px]">
                    <span className="font-semibold">Active</span>
                    {sub.lastValidDate && (
                      <>
                        {' '}
                        through <span className="font-semibold">{formatLocalDate(sub.lastValidDate)}</span>
                      </>
                    )}
                  </p>
                  <p className="mt-0.5 text-sm text-muted">
                    {sub.daysRemaining} {sub.daysRemaining === 1 ? 'day' : 'days'} left, including today ({sub.timezone}{' '}
                    time).
                  </p>
                  {sub.daysRemaining <= 7 && me.data?.support.renewalInstructions && (
                    <p className="mt-2 text-sm text-update">{me.data.support.renewalInstructions}</p>
                  )}
                </>
              )
            )}
            {me.data?.support.contact && (
              <p className="mt-2 text-sm text-muted">
                Support: <span className="select-all text-text">{me.data.support.contact}</span>
              </p>
            )}
          </div>
        </Card>
        <NotificationsCard />
        <Card>
          <CardHeader title="Appearance" />
          <div className="px-4 pb-4 sm:px-5">
            <Segmented
              label="Theme"
              value={theme}
              onChange={(value) => {
                setThemeState(value);
                setTheme(value);
              }}
              options={[
                { value: 'dark', label: 'Dark' },
                { value: 'light', label: 'Light' },
                { value: 'system', label: 'Device' },
              ]}
            />
          </div>
        </Card>
        <Card>
          <CardHeader title="Sign-in and security" description={me.data ? `Login ID: ${me.data.loginId}` : undefined} />
          <div className="flex flex-wrap gap-2 px-4 pb-4 sm:px-5">
            <Button onClick={() => setPasswordOpen(true)}>Change password</Button>
            <Button onClick={() => void signOut()}>Sign out</Button>
            <Button variant="ghost" loading={endAll.isPending} onClick={() => endAll.mutate()}>
              Sign out everywhere
            </Button>
          </div>
        </Card>
        <p className="text-[13px] text-muted">
          <Link href="/disclosures" className="underline underline-offset-2">
            Risk disclosure and privacy
          </Link>
        </p>
      </div>
      <ChangePassword open={passwordOpen} onOpenChange={setPasswordOpen} />
    </>
  );
}

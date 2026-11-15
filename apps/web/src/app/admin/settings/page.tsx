'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  type AdminSettings,
  approvalSchema,
  ENTRY_WINDOW_CHOICES,
  entryWindowLabel,
  type HistoryScope,
  type PublicInfo,
  settingsBody,
  settingsSchema,
  type SignalStartMode,
  TRIAL_DAY_SHORTCUTS,
  type TrailingStopWording,
} from '@signaldesk/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import {
  Activity,
  AlertTriangle,
  Building2,
  Lock,
  Mail,
  MessageCircle,
  Scale,
  ShieldAlert,
  Unlock,
  UserPlus,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { type FieldErrors, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { EmailSettings } from '@/components/admin/email-settings';
import { MasterOnly } from '@/components/admin/master-only';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Dialog,
  ErrorState,
  Field,
  FormError,
  Input,
  Labeled,
  Loading,
  PageHeader,
  Segmented,
  Select,
  Switch,
  TabPanel,
  Tabs,
  Textarea,
} from '@/components/ui';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useMe } from '@/lib/session';

type SettingsValues = z.input<typeof settingsSchema>;

interface Gate {
  flagEnabled: boolean;
  enabled: boolean;
  currentApprovalId: string | null;
  deploymentFlag: string;
  approvals: {
    id: string;
    jurisdiction: string;
    scope: string;
    reviewerName: string;
    documentReference: string;
    effectiveFrom: string;
    expiresAt: string;
    revokedAt: string | null;
    createdBy: string;
  }[];
}

const TABS = [
  { id: 'general', label: 'General', icon: Building2 },
  { id: 'contact', label: 'Contact', icon: MessageCircle },
  { id: 'email', label: 'Email', icon: Mail },
  { id: 'signup', label: 'Sign-up & trials', icon: UserPlus },
  { id: 'signals', label: 'Signals', icon: Activity },
  { id: 'legal', label: 'Legal', icon: Scale },
] as const;
type TabId = (typeof TABS)[number]['id'];

/** Which tab holds each field, so a problem on a hidden tab is pointed out and opened. */
const FIELD_TAB: Record<keyof SettingsValues, TabId> = {
  serviceName: 'general',
  serviceDescription: 'general',
  businessTimezone: 'general',
  aboutBody: 'general',
  supportWhatsapp: 'contact',
  supportEmail: 'contact',
  supportContact: 'contact',
  renewalInstructions: 'contact',
  signupOpen: 'signup',
  defaultTrialDays: 'signup',
  signalStartMode: 'signals',
  entryExpiryMinutesDefault: 'signals',
  trailingStopWording: 'signals',
  screenshotsAllowedDefault: 'signals',
  historyScope: 'signals',
  legalEntityName: 'legal',
  regulatoryStatement: 'legal',
  riskDisclosure: 'legal',
  privacyNotice: 'legal',
};

const WINDOW_OPTIONS = [...new Set([0, ...ENTRY_WINDOW_CHOICES, 480, 720, 2880, 10080])].sort((a, b) => a - b);

function timezones(current: string): string[] {
  const all = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  return all.includes(current) ? all : [current, ...all];
}

function tabFromUrl(): TabId {
  if (typeof window === 'undefined') return 'general';
  const wanted = new URLSearchParams(window.location.search).get('tab');
  return TABS.some((t) => t.id === wanted) ? (wanted as TabId) : 'general';
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card className="flex flex-col gap-4 p-4 sm:p-5">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
      </div>
      {children}
    </Card>
  );
}

function Configuration({ settings, canEdit }: { settings: AdminSettings; canEdit: boolean }) {
  const client = useQueryClient();
  const me = useMe();
  const [tab, setTab] = useState<TabId>('general');
  useEffect(() => setTab(tabFromUrl()), []);
  const open = (next: TabId) => {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', next);
    window.history.replaceState(null, '', url);
  };
  const initial = useMemo(() => settingsBody(settings) as SettingsValues, [settings]);
  const form = useForm<SettingsValues>({ resolver: zodResolver(settingsSchema), defaultValues: initial });
  const info = useQuery({ queryKey: ['public-info'], queryFn: () => api.get<PublicInfo>('/public/info') });
  const values = form.watch();
  const setRule = <K extends keyof SettingsValues>(key: K, value: SettingsValues[K]) =>
    form.setValue(key, value as never, { shouldDirty: true, shouldValidate: true });
  const windowChoices = WINDOW_OPTIONS.includes(values.entryExpiryMinutesDefault)
    ? WINDOW_OPTIONS
    : [...WINDOW_OPTIONS, values.entryExpiryMinutesDefault];
  const save = useMutation({
    mutationFn: (v: SettingsValues) => api.put<AdminSettings>('/admin/settings', v),
    onSuccess: (next) => {
      client.setQueryData(['admin', 'settings'], next);
      void client.invalidateQueries({ queryKey: ['me'] });
      void client.invalidateQueries({ queryKey: ['public-info'] });
      form.reset(settingsBody(next) as SettingsValues);
      toast.success('Configuration saved');
    },
  });
  const e = form.formState.errors;
  const errorTabs = new Set(Object.keys(e).map((k) => FIELD_TAB[k as keyof SettingsValues]));
  const onInvalid = (errors: FieldErrors<SettingsValues>) => {
    const first = Object.keys(errors)[0] as keyof SettingsValues | undefined;
    if (first) open(FIELD_TAB[first]);
  };
  const dirty = form.formState.isDirty;
  const emailBlocked = info.data ? info.data.signupOpen && !info.data.signupAvailable : false;

  return (
    <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:items-start lg:gap-8">
      <div className="lg:sticky lg:top-6">
        <Tabs<TabId>
          label="Configuration"
          idPrefix="config"
          vertical
          value={tab}
          onChange={open}
          items={TABS.map((t) => ({
            ...t,
            badge:
              errorTabs.has(t.id) || (t.id === 'email' && emailBlocked) ? (
                <span className="size-2 rounded-full bg-update" aria-label="Needs attention" />
              ) : undefined,
          }))}
        />
      </div>
      <form
        onSubmit={(ev) => void form.handleSubmit((v) => save.mutate(v), onInvalid)(ev)}
        className="flex min-w-0 flex-col gap-4 pb-24"
        noValidate
      >
        <fieldset disabled={!canEdit} className="flex min-w-0 flex-col gap-4">
          <TabPanel idPrefix="config" id="general" active={tab === 'general'}>
            <Section title="Your service" description="Shown on the website, in the app and in every email.">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Service name" error={e.serviceName?.message}>
                  {(c) => <Input {...c} {...form.register('serviceName')} />}
                </Field>
                <Field
                  label="Business time zone"
                  error={e.businessTimezone?.message}
                  hint="Decides when a subscription day starts and ends."
                >
                  {(c) => (
                    <Select {...c} {...form.register('businessTimezone')}>
                      {timezones(values.businessTimezone).map((z) => (
                        <option key={z} value={z}>
                          {z.replaceAll('_', ' ')}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </div>
              <Field
                label="Short description"
                error={e.serviceDescription?.message}
                hint="On the home page. Do not state accuracy, returns or guarantees."
              >
                {(c) => <Textarea {...c} rows={2} {...form.register('serviceDescription')} />}
              </Field>
            </Section>
            <Section
              title="About us"
              description="Who you are and how the desk works. Shown on the About page of the website and from the app."
            >
              <Field
                label="About us text"
                error={e.aboutBody?.message}
                hint="Plain text. Leave a blank line between paragraphs."
              >
                {(c) => <Textarea {...c} rows={7} {...form.register('aboutBody')} />}
              </Field>
            </Section>
          </TabPanel>

          <TabPanel idPrefix="config" id="contact" active={tab === 'contact'}>
            <Section
              title="Where enquiries go"
              description="Subscription and renewal enquiries open WhatsApp to this number, or are emailed here."
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="Support WhatsApp number"
                  error={e.supportWhatsapp?.message}
                  hint="Include the country code, such as +91."
                >
                  {(c) => <Input {...c} type="tel" inputMode="tel" {...form.register('supportWhatsapp')} />}
                </Field>
                <Field label="Support email" error={e.supportEmail?.message}>
                  {(c) => <Input {...c} type="email" inputMode="email" {...form.register('supportEmail')} />}
                </Field>
              </div>
            </Section>
            <Section title="What people are told">
              <Field
                label="Support contact line"
                error={e.supportContact?.message}
                hint="Shown publicly and to members, such as “WhatsApp +91 99872 55414, 10am to 6pm”."
              >
                {(c) => <Input {...c} {...form.register('supportContact')} />}
              </Field>
              <Field
                label="Message for members whose access ended"
                error={e.renewalInstructions?.message}
                hint="Optional. Shown with the renewal button."
              >
                {(c) => <Textarea {...c} rows={2} {...form.register('renewalInstructions')} />}
              </Field>
            </Section>
          </TabPanel>

          <TabPanel idPrefix="config" id="signup" active={tab === 'signup'}>
            <Section
              title="Sign-up"
              description="Whether new people can create an account from the website and the app."
            >
              <div className="rounded-lg border border-line px-3">
                <Switch
                  label="Allow new sign-ups"
                  description={
                    values.signupOpen
                      ? 'Anyone can sign up with their email. They get no signals until you start a subscription or trial.'
                      : 'Sign-up is paused. The sign-up screen tells people to contact support.'
                  }
                  checked={values.signupOpen ?? true}
                  disabled={!canEdit}
                  onChange={(v) => setRule('signupOpen', v)}
                />
              </div>
              {emailBlocked && (
                <p
                  className="flex items-start gap-2 rounded-lg bg-update-soft p-3 text-[13px] text-update"
                  role="status"
                >
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>
                    Email is not set up, so sign-up codes cannot be sent. Until it is, people who sign up are asked to
                    send you their details on WhatsApp.{' '}
                    <button
                      type="button"
                      className="font-semibold underline underline-offset-2"
                      onClick={() => open('email')}
                    >
                      Set up email
                    </button>
                  </span>
                </p>
              )}
            </Section>
            <Section
              title="Free trials"
              description="Any administrator can give any member free days, from New Registrations or the member’s page."
            >
              <Field
                label="Usual trial length (days)"
                error={e.defaultTrialDays?.message}
                hint="Filled in when a trial is granted. It can be changed each time, up to 90 days."
              >
                {(c) => (
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      {...c}
                      inputMode="numeric"
                      className="w-24"
                      {...form.register('defaultTrialDays', {
                        setValueAs: (v: string) => (v === '' ? undefined : Number(v)),
                      })}
                    />
                    {TRIAL_DAY_SHORTCUTS.map((d) => (
                      <Button
                        key={d}
                        type="button"
                        size="sm"
                        variant={values.defaultTrialDays === d ? 'primary' : 'secondary'}
                        onClick={() => setRule('defaultTrialDays', d)}
                      >
                        {d} days
                      </Button>
                    ))}
                  </div>
                )}
              </Field>
            </Section>
          </TabPanel>

          <TabPanel idPrefix="config" id="signals" active={tab === 'signals'}>
            <Section
              title="New signals"
              description="Defaults for every new signal. Administrators can still choose differently when they publish one."
            >
              <Labeled
                label="A new signal starts as"
                hint={
                  values.signalStartMode === 'AWAITING_ENTRY'
                    ? 'It waits until an administrator activates it. If its entry window ends first, it is cancelled automatically and members are told not to enter.'
                    : 'It is active as soon as it is published. Activation is recorded separately and is never a fill.'
                }
              >
                <Segmented<SignalStartMode>
                  label="A new signal starts as"
                  value={values.signalStartMode}
                  onChange={(v) => setRule('signalStartMode', v)}
                  options={[
                    { value: 'AWAITING_ENTRY', label: 'Awaiting entry' },
                    { value: 'ACTIVE', label: 'Active immediately' },
                  ]}
                />
              </Labeled>
              <Field
                label="Entry window"
                error={e.entryExpiryMinutesDefault?.message}
                hint="How long a new signal may wait for entry before it is cancelled automatically."
              >
                {(c) => (
                  <Select
                    {...c}
                    value={String(values.entryExpiryMinutesDefault)}
                    onChange={(ev) => setRule('entryExpiryMinutesDefault', Number(ev.target.value))}
                  >
                    {windowChoices.map((m) => (
                      <option key={m} value={m}>
                        {m === 0 ? 'No limit (never cancelled automatically)' : entryWindowLabel(m)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Labeled
                label="Trailing stop-loss alerts"
                hint={
                  values.trailingStopWording === 'GENERAL'
                    ? 'Example: “Trail the stop-loss on trade T-0012 to 3,350.00.”'
                    : 'Example: “Stop-loss on trade T-0012 trailed from 3,300.00 to 3,350.00 (50 pts from 3,400.00).”'
                }
              >
                <Segmented<TrailingStopWording>
                  label="Trailing stop-loss alerts"
                  value={values.trailingStopWording}
                  onChange={(v) => setRule('trailingStopWording', v)}
                  options={[
                    { value: 'GENERAL', label: 'General message' },
                    { value: 'DETAILED', label: 'Show distance in points' },
                  ]}
                />
              </Labeled>
            </Section>
            <Section title="What members see" description="Applied straight away.">
              <Labeled
                label="Each member’s history"
                hint={
                  values.historyScope === 'MEMBERSHIP'
                    ? 'Signals published or still live during their membership. Live signals are always shown.'
                    : 'Every published signal, including those from before they joined.'
                }
              >
                <Segmented<HistoryScope>
                  label="Each member’s history"
                  value={values.historyScope}
                  onChange={(v) => setRule('historyScope', v)}
                  options={[
                    { value: 'MEMBERSHIP', label: 'From their membership' },
                    { value: 'ALL', label: 'Everything' },
                  ]}
                />
              </Labeled>
              <div className="rounded-lg border border-line px-3">
                <Switch
                  label="Allow screenshots"
                  description="The default for members. You can override it for one member on their page."
                  checked={values.screenshotsAllowedDefault}
                  disabled={!canEdit}
                  onChange={(v) => setRule('screenshotsAllowedDefault', v)}
                />
              </div>
              <p className="text-xs leading-relaxed text-subtle">
                When screenshots are blocked: Android blocks screenshots, screen recording and the recent-apps preview.
                iPhone has no supported way to block them; the app hides content from captures where iOS allows it,
                blurs the app switcher and records a screenshot when it notices one. A web browser cannot block
                screenshots at all.
              </p>
            </Section>
          </TabPanel>

          <TabPanel idPrefix="config" id="legal" active={tab === 'legal'}>
            <Section
              title="Legal text"
              description="Have this reviewed by qualified counsel before opening to the public. See the compliance checklist."
            >
              <Field label="Legal entity name" error={e.legalEntityName?.message}>
                {(c) => <Input {...c} {...form.register('legalEntityName')} />}
              </Field>
              <Field
                label="Regulatory statement"
                error={e.regulatoryStatement?.message}
                hint="Empty until your status is established. Never claim a registration or authorisation you do not hold."
              >
                {(c) => <Textarea {...c} rows={3} {...form.register('regulatoryStatement')} />}
              </Field>
              <Field label="Risk disclosure" error={e.riskDisclosure?.message}>
                {(c) => <Textarea {...c} rows={7} {...form.register('riskDisclosure')} />}
              </Field>
              <Field label="Privacy notice" error={e.privacyNotice?.message}>
                {(c) => <Textarea {...c} rows={5} {...form.register('privacyNotice')} />}
              </Field>
            </Section>
          </TabPanel>
        </fieldset>

        {tab === 'email' && (
          <div role="tabpanel" id="config-panel-email" aria-labelledby="config-tab-email">
            <EmailSettings canEdit={canEdit} defaultTestTo={me.data?.profile?.email ?? ''} />
          </div>
        )}
        {tab === 'legal' && <ComplianceGate canEdit={canEdit} />}

        {canEdit && tab !== 'email' && (
          <div
            className={clsx(
              'sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface p-3 shadow-lg transition-opacity',
              dirty ? 'opacity-100' : 'pointer-events-none opacity-0',
            )}
            aria-hidden={!dirty}
          >
            <span className="text-sm font-medium">You have unsaved changes</span>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => form.reset(initial)} tabIndex={dirty ? 0 : -1}>
                Discard
              </Button>
              <Button type="submit" variant="primary" loading={save.isPending} tabIndex={dirty ? 0 : -1}>
                Save changes
              </Button>
            </div>
          </div>
        )}
        <FormError error={save.error} />
      </form>
    </div>
  );
}

type ApprovalValues = z.input<typeof approvalSchema>;

function ApprovalDialog({ onClose }: { onClose: () => void }) {
  const client = useQueryClient();
  const [from, setFrom] = useState('');
  const [until, setUntil] = useState('');
  const form =
    useForm<Pick<ApprovalValues, 'jurisdiction' | 'scope' | 'reviewerName' | 'documentReference' | 'notes'>>();
  const add = useMutation({
    mutationFn: (v: Partial<ApprovalValues>) => {
      const parsed = approvalSchema.parse({
        ...v,
        notes: v.notes || undefined,
        effectiveFrom: from ? new Date(from).toISOString() : '',
        expiresAt: until ? new Date(until).toISOString() : '',
      });
      return api.post('/admin/compliance/public-performance/approvals', parsed);
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['admin', 'gate'] });
      toast.success('Approval recorded');
      onClose();
    },
  });
  return (
    <Dialog
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title="Record a compliance approval"
      description="This records a sign-off that already happened. Recording it here does not itself make anything compliant."
    >
      <form onSubmit={(e) => void form.handleSubmit((v) => add.mutate(v))(e)} className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Jurisdiction">{(c) => <Input {...c} autoFocus {...form.register('jurisdiction')} />}</Field>
          <Field label="Reviewer (name and role)">{(c) => <Input {...c} {...form.register('reviewerName')} />}</Field>
        </div>
        <Field label="What exactly was approved?">
          {(c) => <Textarea {...c} rows={2} {...form.register('scope')} />}
        </Field>
        <Field label="Document reference" hint="Where the signed review is kept.">
          {(c) => <Input {...c} {...form.register('documentReference')} />}
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Effective from">
            {(c) => <Input {...c} type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />}
          </Field>
          <Field label="Expires">
            {(c) => <Input {...c} type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} />}
          </Field>
        </div>
        <Field label="Notes">{(c) => <Textarea {...c} rows={2} {...form.register('notes')} />}</Field>
        <FormError error={add.error} />
        <Button type="submit" variant="primary" size="lg" loading={add.isPending}>
          Record approval
        </Button>
      </form>
    </Dialog>
  );
}

function ComplianceGate({ canEdit }: { canEdit: boolean }) {
  const client = useQueryClient();
  const gate = useQuery({
    queryKey: ['admin', 'gate'],
    queryFn: () => api.get<Gate>('/admin/compliance/public-performance'),
  });
  const [adding, setAdding] = useState(false);
  const revoke = useMutation({
    mutationFn: (id: string) => api.post(`/admin/compliance/public-performance/approvals/${id}/revoke`),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['admin', 'gate'] }),
  });
  if (!gate.data) return null;
  const g = gate.data;
  return (
    <Card>
      <CardHeader
        title="Public performance section"
        description="Showing past results publicly is regulated. It stays closed until both keys below are turned."
        action={
          g.enabled ? (
            <Badge tone="update">
              <Unlock className="size-3" aria-hidden /> Open
            </Badge>
          ) : (
            <Badge>
              <Lock className="size-3" aria-hidden /> Closed
            </Badge>
          )
        }
      />
      <div className="flex flex-col gap-3 border-t border-line p-4 sm:p-5">
        <ol className="flex flex-col gap-2 text-sm">
          <li className="flex items-start gap-2">
            {g.flagEnabled ? (
              <Unlock className="mt-0.5 size-4 text-update" aria-hidden />
            ) : (
              <Lock className="mt-0.5 size-4 text-muted" aria-hidden />
            )}
            <span>
              <span className="font-medium">Deployment setting:</span>{' '}
              <code className="num text-[13px]">{g.deploymentFlag}</code> is {g.flagEnabled ? 'on' : 'off'}. It can only
              be changed on the server.
            </span>
          </li>
          <li className="flex items-start gap-2">
            {g.currentApprovalId ? (
              <Unlock className="mt-0.5 size-4 text-update" aria-hidden />
            ) : (
              <Lock className="mt-0.5 size-4 text-muted" aria-hidden />
            )}
            <span>
              <span className="font-medium">Compliance approval:</span>{' '}
              {g.currentApprovalId ? 'a current approval is on record.' : 'no current approval on record.'}
            </span>
          </li>
        </ol>
        <p className="flex items-start gap-2 rounded-lg bg-update-soft p-3 text-[13px] text-update">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />A disclaimer alone does not make a performance
          claim compliant. In India, past performance claims by research analysts and investment advisers have specific
          rules, so get this reviewed for every jurisdiction you serve.
        </p>
        {g.approvals.length > 0 && (
          <ul className="flex flex-col gap-2">
            {g.approvals.map((a) => (
              <li key={a.id} className="rounded-lg border border-line p-3 text-[13px]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">{a.jurisdiction}</span>
                  {a.revokedAt ? (
                    <Badge tone="stop">Revoked</Badge>
                  ) : a.id === g.currentApprovalId ? (
                    <Badge tone="success">Current</Badge>
                  ) : (
                    <Badge>Not in effect</Badge>
                  )}
                </div>
                <p className="mt-1 text-muted">{a.scope}</p>
                <p className="mt-1 text-muted">
                  {a.reviewerName} · {a.documentReference} · {formatDateTime(a.effectiveFrom)} to{' '}
                  {formatDateTime(a.expiresAt)}
                </p>
                {!a.revokedAt && canEdit && (
                  <Button size="sm" variant="ghost" className="mt-1" onClick={() => revoke.mutate(a.id)}>
                    Revoke
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canEdit && (
          <Button className="self-start" onClick={() => setAdding(true)}>
            Record an approval
          </Button>
        )}
      </div>
      {adding && <ApprovalDialog onClose={() => setAdding(false)} />}
    </Card>
  );
}

export default function SettingsPage() {
  const me = useMe();
  const canEdit = me.data?.isMasterAdmin === true;
  const settings = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: () => api.get<AdminSettings>('/admin/settings'),
  });
  return (
    <MasterOnly>
      <PageHeader title="Configuration" />
      {settings.isPending && <Loading rows={3} label="Loading configuration" />}
      {settings.isError && <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />}
      {settings.data && me.data && <Configuration settings={settings.data} canEdit={canEdit} />}
      {settings.data?.dataResetAt && (
        <p className="mt-3 text-[13px] text-muted">
          Demonstration data was cleared on {formatDateTime(settings.data.dataResetAt)}.
        </p>
      )}
    </MasterOnly>
  );
}

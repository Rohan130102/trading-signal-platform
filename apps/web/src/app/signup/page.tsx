'use client';

import {
  ACTIONS,
  type ChallengeResponse,
  checkNewPassword,
  maskEmail,
  MIN_REGISTRATION_AGE,
  registrationSchema,
  TITLES,
  whatsappDigits,
  whatsappWebLink,
} from '@signaldesk/domain';
import { clsx } from 'clsx';
import { Mail, MessageCircle } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { CodeStep } from '@/components/auth/code-step';
import { Hints, issuesByField, PasswordInput } from '@/components/auth/parts';
import { AuthFrame, usePublicInfo } from '@/components/shell/auth-frame';
import { buttonClass } from '@/components/styles';
import { EnquiryActions } from '@/components/subscriber/enquiry';
import { Button, Field, FormError, Input } from '@/components/ui';
import { api, ApiError } from '@/lib/api';

type Step = 'details' | 'code' | 'password' | 'done' | 'contact';

interface Details {
  firstName: string;
  lastName: string;
  email: string;
  mobile: string;
  age: string;
  consent: boolean;
}

/** What was typed, checked: the mobile number has its country code. */
interface Checked {
  firstName: string;
  lastName: string;
  email: string;
  mobile: string;
  age: number;
}

const EMPTY: Details = { firstName: '', lastName: '', email: '', mobile: '', age: '', consent: false };

const STEP_NAMES = ['Your details', 'Verify email', 'Create password'] as const;

/** How far through sign-up the person is, as a bar and in words. */
function Progress({ step }: { step: 1 | 2 | 3 }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <div className="flex flex-1 gap-1.5" aria-hidden>
        {[1, 2, 3].map((n) => (
          <span key={n} className={clsx('h-1 flex-1 rounded-full', n <= step ? 'bg-text' : 'bg-line-strong')} />
        ))}
      </div>
      <p className="text-xs font-medium text-muted">
        Step {step} of 3<span className="sr-only">: {STEP_NAMES[step - 1]}</span>
      </p>
    </div>
  );
}

/** Email could not send a code. Nothing is lost: the details go to the team, who set up the account. */
const EMAIL_PROBLEMS = new Set(['EMAIL_NOT_CONFIGURED', 'EMAIL_SEND_FAILED']);

function DetailsStep({
  form,
  setForm,
  onSent,
  onEmailProblem,
}: {
  form: Details;
  setForm: (update: (form: Details) => Details) => void;
  onSent: (challenge: ChallengeResponse) => void;
  onEmailProblem: (details: Checked) => void;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  // Editing a field clears its message: it was about the old value.
  const set = (key: keyof Details) => (value: string | boolean) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => {
      const { [key]: _cleared, ...rest } = e;
      return rest;
    });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const body = { ...form, age: form.age.trim() === '' ? undefined : Number(form.age) };
    const parsed = registrationSchema.safeParse(body);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0])] ??= issue.message;
      setErrors(next);
      return;
    }
    setErrors({});
    setBusy(true);
    setError(null);
    try {
      onSent(await api.post<ChallengeResponse>('/auth/register', body));
    } catch (e) {
      setBusy(false);
      if (e instanceof ApiError && EMAIL_PROBLEMS.has(e.code)) {
        const { consent: _consent, ...details } = parsed.data;
        onEmailProblem(details);
        return;
      }
      setErrors(issuesByField(e));
      setError(e);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4" noValidate>
      <div className="grid grid-cols-2 gap-3">
        <Field label="First name" error={errors.firstName}>
          {(control) => (
            <Input
              {...control}
              autoComplete="given-name"
              autoFocus
              value={form.firstName}
              onChange={(e) => set('firstName')(e.target.value)}
            />
          )}
        </Field>
        <Field label="Last name" error={errors.lastName}>
          {(control) => (
            <Input
              {...control}
              autoComplete="family-name"
              value={form.lastName}
              onChange={(e) => set('lastName')(e.target.value)}
            />
          )}
        </Field>
      </div>
      <Field label="Email address" error={errors.email} hint="We send a code to this address to confirm it.">
        {(control) => (
          <Input
            {...control}
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            value={form.email}
            onChange={(e) => set('email')(e.target.value)}
          />
        )}
      </Field>
      <Field
        label="Mobile number"
        error={errors.mobile}
        hint="Your WhatsApp number if you have one. Without a country code, +91 is used."
      >
        {(control) => (
          <Input
            {...control}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="+91 98765 43210"
            value={form.mobile}
            onChange={(e) => set('mobile')(e.target.value)}
          />
        )}
      </Field>
      <Field label="Age" error={errors.age} className="max-w-32">
        {(control) => (
          <Input
            {...control}
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={3}
            value={form.age}
            onChange={(e) => set('age')(e.target.value.replace(/\D/g, ''))}
          />
        )}
      </Field>
      <label className="flex items-start gap-2.5 text-[13px] text-muted">
        <input
          type="checkbox"
          className="mt-0.5 size-4 accent-current"
          checked={form.consent}
          onChange={(e) => set('consent')(e.target.checked)}
          aria-invalid={errors.consent ? true : undefined}
        />
        <span>
          I am {MIN_REGISTRATION_AGE} or older and accept the{' '}
          <Link href="/disclosures" target="_blank" className="font-medium text-text underline">
            privacy notice
          </Link>
          .
        </span>
      </label>
      {errors.consent && (
        <p className="-mt-2 text-[13px] text-stop" role="alert">
          {errors.consent}
        </p>
      )}
      <FormError error={Object.keys(errors).length > 0 ? null : error} />
      <Button type="submit" variant="primary" size="lg" loading={busy} className="w-full">
        Continue
      </Button>
      <p className="text-center text-[13px] text-muted">
        Already have an account?{' '}
        <Link href="/login" className="rounded font-semibold text-text hover:underline">
          {ACTIONS.logIn}
        </Link>
      </p>
    </form>
  );
}

function PasswordStep({ setupToken, onDone }: { setupToken: string; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const check = checkNewPassword(password, confirm);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!check.ok) {
      setError(new Error(password.length < 10 ? 'Use at least 10 characters.' : 'The passwords do not match.'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/register/complete', { setupToken, password });
      onDone();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };
  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4" noValidate>
      <Field label="Create password">
        {(control) => (
          <PasswordInput
            {...control}
            autoFocus
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
      </Field>
      <Field label="Confirm password">
        {(control) => (
          <PasswordInput
            {...control}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        )}
      </Field>
      <Hints hints={check.hints} />
      <FormError error={error} />
      <Button type="submit" variant="primary" size="lg" loading={busy} className="w-full">
        {ACTIONS.createAccount}
      </Button>
    </form>
  );
}

/**
 * When no code could be emailed. The person's details are not lost: one tap sends them to the team on WhatsApp,
 * or by email when there is no WhatsApp number, and the team sets up the account.
 */
function ContactStep({
  details,
  serviceName,
  whatsapp,
  email,
  onBack,
}: {
  details: Checked;
  serviceName: string;
  whatsapp: string;
  email: string;
  onBack: () => void;
}) {
  const message = [
    `Hello, I would like to create a ${serviceName} account.`,
    `Name: ${details.firstName} ${details.lastName}`,
    `Email: ${details.email}`,
    `Mobile: ${details.mobile}`,
    `Age: ${details.age}`,
  ].join('\n');
  const whatsappLink = whatsappWebLink(whatsapp, message);
  const mailLink = email
    ? `mailto:${email}?subject=${encodeURIComponent(`New account: ${details.firstName} ${details.lastName}`)}&body=${encodeURIComponent(message)}`
    : null;
  return (
    <div className="flex flex-col gap-3">
      <dl className="mb-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 rounded-xl border border-line bg-bg p-4 text-sm">
        <dt className="text-muted">Name</dt>
        <dd className="truncate font-medium">
          {details.firstName} {details.lastName}
        </dd>
        <dt className="text-muted">Email</dt>
        <dd className="truncate font-medium">{details.email}</dd>
        <dt className="text-muted">Mobile</dt>
        <dd className="num truncate font-medium">{details.mobile}</dd>
      </dl>
      {whatsappLink && (
        <a href={whatsappLink} target="_blank" rel="noreferrer" className={buttonClass('primary', 'lg', 'w-full')}>
          <MessageCircle className="size-4" aria-hidden />
          Send my details on WhatsApp
        </a>
      )}
      {mailLink && (
        <a href={mailLink} className={buttonClass(whatsappLink ? 'secondary' : 'primary', 'lg', 'w-full')}>
          <Mail className="size-4" aria-hidden />
          {whatsappLink ? 'Email them instead' : 'Email my details'}
        </a>
      )}
      {!whatsappLink && !mailLink && (
        <p className="text-sm text-muted">Please try again later. Your details have not been sent anywhere.</p>
      )}
      <Button variant="ghost" size="lg" className="w-full" onClick={onBack}>
        Try again
      </Button>
    </div>
  );
}

/** Shown instead of the form only while the Super Admin has paused sign-up, with a way to reach the team. */
function SignupPaused({ whatsapp, email }: { whatsapp: string; email: string }) {
  const digits = whatsappDigits(whatsapp);
  return (
    <AuthFrame
      title="Sign-up is paused"
      description="New accounts cannot be created at the moment. Message our team and they will help you join."
    >
      <div className="flex flex-col gap-3">
        {digits && (
          <a
            href={`https://wa.me/${digits}`}
            target="_blank"
            rel="noreferrer"
            className={buttonClass('primary', 'lg', 'w-full')}
          >
            <MessageCircle className="size-4" aria-hidden />
            Message us on WhatsApp
          </a>
        )}
        {email && (
          <a href={`mailto:${email}`} className={buttonClass(digits ? 'secondary' : 'primary', 'lg', 'w-full')}>
            <Mail className="size-4" aria-hidden />
            Email {email}
          </a>
        )}
        <p className="mt-2 text-center text-[13px] text-muted">
          Already have an account?{' '}
          <Link href="/login" className="rounded font-semibold text-text hover:underline">
            {ACTIONS.logIn}
          </Link>
        </p>
      </div>
    </AuthFrame>
  );
}

export default function SignupPage() {
  const router = useRouter();
  const info = usePublicInfo();
  const [step, setStep] = useState<Step>('details');
  // Kept here, so going back from a later step shows what was typed.
  const [form, setForm] = useState<Details>(EMPTY);
  const [challenge, setChallenge] = useState<ChallengeResponse | null>(null);
  const [setupToken, setSetupToken] = useState<string | null>(null);
  const [checked, setChecked] = useState<Checked | null>(null);

  if (step === 'details' && info.data && !info.data.signupOpen) {
    return <SignupPaused whatsapp={info.data.supportWhatsapp} email={info.data.supportEmail} />;
  }

  if (step === 'contact' && checked) {
    return (
      <AuthFrame
        title="We could not send your code"
        description="Email codes are not working on our side right now. Send your details to our team and they will set up your account."
      >
        <ContactStep
          details={checked}
          serviceName={info.data?.serviceName ?? 'SignalDesk'}
          whatsapp={info.data?.supportWhatsapp ?? ''}
          email={info.data?.supportEmail ?? ''}
          onBack={() => setStep('details')}
        />
      </AuthFrame>
    );
  }

  if (step === 'done') {
    return (
      <AuthFrame title={TITLES.accountCreated} description="Your account is ready, and you are logged in.">
        <div className="mb-5 rounded-xl border border-line bg-bg p-4">
          <p className="font-semibold">No Active Subscription</p>
          <p className="mt-1 text-sm text-muted">Contact our support team to explore subscription options.</p>
        </div>
        <EnquiryActions purpose="SUBSCRIPTION" primaryLabel={ACTIONS.sendEnquiry} />
        <Button variant="ghost" size="lg" className="mt-2 w-full" onClick={() => router.replace('/app')}>
          {ACTIONS.doLater}
        </Button>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame
      eyebrow={<Progress step={step === 'details' ? 1 : step === 'code' ? 2 : 3} />}
      title={
        step === 'details' ? 'Create your account' : step === 'code' ? ACTIONS.verifyEmail : ACTIONS.createPassword
      }
      description={
        step === 'details'
          ? 'It takes a minute. You get signals once your subscription or trial starts.'
          : step === 'code'
            ? `Enter the 6-digit code we sent to ${maskEmail(challenge?.email ?? '')}.`
            : 'You will use it with your email address to log in.'
      }
    >
      {step === 'details' && (
        <DetailsStep
          form={form}
          setForm={setForm}
          onSent={(c) => {
            setChallenge(c);
            setStep('code');
          }}
          onEmailProblem={(details) => {
            setChecked(details);
            setStep('contact');
          }}
        />
      )}
      {step === 'code' && challenge && (
        <>
          <CodeStep
            challenge={challenge}
            resendPath="/auth/register/resend"
            verifyPath="/auth/register/verify"
            onChallenge={setChallenge}
            onVerified={(result) => {
              setSetupToken((result as { setupToken: string }).setupToken);
              setStep('password');
            }}
          />
          <Button variant="ghost" size="sm" className="mt-3" onClick={() => setStep('details')}>
            Change email
          </Button>
        </>
      )}
      {step === 'password' && setupToken && <PasswordStep setupToken={setupToken} onDone={() => setStep('done')} />}
    </AuthFrame>
  );
}

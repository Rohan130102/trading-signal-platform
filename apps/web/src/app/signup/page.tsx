'use client';

import {
  ACTIONS,
  type ChallengeResponse,
  checkNewPassword,
  maskEmail,
  MIN_REGISTRATION_AGE,
  registrationSchema,
  TITLES,
} from '@signaldesk/domain';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { CodeStep } from '@/components/auth/code-step';
import { AuthTabs, Hints, issuesByField, PasswordInput } from '@/components/auth/parts';
import { AuthFrame } from '@/components/shell/auth-frame';
import { EnquiryActions } from '@/components/subscriber/enquiry';
import { Button, Field, FormError, Input } from '@/components/ui';
import { api } from '@/lib/api';

type Step = 'details' | 'code' | 'password' | 'done';

interface Details {
  firstName: string;
  lastName: string;
  email: string;
  mobile: string;
  age: string;
  consent: boolean;
}

function DetailsStep({ onSent }: { onSent: (challenge: ChallengeResponse) => void }) {
  const [form, setForm] = useState<Details>({ firstName: '', lastName: '', email: '', mobile: '', age: '', consent: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof Details) => (value: string | boolean) => setForm((f) => ({ ...f, [key]: value }));

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
      setErrors(issuesByField(e));
      setError(e);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4" noValidate>
      <div className="grid grid-cols-2 gap-3">
        <Field label="First name" error={errors.firstName}>
          {(control) => (
            <Input {...control} autoComplete="given-name" autoFocus value={form.firstName} onChange={(e) => set('firstName')(e.target.value)} />
          )}
        </Field>
        <Field label="Last name" error={errors.lastName}>
          {(control) => (
            <Input {...control} autoComplete="family-name" value={form.lastName} onChange={(e) => set('lastName')(e.target.value)} />
          )}
        </Field>
      </div>
      <Field label="Email address" error={errors.email}>
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
      <Field label="Mobile number" error={errors.mobile} hint="Without a country code, +91 is used.">
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
        {ACTIONS.createAccount}
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
          <PasswordInput {...control} autoFocus autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        )}
      </Field>
      <Field label="Confirm password">
        {(control) => (
          <PasswordInput {...control} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        )}
      </Field>
      <Hints hints={check.hints} />
      <FormError error={error} />
      <Button type="submit" variant="primary" size="lg" loading={busy} className="w-full">
        {ACTIONS.createPassword}
      </Button>
    </form>
  );
}

export default function SignupPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('details');
  const [challenge, setChallenge] = useState<ChallengeResponse | null>(null);
  const [setupToken, setSetupToken] = useState<string | null>(null);

  if (step === 'done') {
    return (
      <AuthFrame title={TITLES.accountCreated} description="Your account is ready.">
        <div className="mb-5 rounded-xl border border-line bg-surface p-4">
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

  const titles: Record<Exclude<Step, 'done'>, { title: string; description?: string }> = {
    details: { title: 'Create your account' },
    code: { title: ACTIONS.verifyEmail, description: `Enter the code we sent to ${maskEmail(challenge?.email ?? '')}.` },
    password: { title: ACTIONS.createPassword },
  };

  return (
    <AuthFrame title={titles[step].title} description={titles[step].description}>
      {step === 'details' && <AuthTabs current="signup" />}
      {step === 'details' && (
        <DetailsStep
          onSent={(c) => {
            setChallenge(c);
            setStep('code');
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

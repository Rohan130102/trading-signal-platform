'use client';

import { ACTIONS, type ChallengeResponse, maskEmail, passwordResetRequestSchema, TITLES } from '@signaldesk/domain';
import { CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { CodeStep } from '@/components/auth/code-step';
import { AuthFrame } from '@/components/shell/auth-frame';
import { Button, buttonClass, Field, FormError, Input } from '@/components/ui';
import { api } from '@/lib/api';

/**
 * Recovery: prove the address, then an administrator issues a temporary password. Nothing here says whether an
 * account exists until the code has been entered.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState<ChallengeResponse | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = passwordResetRequestSchema.safeParse({ email });
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? 'Enter a valid email address');
      return;
    }
    setFieldError(null);
    setBusy(true);
    setError(null);
    try {
      setChallenge(await api.post<ChallengeResponse>('/auth/password-reset', parsed.data));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <AuthFrame title={TITLES.passwordResetRequested}>
        <div className="flex gap-3 rounded-xl border border-line bg-surface p-4" role="status">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
          <div className="text-sm">
            <p>Your request has been sent to our support team.</p>
            <p className="mt-1 text-muted">You will receive instructions to access your account.</p>
          </div>
        </div>
        <Link href="/login" className={buttonClass('secondary', 'lg', 'mt-5 w-full')}>
          Back to {ACTIONS.logIn}
        </Link>
      </AuthFrame>
    );
  }

  if (challenge) {
    return (
      <AuthFrame
        title={ACTIONS.verifyEmail}
        description={`If ${maskEmail(challenge.email)} has an account, we sent it a code.`}
      >
        <CodeStep
          challenge={challenge}
          resendPath="/auth/password-reset/resend"
          verifyPath="/auth/password-reset/verify"
          onChallenge={setChallenge}
          onVerified={() => setDone(true)}
        />
      </AuthFrame>
    );
  }

  return (
    <AuthFrame
      title={ACTIONS.forgotPassword.replace('?', '')}
      description="Enter the email address you registered with."
    >
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4" noValidate>
        <Field label="Email address" error={fieldError}>
          {(control) => (
            <Input
              {...control}
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
        </Field>
        <FormError error={error} />
        <Button type="submit" variant="primary" size="lg" loading={busy} className="w-full">
          Send Code
        </Button>
        <Link href="/login" className="text-center text-[13px] font-medium text-muted hover:text-text">
          Back to {ACTIONS.logIn}
        </Link>
      </form>
    </AuthFrame>
  );
}

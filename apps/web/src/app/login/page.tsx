'use client';

import { ACTIONS, loginSchema, type MeResponse } from '@signaldesk/domain';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, Suspense, useState } from 'react';
import { PasswordInput } from '@/components/auth/parts';
import { AuthFrame, usePublicInfo } from '@/components/shell/auth-frame';
import { buttonClass } from '@/components/styles';
import { Button, Field, FormError, Input } from '@/components/ui';
import { api } from '@/lib/api';
import { nextStepPath } from '@/lib/session';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [missing, setMissing] = useState<{ identifier?: string; password?: string }>({});
  const [busy, setBusy] = useState(false);
  const info = usePublicInfo();
  // One way to create an account: this button. Hidden only while the Super Admin has paused sign-up.
  const canSignUp = info.data?.signupOpen ?? true;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = loginSchema.safeParse({ identifier, password });
    if (!parsed.success) {
      setMissing({
        identifier: identifier.trim() ? undefined : 'Enter your email or username',
        password: password ? undefined : 'Enter your password',
      });
      return;
    }
    setMissing({});
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/login', parsed.data);
      const me = await api.get<MeResponse>('/auth/me');
      router.replace(nextStepPath(me, params.get('next')));
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };

  return (
    <AuthFrame
      title="Welcome back"
      description={params.get('expired') ? 'Your session ended. Log in again.' : 'Log in to your account.'}
    >
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4" noValidate>
        <Field label="Email or username" error={missing.identifier}>
          {(control) => (
            <Input
              {...control}
              name="username"
              type="email"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
            />
          )}
        </Field>
        <Field label="Password" error={missing.password}>
          {(control) => (
            <PasswordInput
              {...control}
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>
        <div className="-mt-1 flex justify-end">
          <Link href="/forgot-password" className="rounded text-[13px] font-medium text-muted hover:text-text">
            {ACTIONS.forgotPassword}
          </Link>
        </div>
        <FormError error={error} />
        <Button type="submit" variant="primary" size="lg" loading={busy} className="w-full">
          {ACTIONS.logIn}
        </Button>
      </form>
      {canSignUp && (
        <div className="mt-6">
          <p className="flex items-center gap-3 text-[13px] text-subtle">
            <span className="h-px flex-1 bg-line" aria-hidden />
            New here?
            <span className="h-px flex-1 bg-line" aria-hidden />
          </p>
          <Link href="/signup" className={buttonClass('secondary', 'lg', 'mt-3 w-full')}>
            {ACTIONS.createAccount}
          </Link>
        </div>
      )}
    </AuthFrame>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

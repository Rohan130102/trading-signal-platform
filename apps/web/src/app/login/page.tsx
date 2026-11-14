'use client';

import { ACTIONS, loginSchema, type MeResponse } from '@signaldesk/domain';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, Suspense, useState } from 'react';
import { AuthTabs, PasswordInput } from '@/components/auth/parts';
import { AuthFrame } from '@/components/shell/auth-frame';
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
    <AuthFrame title="Welcome back" description={params.get('expired') ? 'Your session ended. Log in again.' : undefined}>
      <AuthTabs current="login" />
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
        <p className="text-center text-[13px] text-muted">
          New here?{' '}
          <Link href="/signup" className="rounded font-semibold text-text hover:underline">
            {ACTIONS.createAccount}
          </Link>
        </p>
      </form>
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

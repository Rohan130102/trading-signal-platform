'use client';

import { loginSchema, type MeResponse } from '@signaldesk/domain';
import { Eye, EyeOff } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, Suspense, useState } from 'react';
import { AuthFrame } from '@/components/shell/auth-frame';
import { Button, Field, FormError, Input } from '@/components/ui';
import { api } from '@/lib/api';
import { nextStepPath } from '@/lib/session';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = loginSchema.safeParse({ identifier, password });
    if (!parsed.success) {
      setError(new Error('Enter your login ID and password.'));
      return;
    }
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
      title="Sign in"
      description={
        params.get('expired')
          ? 'Your session ended. Please sign in again.'
          : 'Use the login ID and password you were given.'
      }
    >
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4" noValidate>
        <Field label="Login ID">
          {(control) => (
            <Input
              {...control}
              name="username"
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
        <Field label="Password">
          {(control) => (
            <div className="relative">
              <Input
                {...control}
                name="password"
                className="pr-12"
                type={show ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShow(!show)}
                aria-label={show ? 'Hide password' : 'Show password'}
                aria-pressed={show}
                className="absolute right-0 top-0 grid h-full w-11 place-items-center text-muted hover:text-text"
              >
                {show ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
              </button>
            </div>
          )}
        </Field>
        <FormError error={error} />
        <Button type="submit" variant="primary" size="lg" loading={busy} className="w-full">
          Sign in
        </Button>
        <p className="text-[13px] text-muted">
          Forgot your password? Contact support and they will send you a new temporary one.
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

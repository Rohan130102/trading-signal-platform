'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { useFocusOnLoad } from '@/components/auth/parts';
import { AuthFrame } from '@/components/shell/auth-frame';
import { Button, Field, FormError, Input } from '@/components/ui';
import { api } from '@/lib/api';
import { nextStepPath, useMe } from '@/lib/session';

export default function SetPasswordPage() {
  const router = useRouter();
  const client = useQueryClient();
  const me = useMe();
  const [current, setCurrent] = useState('');
  const firstField = useFocusOnLoad<HTMLInputElement>();
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (me.isError) router.replace('/login');
    else if (me.data && me.data.next !== 'CHANGE_PASSWORD') router.replace(nextStepPath(me.data));
  }, [me.data, me.isError, router]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (next.length < 10) return setError(new Error('Use at least 10 characters.'));
    if (next !== confirm) return setError(new Error('The two new passwords do not match.'));
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/change-password', { currentPassword: current, newPassword: next });
      await client.invalidateQueries({ queryKey: ['me'] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame
      focused
      title="Choose your password"
      description="The password you were given is temporary. Choose one only you know."
    >
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4" noValidate>
        <Field label="Temporary password">
          {(c) => (
            <Input
              {...c}
              type="password"
              autoComplete="current-password"
              ref={firstField}
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          )}
        </Field>
        <Field
          label="New password"
          hint="At least 10 characters. A short sentence is easy to remember and hard to guess."
        >
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
        <Field label="New password again">
          {(c) => (
            <Input
              {...c}
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          )}
        </Field>
        <FormError error={error} />
        <Button type="submit" variant="primary" size="lg" loading={busy} className="w-full">
          Save password
        </Button>
      </form>
    </AuthFrame>
  );
}

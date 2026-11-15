'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { useFocusOnLoad } from '@/components/auth/parts';
import { AuthFrame } from '@/components/shell/auth-frame';
import { Button, Field, FormError, Input } from '@/components/ui';
import { api } from '@/lib/api';
import { nextStepPath, signOut, useMe } from '@/lib/session';

export default function VerifyPage() {
  const router = useRouter();
  const client = useQueryClient();
  const me = useMe();
  const [code, setCode] = useState('');
  const firstField = useFocusOnLoad<HTMLInputElement>();
  const verify = useMutation({
    mutationFn: () => api.post('/auth/mfa/verify', { code }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['me'] }),
  });

  useEffect(() => {
    if (me.isError) router.replace('/login');
    else if (me.data && me.data.next !== 'MFA_VERIFY') router.replace(nextStepPath(me.data));
  }, [me.data, me.isError, router]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    verify.mutate();
  };

  return (
    <AuthFrame
      focused
      title="Enter your code"
      description="Open your authenticator app and type the six digits it shows."
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Code" hint="Lost your phone? Enter one of your recovery codes here instead.">
          {(c) => (
            <Input
              {...c}
              className="num tracking-wider"
              autoComplete="one-time-code"
              ref={firstField}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          )}
        </Field>
        <FormError error={verify.error} />
        <Button
          type="submit"
          variant="primary"
          size="lg"
          loading={verify.isPending}
          disabled={code.trim().length < 6}
          className="w-full"
        >
          Continue
        </Button>
        <Button variant="ghost" onClick={() => void signOut()}>
          Use a different account
        </Button>
      </form>
    </AuthFrame>
  );
}

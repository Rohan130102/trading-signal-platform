'use client';

import { ACTIONS, type ChallengeResponse } from '@signaldesk/domain';
import { type FormEvent, useState } from 'react';
import { CodeInput, ResendButton } from '@/components/auth/parts';
import { Button, Field, FormError } from '@/components/ui';
import { api } from '@/lib/api';

/** Shared by sign-up and recovery: the code, a resend with its wait, and server errors as they are. */
export function CodeStep({
  challenge,
  resendPath,
  verifyPath,
  onVerified,
  onChallenge,
}: {
  challenge: ChallengeResponse;
  resendPath: string;
  verifyPath: string;
  onVerified: (result: unknown) => void;
  onChallenge: (challenge: ChallengeResponse) => void;
}) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (code.length !== 6) {
      setError(new Error('Enter the 6-digit code.'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onVerified(await api.post(verifyPath, { challengeId: challenge.challengeId, code }));
    } catch (e) {
      setError(e);
      setCode('');
      setBusy(false);
    }
  };
  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4" noValidate>
      <Field label="Verification code">
        {(control) => <CodeInput {...control} autoFocus value={code} onChange={(e) => setCode(e.target.value)} />}
      </Field>
      <FormError error={error} />
      <Button type="submit" variant="primary" size="lg" loading={busy} className="w-full">
        {ACTIONS.verifyEmail}
      </Button>
      <div className="flex items-center justify-between text-[13px] text-muted">
        <span>The code expires in 5 minutes.</span>
        <ResendButton
          availableAt={challenge.resendAvailableAt}
          onResend={async () => {
            setError(null);
            try {
              onChallenge(await api.post<ChallengeResponse>(resendPath, { challengeId: challenge.challengeId }));
            } catch (e) {
              setError(e);
            }
          }}
        />
      </div>
    </form>
  );
}


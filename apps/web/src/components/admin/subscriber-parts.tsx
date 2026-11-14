'use client';

import type { SubscriberRow } from '@signaldesk/domain';
import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button } from '@/components/ui';

export type { SubscriberRow };

export function AccessBadge({ row }: { row: Pick<SubscriberRow, 'status' | 'subscription'> }) {
  if (row.status !== 'ACTIVE')
    return <Badge tone="stop">{row.status === 'SUSPENDED' ? 'Suspended' : 'Disabled'}</Badge>;
  const { state, daysRemaining, kind } = row.subscription;
  if (state === 'ACTIVE' && kind === 'TRIAL') return <Badge tone="buy">Trial · {daysRemaining}d left</Badge>;
  if (state === 'ACTIVE')
    return (
      <Badge tone={daysRemaining <= 7 ? 'update' : 'success'}>
        {daysRemaining <= 7 ? `${daysRemaining}d left` : 'Active'}
      </Badge>
    );
  if (state === 'SCHEDULED') return <Badge tone="buy">Scheduled</Badge>;
  if (state === 'EXPIRED') return <Badge tone="stop">Expired</Badge>;
  return <Badge>None</Badge>;
}

export function CredentialsCard({
  loginId,
  password,
  validFor = '3 days',
}: {
  loginId: string;
  password: string;
  validFor?: string;
}) {
  const [copied, setCopied] = useState(false);
  const message = `Your login ID: ${loginId}\nYour temporary password: ${password}\nIt works for ${validFor} and you will be asked to change it when you first sign in.`;
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-update/40 bg-update-soft p-3 text-sm text-update" role="status">
        Shown only this once. It is not stored in readable form, so copy it now.
      </div>
      <dl className="rounded-lg bg-bg p-3 text-sm">
        <dt className="text-xs text-muted">Login ID</dt>
        <dd className="num select-all font-semibold">{loginId}</dd>
        <dt className="mt-2 text-xs text-muted">Temporary password</dt>
        <dd className="num select-all text-lg font-semibold" data-testid="temp-password">
          {password}
        </dd>
      </dl>
      <Button
        onClick={() =>
          void navigator.clipboard?.writeText(message).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          })
        }
      >
        {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
        {copied ? 'Copied' : 'Copy a message to send them'}
      </Button>
    </div>
  );
}

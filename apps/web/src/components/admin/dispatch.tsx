'use client';

import type { DispatchSummary } from '@signaldesk/domain';
import { CheckCircle2, CircleDashed, Radio, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui';

const STAGES = {
  PENDING: { label: 'Push queued', tone: 'neutral', icon: CircleDashed },
  IN_PROGRESS: { label: 'Sending push', tone: 'update', icon: CircleDashed },
  COMPLETED: { label: 'Handed to push services', tone: 'success', icon: CheckCircle2 },
  FAILED: { label: 'Push failures', tone: 'stop', icon: TriangleAlert },
} as const;

/** Always worded as what the transport did. Nothing here claims a person received anything. */
export function DispatchStatus({ dispatch, detailed }: { dispatch: DispatchSummary | null; detailed?: boolean }) {
  if (!dispatch) return null;
  const stage = STAGES[dispatch.stage];
  const Icon = stage.icon;
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted">
      <Badge tone={stage.tone}>
        <Icon className="size-3" aria-hidden /> {stage.label}
      </Badge>
      <span className="inline-flex items-center gap-1">
        <Radio className="size-3" aria-hidden /> Live to {dispatch.liveSends} connected
      </span>
      {detailed !== false && dispatch.devices > 0 && (
        <span>
          {dispatch.accepted}/{dispatch.devices} devices accepted
          {dispatch.failed > 0 && `, ${dispatch.failed} failed`}
          {dispatch.invalidated > 0 && `, ${dispatch.invalidated} gone`}
          {dispatch.skipped > 0 && `, ${dispatch.skipped} skipped`}
        </span>
      )}
      {dispatch.devices === 0 && dispatch.stage === 'COMPLETED' && <span>No devices have notifications on</span>}
    </div>
  );
}

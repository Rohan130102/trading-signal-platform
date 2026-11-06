'use client';

import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { ScrollText, ShieldCheck, ShieldX } from 'lucide-react';
import { useState } from 'react';
import { Button, Card, EmptyState, ErrorState, Field, Input, Loading, PageHeader, Pagination } from '@/components/ui';
import { api, queryString } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

interface Result {
  entries: {
    id: number;
    action: string;
    actorName: string;
    targetType: string | null;
    targetId: string | null;
    metadata: unknown;
    createdAt: string;
  }[];
  total: number;
  page: number;
  pageSize: number;
}

export default function AuditPage() {
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const log = useQuery({
    queryKey: ['admin', 'audit', action, page],
    queryFn: () => api.get<Result>(`/admin/audit${queryString({ action, page })}`),
    placeholderData: keepPreviousData,
  });
  const verify = useMutation({
    mutationFn: () => api.get<{ checked: number; intact: boolean; firstBadSeq: number | null }>('/admin/integrity'),
  });
  return (
    <>
      <PageHeader
        title="Audit log"
        description="Append-only. Not even the application can change an entry."
        action={
          <Button loading={verify.isPending} onClick={() => verify.mutate()}>
            <ShieldCheck className="size-4" aria-hidden /> Verify signal history
          </Button>
        }
      />
      {verify.data && (
        <div
          role="status"
          className={`mb-4 flex items-start gap-2.5 rounded-xl px-4 py-3 text-sm font-medium ${verify.data.intact ? 'bg-success-soft text-success' : 'bg-stop-soft text-stop'}`}
        >
          {verify.data.intact ? (
            <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
          ) : (
            <ShieldX className="mt-0.5 size-4 shrink-0" aria-hidden />
          )}
          {verify.data.intact
            ? `The hash chain over ${verify.data.checked} events is intact.`
            : `Tampering detected at event ${verify.data.firstBadSeq}. Investigate before relying on this history.`}
        </div>
      )}
      <div className="mb-4 max-w-sm">
        <Field label="Filter by action">
          {(c) => (
            <Input
              {...c}
              type="search"
              placeholder="SIGNAL, LOGIN, SUBSCRIBER…"
              value={action}
              onChange={(e) => {
                setAction(e.target.value);
                setPage(1);
              }}
            />
          )}
        </Field>
      </div>
      {log.isPending && <Loading rows={5} label="Loading the audit log" />}
      {log.isError && <ErrorState error={log.error} onRetry={() => void log.refetch()} />}
      {log.isSuccess && log.data.entries.length === 0 && (
        <EmptyState icon={<ScrollText className="size-5" aria-hidden />} title="No entries match" />
      )}
      {log.isSuccess && log.data.entries.length > 0 && (
        <>
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-[13px]">
              <caption className="sr-only">Audit entries</caption>
              <thead className="text-xs text-muted">
                <tr>
                  {['When', 'Who', 'Action', 'Details'].map((h) => (
                    <th key={h} scope="col" className="px-4 py-2.5 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {log.data.entries.map((e) => (
                  <tr key={e.id} className="border-t border-line align-top">
                    <td className="whitespace-nowrap px-4 py-2 text-muted">{formatDateTime(e.createdAt)}</td>
                    <td className="whitespace-nowrap px-4 py-2">{e.actorName}</td>
                    <td className="num whitespace-nowrap px-4 py-2 font-medium">{e.action}</td>
                    <td className="px-4 py-2">
                      <details>
                        <summary className="cursor-pointer text-muted">
                          {e.targetType ? `${e.targetType} ${e.targetId?.slice(0, 8) ?? ''}` : 'Details'}
                        </summary>
                        <pre className="num mt-1 max-w-md overflow-x-auto whitespace-pre-wrap break-all text-xs text-muted">
                          {JSON.stringify(e.metadata, null, 2)}
                        </pre>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Pagination page={log.data.page} pageSize={log.data.pageSize} total={log.data.total} onChange={setPage} />
        </>
      )}
    </>
  );
}

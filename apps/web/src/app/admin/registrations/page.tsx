'use client';

import { ENQUIRY_STATUS_LABELS, ENQUIRY_STATUSES, type RegistrationsPage, TITLES } from '@signaldesk/domain';
import { useQuery } from '@tanstack/react-query';
import { BadgeCheck, Search, UserPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AccessBadge } from '@/components/admin/subscriber-parts';
import { Badge, Card, EmptyState, ErrorState, Input, Loading, PageHeader, Pagination, Select } from '@/components/ui';
import { api, queryString } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

/** People who signed themselves up. New ones are marked until an administrator opens them. */
export default function RegistrationsPage() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [enquiry, setEnquiry] = useState('');
  const [access, setAccess] = useState('');
  const [unseen, setUnseen] = useState(false);
  const [page, setPage] = useState(1);
  const list = useQuery({
    queryKey: ['admin', 'registrations', q, enquiry, access, unseen, page],
    queryFn: () =>
      api.get<RegistrationsPage>(
        `/admin/registrations${queryString({ q: q.trim(), enquiry, access, unseen: unseen ? 'true' : undefined, page })}`,
      ),
    refetchInterval: 30_000,
  });
  const reset = (fn: () => void) => {
    fn();
    setPage(1);
  };
  return (
    <>
      <PageHeader
        title={TITLES.newRegistrations}
        description={list.data ? `${list.data.unseen} new · ${list.data.total} shown` : undefined}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
          <Input
            aria-label="Search by name, email or mobile"
            placeholder="Name, email or mobile"
            className="pl-9"
            value={q}
            onChange={(e) => reset(() => setQ(e.target.value))}
          />
        </div>
        <div className="w-full sm:w-44">
        <Select aria-label="Enquiry" value={enquiry} onChange={(e) => reset(() => setEnquiry(e.target.value))}>
          <option value="">Any enquiry</option>
          {ENQUIRY_STATUSES.map((s) => (
            <option key={s} value={s}>
              {ENQUIRY_STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
        </div>
        <div className="w-full sm:w-40">
        <Select aria-label="Access" value={access} onChange={(e) => reset(() => setAccess(e.target.value))}>
          <option value="">Any access</option>
          <option value="NONE">No subscription</option>
          <option value="TRIAL">Free trial</option>
          <option value="ACTIVE">Subscribed</option>
          <option value="EXPIRED">Expired</option>
        </Select>
        </div>
        <label className="flex h-10 items-center gap-2 rounded-lg border border-line px-3 text-sm">
          <input type="checkbox" checked={unseen} onChange={(e) => reset(() => setUnseen(e.target.checked))} />
          New only
        </label>
      </div>
      {list.isPending ? (
        <Loading rows={4} label="Loading registrations" />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data.registrations.length === 0 ? (
        <Card>
          <EmptyState icon={<UserPlus className="size-5" aria-hidden />} title="No registrations match" />
        </Card>
      ) : (
        <>
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="text-xs text-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Name</th>
                  <th className="px-4 py-2.5 font-medium">Email</th>
                  <th className="px-4 py-2.5 font-medium">Mobile</th>
                  <th className="px-4 py-2.5 font-medium">Age</th>
                  <th className="px-4 py-2.5 font-medium">Registered</th>
                  <th className="px-4 py-2.5 font-medium">Enquiry</th>
                  <th className="px-4 py-2.5 font-medium">Access</th>
                </tr>
              </thead>
              <tbody>
                {list.data.registrations.map((r) => (
                  <tr
                    key={r.id}
                    className="cursor-pointer border-t border-line hover:bg-raised"
                    onClick={() => router.push(`/admin/subscribers/${r.id}`)}
                  >
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <a href={`/admin/subscribers/${r.id}`} className="font-medium" onClick={(e) => e.stopPropagation()}>
                        {r.name}
                      </a>
                      {r.isNew && (
                        <Badge tone="buy" className="ml-2">
                          New
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="flex items-center gap-1">
                        {r.email}
                        {r.emailVerified && <BadgeCheck className="size-3.5 text-success" aria-label="Email verified" />}
                      </span>
                    </td>
                    <td className="num px-4 py-2.5">{r.mobile}</td>
                    <td className="num px-4 py-2.5">{r.age}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-muted">{formatDateTime(r.registeredAt)}</td>
                    <td className="whitespace-nowrap px-4 py-2.5">{ENQUIRY_STATUS_LABELS[r.enquiryStatus]}</td>
                    <td className="px-4 py-2.5">
                      <AccessBadge row={{ status: 'ACTIVE', subscription: r.subscription }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onChange={setPage} />
        </>
      )}
    </>
  );
}

'use client';

import { ANNOUNCEMENT_CATEGORY_LABELS, type AnnouncementsPage, type AnnouncementView } from '@signaldesk/domain';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { ExternalLink, EyeOff, Megaphone, Pin } from 'lucide-react';
import { useMemo } from 'react';
import { toast } from 'sonner';
import { Badge, Button, Card, EmptyState, ErrorState, Loading, PageHeader } from '@/components/ui';
import { api, queryString } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

function AnnouncementCard({ item, onHide }: { item: AnnouncementView; onHide: (item: AnnouncementView) => void }) {
  const urgent = item.category === 'URGENT' || item.priority === 'PRIORITY';
  return (
    <Card className={clsx('p-4 sm:p-5', urgent && 'border-update/40')}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {item.pinned && (
            <Badge>
              <Pin className="size-3" aria-hidden /> Pinned
            </Badge>
          )}
          <Badge tone={urgent ? 'update' : 'neutral'}>{ANNOUNCEMENT_CATEGORY_LABELS[item.category]}</Badge>
        </div>
        <Button variant="ghost" size="sm" onClick={() => onHide(item)} aria-label={`Hide “${item.title}”`}>
          <EyeOff className="size-4" aria-hidden />
          Hide
        </Button>
      </div>
      <h2 className="mt-3 font-semibold">{item.title}</h2>
      <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-muted">{item.body}</p>
      {item.linkUrl && (
        <a
          href={item.linkUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold hover:underline"
        >
          {item.linkLabel || 'Open link'} <ExternalLink className="size-3.5" aria-hidden />
        </a>
      )}
      <p className="mt-3 text-xs text-subtle">
        {formatDateTime(item.publishedAt)}
        {item.editedAt && ' · edited'}
      </p>
    </Card>
  );
}

/** Announcements from the desk, as on the phone's News tab. Pinned ones stay on top. */
export default function NewsPage() {
  const client = useQueryClient();
  const board = useInfiniteQuery({
    queryKey: ['announcements'],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      api.get<AnnouncementsPage>(`/announcements${queryString({ page: pageParam, pageSize: 20 })}`),
    getNextPageParam: (last) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
    staleTime: 30_000,
  });
  const items = useMemo(() => board.data?.pages.flatMap((p) => p.announcements) ?? [], [board.data]);

  const hide = async (item: AnnouncementView) => {
    try {
      await api.post('/me/hidden', { type: 'ANNOUNCEMENT', id: item.id });
      await client.invalidateQueries({ queryKey: ['announcements'] });
      toast('Announcement hidden', {
        action: {
          label: 'Undo',
          onClick: () =>
            void api
              .delete(`/me/hidden/ANNOUNCEMENT/${item.id}`)
              .then(() => client.invalidateQueries({ queryKey: ['announcements'] })),
        },
      });
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  return (
    <>
      <PageHeader title="News" description="Announcements from the desk. Pinned ones stay on top." />
      {board.isPending && <Loading rows={2} label="Loading announcements" />}
      {board.isError && <ErrorState error={board.error} onRetry={() => void board.refetch()} />}
      {board.isSuccess && items.length === 0 && (
        <EmptyState icon={<Megaphone className="size-5" aria-hidden />} title="No announcements">
          Market notes, schedule changes and other news from the desk appear here.
        </EmptyState>
      )}
      <div className="flex flex-col gap-3">
        {items.map((item) => (
          <AnnouncementCard key={item.id} item={item} onHide={(i) => void hide(i)} />
        ))}
      </div>
      {board.hasNextPage && (
        <div className="mt-4 text-center">
          <Button onClick={() => void board.fetchNextPage()} loading={board.isFetchingNextPage}>
            Show older
          </Button>
        </div>
      )}
    </>
  );
}

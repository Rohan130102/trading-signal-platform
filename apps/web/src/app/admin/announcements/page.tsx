'use client';

import {
  type AdminAnnouncement,
  type AdminAnnouncementsPage,
  type AdminAnnouncementView,
  ANNOUNCEMENT_CATEGORIES,
  ANNOUNCEMENT_CATEGORY_LABELS,
  type AnnouncementCategory,
  announcementCreateSchema,
  type AnnouncementTemplate,
  announcementUpdateSchema,
  unfilledPlaceholders,
} from '@signaldesk/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Pin, Plus } from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  FormError,
  Input,
  Loading,
  PageHeader,
  Select,
  Switch,
  Textarea,
} from '@/components/ui';
import { api } from '@/lib/api';
import { formatDateTime, newKey } from '@/lib/format';

const VIEWS: { value: AdminAnnouncementView; label: string; count: keyof AdminAnnouncementsPage['counts'] }[] = [
  { value: 'LIVE', label: 'Live', count: 'LIVE' },
  { value: 'SCHEDULED', label: 'Scheduled', count: 'SCHEDULED' },
  { value: 'DRAFT', label: 'Drafts', count: 'DRAFT' },
  { value: 'ARCHIVED', label: 'Archived', count: 'ARCHIVED' },
  { value: 'BIN', label: 'Bin', count: 'BIN' },
];

const TONE: Record<AnnouncementCategory, 'neutral' | 'update' | 'stop'> = {
  GENERAL: 'neutral',
  IMPORTANT: 'update',
  MARKET_UPDATE: 'update',
  MAINTENANCE: 'neutral',
  EDUCATIONAL: 'neutral',
  URGENT: 'stop',
};

function statusLine(a: AdminAnnouncement): string {
  if (a.deleted) return `In the bin since ${formatDateTime(a.deletedAt as string)}`;
  if (a.status === 'SCHEDULED') return `Goes out ${formatDateTime(a.publishAt as string)}`;
  if (a.status === 'DRAFT') return `Draft, edited ${formatDateTime(a.updatedAt)}`;
  if (a.status === 'ARCHIVED') return `Archived ${formatDateTime(a.archivedAt as string)}`;
  return `Sent ${formatDateTime(a.publishedAt as string)}${a.editedAt ? ', edited since' : ''}`;
}

/** `datetime-local` values are in the browser's time zone; the API takes an instant. */
const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function Composer({ editing, onClose }: { editing: AdminAnnouncement | null; onClose: () => void }) {
  const client = useQueryClient();
  const [key] = useState(newKey);
  const [title, setTitle] = useState(editing?.title ?? '');
  const [body, setBody] = useState(editing?.body ?? '');
  const [category, setCategory] = useState<AnnouncementCategory>(editing?.category ?? 'GENERAL');
  const [priority, setPriority] = useState(editing?.priority === 'PRIORITY');
  const [pinned, setPinned] = useState(editing?.pinned ?? false);
  const [linkUrl, setLinkUrl] = useState(editing?.linkUrl ?? '');
  const [linkLabel, setLinkLabel] = useState(editing?.linkLabel ?? '');
  const [mode, setMode] = useState<'PUBLISH' | 'SCHEDULE' | 'DRAFT'>('PUBLISH');
  const [publishAt, setPublishAt] = useState(
    editing?.publishAt ? toLocalInput(editing.publishAt) : toLocalInput(new Date(Date.now() + 3_600_000).toISOString()),
  );
  const [expiresAt, setExpiresAt] = useState(editing?.expiresAt ? toLocalInput(editing.expiresAt) : '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const templates = useQuery({
    queryKey: ['admin', 'announcement-templates'],
    queryFn: () => api.get<{ templates: AnnouncementTemplate[] }>('/admin/announcement-templates'),
    enabled: !editing,
  });
  const urgent = category === 'URGENT';
  const placeholders = unfilledPlaceholders(`${title}\n${body}`);

  const save = useMutation({
    mutationFn: (payload: unknown) =>
      editing
        ? api.put(`/admin/announcements/${editing.id}`, payload)
        : api.post<AdminAnnouncement>('/admin/announcements', payload),
    onSuccess: (result) => {
      void client.invalidateQueries({ queryKey: ['admin', 'announcements'] });
      const status = (result as AdminAnnouncement | undefined)?.status;
      toast.success(
        editing
          ? 'Changes saved'
          : status === 'PUBLISHED'
            ? 'Sent to subscribers'
            : status === 'SCHEDULED'
              ? 'Scheduled'
              : 'Draft saved',
      );
      onClose();
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const content = {
      title,
      body,
      category,
      priority: priority || urgent ? 'PRIORITY' : 'NORMAL',
      pinned,
      linkUrl: linkUrl.trim() || null,
      linkLabel: linkUrl.trim() && linkLabel.trim() ? linkLabel.trim() : null,
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
    };
    const parsed = editing
      ? announcementUpdateSchema.safeParse({
          ...content,
          publishAt: editing.status === 'SCHEDULED' ? new Date(publishAt).toISOString() : null,
          expectedVersion: editing.version,
        })
      : announcementCreateSchema.safeParse({
          ...content,
          mode,
          publishAt: mode === 'SCHEDULE' ? new Date(publishAt).toISOString() : null,
          idempotencyKey: key,
        });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0])] ??= issue.message;
      setErrors(next);
      return;
    }
    setErrors({});
    if (!editing && mode !== 'DRAFT') {
      const warning = [
        placeholders.length ? `It still contains ${placeholders.join(', ')}.` : null,
        mode === 'PUBLISH' ? 'It goes to every subscriber with access, as an alert and on the News tab.' : null,
      ]
        .filter(Boolean)
        .join('\n\n');
      if (warning && !window.confirm(`${mode === 'PUBLISH' ? 'Send now?' : 'Schedule?'}\n\n${warning}`)) return;
    }
    save.mutate(parsed.data);
  };

  return (
    <Dialog
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={editing ? 'Edit announcement' : 'New announcement'}
      description={
        editing?.everPublished
          ? 'Already sent. Edits change what the News tab shows; the alert that went out stays as it was.'
          : 'Plain text. Goes to every subscriber with access.'
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {!editing && (templates.data?.templates.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-2" aria-label="Templates">
            {templates.data?.templates
              .filter((t) => t.active)
              .map((t) => (
                <Button
                  key={t.id}
                  size="sm"
                  onClick={() => {
                    setTitle(t.title);
                    setBody(t.body);
                    setCategory(t.category);
                  }}
                >
                  {t.name}
                </Button>
              ))}
          </div>
        )}
        <Field label="Title" required error={errors.title}>
          {(c) => <Input {...c} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />}
        </Field>
        <Field label="Message" required error={errors.body}>
          {(c) => <Textarea {...c} rows={5} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} />}
        </Field>
        {placeholders.length > 0 && (
          <p className="rounded-lg bg-update-soft px-3 py-2 text-sm text-update" role="alert">
            Replace {placeholders.join(', ')} before sending.
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Category">
            {(c) => (
              <Select {...c} value={category} onChange={(e) => setCategory(e.target.value as AnnouncementCategory)}>
                {ANNOUNCEMENT_CATEGORIES.map((v) => (
                  <option key={v} value={v}>
                    {ANNOUNCEMENT_CATEGORY_LABELS[v]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Remove from the News tab after" hint="Optional.">
            {(c) => (
              <Input {...c} type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
            )}
          </Field>
        </div>
        <div className="rounded-lg border border-line px-3">
          <Switch
            label="Priority alert"
            description={
              urgent ? 'Urgent announcements are always priority alerts.' : 'Louder alert, highlighted on the News tab.'
            }
            checked={priority || urgent}
            onChange={setPriority}
          />
          <Switch label="Pin to the top" checked={pinned} onChange={setPinned} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Link" hint="Optional. Must start with https://" error={errors.linkUrl}>
            {(c) => <Input {...c} inputMode="url" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} />}
          </Field>
          <Field label="Button text" hint="Optional, such as Read more.">
            {(c) => <Input {...c} maxLength={40} value={linkLabel} onChange={(e) => setLinkLabel(e.target.value)} />}
          </Field>
        </div>
        {!editing && (
          <Field label="When">
            {(c) => (
              <Select {...c} value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
                <option value="PUBLISH">Send now</option>
                <option value="SCHEDULE">Schedule</option>
                <option value="DRAFT">Save as a draft</option>
              </Select>
            )}
          </Field>
        )}
        {(mode === 'SCHEDULE' || editing?.status === 'SCHEDULED') && (
          <Field label="Publish at (your local time)" error={errors.publishAt}>
            {(c) => (
              <Input {...c} type="datetime-local" value={publishAt} onChange={(e) => setPublishAt(e.target.value)} />
            )}
          </Field>
        )}
        <section aria-label="Preview" className="rounded-xl border border-line bg-bg p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-subtle">Preview</p>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={TONE[category]}>{ANNOUNCEMENT_CATEGORY_LABELS[category]}</Badge>
            {pinned && <Pin className="size-3.5 text-muted" aria-label="Pinned" />}
            {(priority || urgent) && category !== 'URGENT' && <Badge tone="update">Priority</Badge>}
          </div>
          <p className="mt-2 font-semibold">{title || 'Title'}</p>
          <p className="mt-1 whitespace-pre-wrap text-sm">{body || 'Your message appears here.'}</p>
          {linkUrl && (
            <span className="mt-2 inline-flex items-center gap-1 rounded-lg border border-line-strong px-3 py-1.5 text-sm font-semibold">
              {linkLabel || 'Open link'} <ExternalLink className="size-3.5" aria-hidden />
            </span>
          )}
        </section>
        <FormError error={save.error} />
        <Button type="submit" variant="primary" size="lg" loading={save.isPending}>
          {editing
            ? 'Save changes'
            : mode === 'PUBLISH'
              ? 'Send to subscribers'
              : mode === 'SCHEDULE'
                ? 'Schedule'
                : 'Save draft'}
        </Button>
      </form>
    </Dialog>
  );
}

export default function AnnouncementsPage() {
  const client = useQueryClient();
  const [view, setView] = useState<AdminAnnouncementView>('LIVE');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [composing, setComposing] = useState<AdminAnnouncement | 'new' | null>(null);
  const list = useQuery({
    queryKey: ['admin', 'announcements', view, query.trim()],
    queryFn: () =>
      api.get<AdminAnnouncementsPage>(
        `/admin/announcements?view=${view}${query.trim() ? `&q=${encodeURIComponent(query.trim())}` : ''}`,
      ),
  });
  const rows = useMemo(() => list.data?.announcements ?? [], [list.data]);
  const chosen = rows.filter((r) => selected.has(r.id));
  const bulkOptions = (['ARCHIVE', 'RESTORE', 'DELETE'] as const).filter(
    (a) => chosen.length > 0 && chosen.every((r) => r.allowedActions.includes(a)),
  );
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['admin', 'announcements'] });
    setSelected(new Set());
  };
  const act = useMutation({
    mutationFn: ({ a, action }: { a: AdminAnnouncement; action: string }) => {
      const body = { expectedVersion: a.version };
      if (action === 'delete') return api.delete(`/admin/announcements/${a.id}`, body);
      if (action === 'purge')
        return api.post(`/admin/announcements/${a.id}/purge`, { ...body, confirm: 'PERMANENTLY_DELETE' });
      return api.post(`/admin/announcements/${a.id}/${action}`, body);
    },
    onSuccess: () => {
      toast.success('Done');
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const bulk = useMutation({
    mutationFn: (action: 'ARCHIVE' | 'RESTORE' | 'DELETE') =>
      api.post<{ changed: number }>('/admin/announcements/bulk', {
        ids: chosen.map((r) => r.id),
        action,
        expectedCount: chosen.length,
      }),
    onSuccess: (r) => {
      toast.success(`${r.changed} updated`);
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const purge = (a: AdminAnnouncement) => {
    const typed = window.prompt(
      `This announcement was never sent, so it can be removed completely. Type DELETE to confirm.`,
    );
    if (typed?.trim().toUpperCase() === 'DELETE') act.mutate({ a, action: 'purge' });
  };

  return (
    <>
      <PageHeader
        title="Announcements"
        description="Drafts, schedules and everything sent. Sent announcements stay in the record even after they are archived."
        action={
          <Button variant="primary" onClick={() => setComposing('new')}>
            <Plus className="size-4" aria-hidden /> New announcement
          </Button>
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-2" role="tablist" aria-label="Show">
        {VIEWS.map((v) => (
          <Button
            key={v.value}
            size="sm"
            role="tab"
            aria-selected={view === v.value}
            variant={view === v.value ? 'primary' : 'secondary'}
            onClick={() => {
              setView(v.value);
              setSelected(new Set());
            }}
          >
            {v.label} <span className="num opacity-70">{list.data?.counts[v.count] ?? ''}</span>
          </Button>
        ))}
        <Input
          aria-label="Search announcements"
          placeholder="Search"
          className="ml-auto max-w-xs"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {chosen.length > 0 && (
        <div
          className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2"
          role="region"
          aria-label="Bulk actions"
        >
          <span className="text-sm font-semibold">{chosen.length} selected</span>
          {bulkOptions.length === 0 && <span className="text-sm text-muted">No action applies to all of them.</span>}
          {bulkOptions.map((a) => (
            <Button
              key={a}
              size="sm"
              variant={a === 'DELETE' ? 'danger' : 'secondary'}
              loading={bulk.isPending}
              onClick={() => {
                const words = { ARCHIVE: 'Archive', RESTORE: 'Restore', DELETE: 'Move to the bin' }[a];
                if (window.confirm(`${words}: ${chosen.length} announcement${chosen.length === 1 ? '' : 's'}?`))
                  bulk.mutate(a);
              }}
            >
              {{ ARCHIVE: 'Archive', RESTORE: 'Restore', DELETE: 'Move to bin' }[a]}
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      )}
      {list.isPending && <Loading rows={3} label="Loading announcements" />}
      {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
      {list.data && rows.length === 0 && (
        <EmptyState title="Nothing here">Create one with New announcement.</EmptyState>
      )}
      {rows.length > 0 && (
        <Card className="divide-y divide-line">
          {rows.map((a) => (
            <div key={a.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
              <input
                type="checkbox"
                className="mt-1 size-5"
                aria-label={`Select ${a.title}`}
                checked={selected.has(a.id)}
                onChange={(e) =>
                  setSelected((s) => {
                    const next = new Set(s);
                    if (e.target.checked) next.add(a.id);
                    else next.delete(a.id);
                    return next;
                  })
                }
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={TONE[a.category]}>{ANNOUNCEMENT_CATEGORY_LABELS[a.category]}</Badge>
                  {a.pinned && <Pin className="size-3.5 text-muted" aria-label="Pinned" />}
                  {a.priority === 'PRIORITY' && <Badge tone="update">Priority</Badge>}
                </div>
                <p className="mt-1 font-semibold">{a.title}</p>
                <p className="text-xs text-subtle">
                  {statusLine(a)}
                  {a.createdByName ? ` · ${a.createdByName}` : ''}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {a.allowedActions.includes('EDIT') && (
                  <Button size="sm" onClick={() => setComposing(a)}>
                    Edit
                  </Button>
                )}
                {a.allowedActions.includes('PUBLISH') && (
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() =>
                      window.confirm('Send now to every subscriber with access?') &&
                      act.mutate({ a, action: 'publish' })
                    }
                  >
                    Send now
                  </Button>
                )}
                {a.allowedActions.includes('UNSCHEDULE') && (
                  <Button size="sm" onClick={() => act.mutate({ a, action: 'unschedule' })}>
                    Cancel schedule
                  </Button>
                )}
                {a.allowedActions.includes('ARCHIVE') && (
                  <Button size="sm" onClick={() => act.mutate({ a, action: 'archive' })}>
                    Archive
                  </Button>
                )}
                {a.allowedActions.includes('RESTORE') && (
                  <Button size="sm" onClick={() => act.mutate({ a, action: 'restore' })}>
                    Restore
                  </Button>
                )}
                {a.allowedActions.includes('DELETE') && (
                  <Button size="sm" variant="ghost" onClick={() => act.mutate({ a, action: 'delete' })}>
                    Move to bin
                  </Button>
                )}
                {a.allowedActions.includes('PURGE') && (
                  <Button size="sm" variant="danger" onClick={() => purge(a)}>
                    Delete permanently
                  </Button>
                )}
              </div>
            </div>
          ))}
        </Card>
      )}
      {composing && <Composer editing={composing === 'new' ? null : composing} onClose={() => setComposing(null)} />}
    </>
  );
}

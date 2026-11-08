import {
  type AdminAnnouncement,
  ANNOUNCEMENT_CATEGORIES,
  ANNOUNCEMENT_CATEGORY_LABELS,
  type AnnouncementCategory,
  announcementCreateSchema,
  type AnnouncementTemplate,
  announcementUpdateSchema,
  formatDateTime,
  unfilledPlaceholders,
} from '@signaldesk/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, View } from 'react-native';
import { AnnouncementCard } from '@/announcements/AnnouncementCard';
import { api } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { newKey } from '@/lib/ids';
import { space } from '@/theme/tokens';
import {
  Badge,
  Button,
  Card,
  Chip,
  ChipRow,
  Field,
  FormError,
  Loading,
  ModalFrame,
  Notice,
  Screen,
  SectionTitle,
  Segmented,
  T,
  ToggleRow,
  useToast,
} from '@/ui';

type When = 'NOW' | 'SCHEDULE' | 'DRAFT';

const pad = (n: number) => String(n).padStart(2, '0');
const localLabel = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Reads "YYYY-MM-DD HH:MM" as this phone's local time. */
function parseLocal(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  return Number.isNaN(d.getTime()) || d.getMonth() !== Number(m[2]) - 1 ? null : d;
}

function schedulePresets(now = new Date()): { label: string; at: Date }[] {
  const inHour = new Date(Math.ceil((now.getTime() + 3_600_000) / 300_000) * 300_000);
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0);
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + ((8 - now.getDay()) % 7 || 7), 9, 0);
  return [
    { label: 'In 1 hour', at: inHour },
    { label: 'Tomorrow 09:00', at: tomorrow },
    { label: 'Monday 09:00', at: monday },
  ];
}

const EXPIRY = [
  { label: 'No end', hours: 0 },
  { label: '24 hours', hours: 24 },
  { label: '3 days', hours: 72 },
  { label: '7 days', hours: 168 },
] as const;

function Composer() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const client = useQueryClient();
  const toast = useToast();
  const [key] = useState(newKey);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState<AnnouncementCategory>('GENERAL');
  const [priority, setPriority] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [withLink, setWithLink] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkLabel, setLinkLabel] = useState('');
  const [when, setWhen] = useState<When>('NOW');
  const [scheduleText, setScheduleText] = useState(localLabel(schedulePresets()[0]?.at ?? new Date()));
  const [expiryHours, setExpiryHours] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const templates = useQuery({
    queryKey: ['admin', 'announcement-templates'],
    queryFn: () => api.get<{ templates: AnnouncementTemplate[] }>('/admin/announcement-templates'),
    select: (data) => data.templates.filter((t) => t.active),
    enabled: !id,
  });
  const existing = useQuery({
    queryKey: ['admin', 'announcement', id],
    queryFn: () => api.get<AdminAnnouncement>(`/admin/announcements/${id}`),
    enabled: Boolean(id),
  });
  const current = existing.data;
  useEffect(() => {
    if (!current) return;
    setTitle(current.title);
    setBody(current.body);
    setCategory(current.category);
    setPriority(current.priority === 'PRIORITY');
    setPinned(current.pinned);
    setWithLink(Boolean(current.linkUrl));
    setLinkUrl(current.linkUrl ?? '');
    setLinkLabel(current.linkLabel ?? '');
    if (current.publishAt) setScheduleText(localLabel(new Date(current.publishAt)));
  }, [current]);

  const urgent = category === 'URGENT';
  const placeholders = useMemo(() => unfilledPlaceholders(`${title}\n${body}`), [body, title]);
  const scheduleAt = parseLocal(scheduleText);
  const expiresAt =
    expiryHours > 0 ? new Date(Date.now() + expiryHours * 3_600_000).toISOString() : (current?.expiresAt ?? null);

  const content = () => ({
    title,
    body,
    category,
    priority: priority || urgent ? 'PRIORITY' : 'NORMAL',
    pinned,
    linkUrl: withLink && linkUrl.trim() ? linkUrl.trim() : null,
    linkLabel: withLink && linkLabel.trim() ? linkLabel.trim() : null,
    expiresAt,
  });

  const done = (message: string) => {
    haptics.notify('success');
    toast({ tone: 'success', title: message });
    void client.invalidateQueries({ queryKey: ['admin'] });
    void client.invalidateQueries({ queryKey: ['announcements'] });
    router.back();
  };

  const create = useMutation({
    mutationFn: (payload: unknown) => api.post<AdminAnnouncement>('/admin/announcements', payload),
    onSuccess: (result) =>
      done(
        result.status === 'PUBLISHED'
          ? 'Announcement sent to subscribers'
          : result.status === 'SCHEDULED'
            ? `Scheduled for ${formatDateTime(result.publishAt as string)}`
            : 'Draft saved',
      ),
    onError: () => haptics.notify('error'),
  });
  const update = useMutation({
    mutationFn: (payload: unknown) => api.put<AdminAnnouncement>(`/admin/announcements/${id}`, payload),
    onSuccess: () => done('Changes saved'),
    onError: () => haptics.notify('error'),
  });

  const fail = (issues: { path: PropertyKey[]; message: string }[]) => {
    const next: Record<string, string> = {};
    for (const issue of issues) next[String(issue.path[0])] ??= issue.message;
    setErrors(next);
    haptics.notify('warning');
  };

  const submit = () => {
    if (id && current) {
      const parsed = announcementUpdateSchema.safeParse({
        ...content(),
        publishAt: current.status === 'SCHEDULED' && scheduleAt ? scheduleAt.toISOString() : null,
        expectedVersion: current.version,
      });
      if (!parsed.success) return fail(parsed.error.issues);
      setErrors({});
      update.mutate(parsed.data);
      return;
    }
    const parsed = announcementCreateSchema.safeParse({
      ...content(),
      mode: when === 'NOW' ? 'PUBLISH' : when,
      publishAt: when === 'SCHEDULE' ? (scheduleAt?.toISOString() ?? null) : null,
      idempotencyKey: key,
    });
    if (when === 'SCHEDULE' && (!scheduleAt || scheduleAt.getTime() < Date.now())) {
      return fail([
        {
          path: ['publishAt'],
          message: scheduleAt ? 'Choose a time in the future' : 'Use the format 2026-11-20 09:30',
        },
      ]);
    }
    if (!parsed.success) return fail(parsed.error.issues);
    setErrors({});
    const go = () => create.mutate(parsed.data);
    const warnings = [
      placeholders.length > 0 ? `It still contains ${placeholders.join(', ')}.` : null,
      when === 'NOW' ? 'It goes to every subscriber with access, as an alert and on the News tab.' : null,
    ].filter(Boolean);
    if (when === 'DRAFT' || warnings.length === 0) return go();
    Alert.alert(when === 'NOW' ? 'Send this announcement now?' : 'Schedule this announcement?', warnings.join('\n\n'), [
      { text: 'Keep editing', style: 'cancel' },
      { text: when === 'NOW' ? 'Send now' : 'Schedule', onPress: go },
    ]);
  };

  if (id && existing.isPending) return <Loading rows={3} label="Loading announcement" />;
  const busy = create.isPending || update.isPending;
  const sentAlready = current?.everPublished ?? false;

  return (
    <Screen
      edges={['bottom']}
      keyboard
      testID="announcement"
      footer={
        <Button
          testID="announcement-send"
          label={
            id
              ? 'Save changes'
              : when === 'NOW'
                ? 'Send to subscribers'
                : when === 'SCHEDULE'
                  ? 'Schedule'
                  : 'Save draft'
          }
          variant="primary"
          large
          heavy={when === 'NOW' && !id}
          loading={busy}
          disabled={busy}
          onPress={submit}
        />
      }
    >
      <Stack.Screen options={{ title: id ? 'Edit announcement' : 'Announcement' }} />
      {sentAlready && (
        <Notice tone="neutral" icon="information-circle-outline">
          Already sent. Edits change what the News tab shows; the alert that went out stays as it was.
        </Notice>
      )}
      {!id && (templates.data?.length ?? 0) > 0 && (
        <View style={{ gap: space.sm }}>
          <T v="small" c="muted">
            Start from a template
          </T>
          <ChipRow>
            {templates.data?.map((t) => (
              <Chip
                key={t.id}
                testID={`template-${t.name}`}
                label={t.name}
                onPress={() => {
                  setTitle(t.title);
                  setBody(t.body);
                  setCategory(t.category);
                }}
              />
            ))}
          </ChipRow>
        </View>
      )}
      <Field
        testID="announcement-title"
        label="Title"
        value={title}
        onChangeText={setTitle}
        maxLength={120}
        error={errors.title}
      />
      <Field
        testID="announcement-message"
        label="Message"
        value={body}
        onChangeText={setBody}
        multiline
        maxLength={2000}
        error={errors.body}
        hint="Plain text. Line breaks are kept."
      />
      {placeholders.length > 0 && (
        <Notice tone="update" icon="create-outline" title="Fill in the template">
          Replace {placeholders.join(', ')} before sending.
        </Notice>
      )}
      <View style={{ gap: space.sm }}>
        <T v="small" c="muted">
          Category
        </T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {ANNOUNCEMENT_CATEGORIES.map((value) => (
            <Chip
              key={value}
              testID={`category-${value}`}
              label={ANNOUNCEMENT_CATEGORY_LABELS[value]}
              on={category === value}
              onPress={() => setCategory(value)}
            />
          ))}
        </View>
      </View>
      <ToggleRow
        label="Priority alert"
        hint={
          urgent
            ? 'Urgent announcements are always sent as priority alerts.'
            : 'A louder alert, highlighted on the News tab.'
        }
        value={priority || urgent}
        disabled={urgent}
        onChange={setPriority}
      />
      <ToggleRow
        label="Pin to the top"
        hint="Stays above other announcements until unpinned or archived."
        value={pinned}
        onChange={setPinned}
      />
      <ToggleRow label="Add a button with a link" value={withLink} onChange={setWithLink} />
      {withLink && (
        <>
          <Field
            label="Link"
            value={linkUrl}
            onChangeText={setLinkUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            hint="Must start with https://"
            error={errors.linkUrl}
          />
          <Field
            label="Button text"
            value={linkLabel}
            onChangeText={setLinkLabel}
            maxLength={40}
            hint="Optional, such as Read more."
          />
        </>
      )}

      {!id && (
        <>
          <SectionTitle>When</SectionTitle>
          <Segmented
            label="When"
            options={[
              { value: 'NOW', label: 'Now', testID: 'when-now' },
              { value: 'SCHEDULE', label: 'Schedule', testID: 'when-schedule' },
              { value: 'DRAFT', label: 'Draft', testID: 'when-draft' },
            ]}
            value={when}
            onChange={setWhen}
          />
        </>
      )}
      {(when === 'SCHEDULE' || current?.status === 'SCHEDULED') && (
        <View style={{ gap: space.sm }}>
          <ChipRow>
            {schedulePresets().map((p) => (
              <Chip
                key={p.label}
                label={p.label}
                on={scheduleText === localLabel(p.at)}
                onPress={() => setScheduleText(localLabel(p.at))}
              />
            ))}
          </ChipRow>
          <Field
            label="Publish at (your local time)"
            value={scheduleText}
            onChangeText={setScheduleText}
            hint="Format: 2026-11-20 09:30"
            error={errors.publishAt}
            autoCorrect={false}
          />
        </View>
      )}
      <View style={{ gap: space.sm }}>
        <T v="small" c="muted">
          Remove from the News tab after
        </T>
        <ChipRow>
          {EXPIRY.map((e) => (
            <Chip key={e.label} label={e.label} on={expiryHours === e.hours} onPress={() => setExpiryHours(e.hours)} />
          ))}
        </ChipRow>
        {current?.expiresAt && expiryHours === 0 && (
          <T v="caption" c="subtle">
            Currently until {formatDateTime(current.expiresAt)}.
          </T>
        )}
      </View>

      <SectionTitle>Preview</SectionTitle>
      <AnnouncementCard
        preview
        item={{
          id: 'preview',
          title: title || 'Title',
          body: body || 'Your message appears here.',
          category,
          priority: priority || urgent ? 'PRIORITY' : 'NORMAL',
          pinned,
          linkUrl: withLink && linkUrl ? linkUrl : null,
          linkLabel: withLink && linkLabel ? linkLabel : null,
          publishedAt: new Date().toISOString(),
          editedAt: null,
          expiresAt,
        }}
      />
      <Card style={{ gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Badge tone="neutral" icon="notifications-outline">
            Alert
          </Badge>
          <T v="caption" c="subtle">
            {urgent || priority ? 'Priority alert' : category === 'EDUCATIONAL' ? 'Quiet alert' : 'Normal alert'}
          </T>
        </View>
        <T v="strong" numberOfLines={1}>
          {title || 'Title'}
        </T>
        <T v="small" c="muted" numberOfLines={3}>
          {body || 'Your message appears here.'}
        </T>
      </Card>
      <FormError error={create.error ?? update.error} />
    </Screen>
  );
}

export default function AnnouncementRoute() {
  return (
    <ModalFrame>
      <Composer />
    </ModalFrame>
  );
}

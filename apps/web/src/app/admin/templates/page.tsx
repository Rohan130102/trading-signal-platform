'use client';

import {
  DEFAULT_TEMPLATES,
  renderTemplateText,
  TEMPLATE_TONES,
  type TemplateContext,
  type TemplateKind,
  type TemplateTone,
  validateTemplateText,
} from '@signaldesk/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Star } from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Badge,
  Button,
  Dialog,
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

interface Row {
  id: string;
  kind: TemplateKind;
  name: string;
  tone: TemplateTone;
  title: string;
  body: string;
  isDefault: boolean;
  active: boolean;
  favorite: boolean;
  updatedAt: string;
}

const SAMPLE: TemplateContext = {
  ref: 'T-0042',
  instrument: 'XAU/USD',
  direction: 'BUY',
  entry: '3,300.00',
  stop: '3,350.00',
  previousStop: '3,120.00',
  target1: '3,450.00',
  target2: '3,500.00',
  targets: '3,450.00, 3,500.00',
  targetIndex: '1',
  targetPrice: '3,450.00',
  exit: '3,450.00',
  portion: '50%',
  remaining: '50%',
  movement: '+150 pts (hypothetical)',
  reason: 'Target achieved',
  trail: '50 pts from 3,400.00',
  message: 'Sample instruction text.',
  comment: 'Sample comment.',
  changes: 'Stop-loss 3,120.00 → 3,130.00',
};

const TONE_LABEL: Record<TemplateTone, string> = {
  BUY: 'Blue, for BUY',
  SELL: 'Magenta, for SELL',
  UPDATE: 'Amber, operational',
  SUCCESS: 'Green, target events',
  STOP: 'Red, stop events',
  NEUTRAL: 'Neutral',
};

function Editor({ row, fields, onClose }: { row: Row | null; fields: string[]; onClose: () => void }) {
  const client = useQueryClient();
  const [kind, setKind] = useState<TemplateKind>(row?.kind ?? 'BUY_STANDARD');
  const [name, setName] = useState(row?.name ?? '');
  const [tone, setTone] = useState<TemplateTone>(row?.tone ?? 'BUY');
  const [title, setTitle] = useState(row?.title ?? '');
  const [body, setBody] = useState(row?.body ?? '');
  const [active, setActive] = useState(row?.active ?? true);
  const [favorite, setFavorite] = useState(row?.favorite ?? false);
  const issues = useMemo(
    () => [...validateTemplateText(title, 'title'), ...validateTemplateText(body, 'body')],
    [body, title],
  );
  const save = useMutation({
    mutationFn: () => {
      const values = { name, tone, title, body, active, favorite };
      return row ? api.put(`/admin/templates/${row.id}`, values) : api.post('/admin/templates', { ...values, kind });
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['admin', 'templates'] });
      toast.success('Template saved. Messages already sent keep their wording.');
      onClose();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  return (
    <Dialog open wide onOpenChange={(o) => !o && onClose()} title={row ? `Edit: ${row.name}` : 'New template'}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name">{(c) => <Input {...c} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          {row ? (
            <Field label="Colour">
              {(c) => (
                <Select {...c} value={tone} onChange={(e) => setTone(e.target.value as TemplateTone)}>
                  {TEMPLATE_TONES.map((t) => (
                    <option key={t} value={t}>
                      {TONE_LABEL[t]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : (
            <Field label="Used for">
              {(c) => (
                <Select {...c} value={kind} onChange={(e) => setKind(e.target.value as TemplateKind)}>
                  {DEFAULT_TEMPLATES.map((t) => (
                    <option key={t.kind} value={t.kind}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
        </div>
        {!row && (
          <Field label="Colour">
            {(c) => (
              <Select {...c} value={tone} onChange={(e) => setTone(e.target.value as TemplateTone)}>
                {TEMPLATE_TONES.map((t) => (
                  <option key={t} value={t}>
                    {TONE_LABEL[t]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Field label="Title">
          {(c) => <Input {...c} className="num" value={title} onChange={(e) => setTitle(e.target.value)} />}
        </Field>
        <Field
          label="Message"
          hint="A line whose fields are all empty is left out, so optional values leave no dangling labels."
        >
          {(c) => <Textarea {...c} className="num" rows={6} value={body} onChange={(e) => setBody(e.target.value)} />}
        </Field>
        <details className="text-[13px] text-muted">
          <summary className="cursor-pointer">Fields you can use</summary>
          <p className="num mt-1 text-xs leading-relaxed">{fields.map((f) => `{{${f}}}`).join('  ')}</p>
        </details>
        {issues.length > 0 && (
          <ul role="alert" className="flex flex-col gap-1 text-[13px] text-stop">
            {issues.map((i) => (
              <li key={i.message}>{i.message}</li>
            ))}
          </ul>
        )}
        <div className="rounded-lg bg-bg p-3">
          <p className="text-xs font-medium text-muted">Preview with sample values</p>
          <p className="mt-1 text-sm font-semibold">{renderTemplateText(title, SAMPLE)}</p>
          <p className="mt-0.5 whitespace-pre-line text-sm text-muted">{renderTemplateText(body, SAMPLE)}</p>
        </div>
        <div className="divide-y divide-line rounded-lg border border-line px-3">
          <Switch label="Available" checked={active} onChange={setActive} />
          <Switch
            label="Favourite"
            description="Listed first in the composer"
            checked={favorite}
            onChange={setFavorite}
          />
        </div>
        <FormError error={save.error} />
        <Button
          type="submit"
          variant="primary"
          size="lg"
          loading={save.isPending}
          disabled={issues.length > 0 || !name.trim() || !title.trim() || !body.trim()}
        >
          Save
        </Button>
      </form>
    </Dialog>
  );
}

export default function TemplatesPage() {
  const list = useQuery({
    queryKey: ['admin', 'templates'],
    queryFn: () => api.get<{ templates: Row[]; fields: string[] }>('/admin/templates'),
  });
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
  const names = Object.fromEntries(DEFAULT_TEMPLATES.map((t) => [t.kind, t.name]));
  return (
    <>
      <PageHeader
        title="Templates"
        description="The wording of every message. Values are always filled in from the structured trade."
        action={
          <Button variant="primary" onClick={() => setEditing('new')}>
            <Plus className="size-4" aria-hidden /> New template
          </Button>
        }
      />
      {list.isPending && <Loading rows={4} label="Loading templates" />}
      {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
      {list.data && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {list.data.templates.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => setEditing(t)}
                className="h-full w-full rounded-xl border border-line bg-surface p-4 text-left transition-colors hover:border-line-strong"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{t.name}</span>
                  {t.favorite && <Star className="size-3.5 fill-current text-update" aria-label="Favourite" />}
                  {!t.active && <Badge>Off</Badge>}
                  {!t.isDefault && <Badge tone="buy">Custom</Badge>}
                </div>
                <p className="text-xs text-muted">{names[t.kind]}</p>
                <p className="num mt-2 text-[13px] font-medium">{t.title}</p>
                <p className="num mt-0.5 line-clamp-3 whitespace-pre-line text-xs text-muted">{t.body}</p>
              </button>
            </li>
          ))}
        </ul>
      )}
      {editing && list.data && (
        <Editor row={editing === 'new' ? null : editing} fields={list.data.fields} onClose={() => setEditing(null)} />
      )}
    </>
  );
}

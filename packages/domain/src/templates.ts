import type { Issue } from './instrument.js';

export const TEMPLATE_KINDS = [
  'BUY_STANDARD',
  'SELL_STANDARD',
  'PRIORITY_SIGNAL',
  'ENTRY_ACTIVATED',
  'TARGET_HIT',
  'STOP_MOVED',
  'STOP_TRAILED',
  'TARGETS_MODIFIED',
  'PARTIAL_BOOKED',
  'FULL_PROFIT_BOOKED',
  'STOP_LOSS_HIT',
  'TRADE_CANCELLED',
  'ENTRY_EXPIRED',
  'TRADE_CLOSED',
  'URGENT_INSTRUCTION',
  'CORRECTION',
  'MARKET_UPDATE',
] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

export const TEMPLATE_TONES = ['BUY', 'SELL', 'UPDATE', 'SUCCESS', 'STOP', 'NEUTRAL'] as const;
export type TemplateTone = (typeof TEMPLATE_TONES)[number];

/** The only fields a template may reference. Anything else is rejected when the template is saved. */
export const TEMPLATE_FIELDS = [
  'ref',
  'instrument',
  'direction',
  'entry',
  'stop',
  'previousStop',
  'target1',
  'target2',
  'target3',
  'targets',
  'targetIndex',
  'targetPrice',
  'exit',
  'portion',
  'remaining',
  'movement',
  'reason',
  'trail',
  'message',
  'comment',
  'changes',
] as const;
export type TemplateField = (typeof TEMPLATE_FIELDS)[number];
export type TemplateContext = Partial<Record<TemplateField, string | null | undefined>>;

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
const KNOWN = new Set<string>(TEMPLATE_FIELDS);

export function validateTemplateText(text: string, field: string): Issue[] {
  const issues: Issue[] = [];
  for (const match of text.matchAll(PLACEHOLDER)) {
    const name = match[1] as string;
    if (!KNOWN.has(name)) {
      issues.push({
        field,
        code: 'UNKNOWN_FIELD',
        message: `Unknown field {{${name}}}. Allowed: ${TEMPLATE_FIELDS.join(', ')}.`,
      });
    }
  }
  const stripped = text.replace(PLACEHOLDER, '');
  if (stripped.includes('{{') || stripped.includes('}}')) {
    issues.push({ field, code: 'MALFORMED', message: 'Unbalanced {{ }} in template.' });
  }
  return issues;
}

/**
 * Substitutes structured values into template text. A line whose placeholders are all empty is
 * dropped, so optional values such as "Target 3" or a comment leave no dangling label behind.
 * The output is plain text and is always rendered as text by clients, never as HTML.
 */
export function renderTemplateText(text: string, ctx: TemplateContext): string {
  const lines = text.split('\n').flatMap((line) => {
    const fields = [...line.matchAll(PLACEHOLDER)].map((m) => m[1] as TemplateField);
    const anyEmpty = fields.some((name) => !ctx[name]);
    if (fields.length > 0 && anyEmpty) return [];
    return [line.replace(PLACEHOLDER, (_all, name: TemplateField) => ctx[name] ?? '')];
  });
  return lines.join('\n').trim();
}

export interface TemplateDefinition {
  kind: TemplateKind;
  name: string;
  tone: TemplateTone;
  title: string;
  body: string;
}

/** Seed content. Administrators edit these at runtime; code only falls back to them if one is missing. */
export const DEFAULT_TEMPLATES: TemplateDefinition[] = [
  {
    kind: 'BUY_STANDARD',
    name: 'Standard BUY',
    tone: 'BUY',
    title: 'New signal: BUY {{instrument}}',
    body: 'Entry: {{entry}}\nTarget 1: {{target1}}\nTarget 2: {{target2}}\nTarget 3: {{target3}}\nStop-loss: {{stop}}\n{{comment}}',
  },
  {
    kind: 'SELL_STANDARD',
    name: 'Standard SELL',
    tone: 'SELL',
    title: 'New signal: SELL {{instrument}}',
    body: 'Entry: {{entry}}\nTarget 1: {{target1}}\nTarget 2: {{target2}}\nTarget 3: {{target3}}\nStop-loss: {{stop}}\n{{comment}}',
  },
  {
    kind: 'PRIORITY_SIGNAL',
    name: 'Priority signal',
    tone: 'UPDATE',
    title: 'Priority signal: {{direction}} {{instrument}}',
    body: 'Entry: {{entry}}\nTarget 1: {{target1}}\nTarget 2: {{target2}}\nTarget 3: {{target3}}\nStop-loss: {{stop}}\n{{comment}}',
  },
  {
    kind: 'ENTRY_ACTIVATED',
    name: 'Entry activated',
    tone: 'UPDATE',
    title: 'Entry active: {{direction}} {{instrument}}',
    body: 'Trade {{ref}} is now active.\nStop-loss: {{stop}}\n{{comment}}',
  },
  {
    kind: 'TARGET_HIT',
    name: 'Target reached',
    tone: 'SUCCESS',
    title: 'Target {{targetIndex}} reached: {{direction}} {{instrument}}',
    body: 'Target {{targetIndex}} at {{targetPrice}} on trade {{ref}}.\nStop-loss: {{stop}}\n{{comment}}',
  },
  {
    kind: 'STOP_MOVED',
    name: 'Move stop-loss',
    tone: 'UPDATE',
    title: 'Move stop-loss to {{stop}}: {{direction}} {{instrument}}',
    body: 'Stop-loss on trade {{ref}} moved from {{previousStop}} to {{stop}}.\n{{comment}}',
  },
  {
    kind: 'STOP_TRAILED',
    name: 'Trail stop-loss',
    tone: 'UPDATE',
    title: 'Trail stop-loss to {{stop}}: {{direction}} {{instrument}}',
    body: 'Stop-loss on trade {{ref}} trailed from {{previousStop}} to {{stop}} ({{trail}}).\n{{comment}}',
  },
  {
    kind: 'TARGETS_MODIFIED',
    name: 'Targets changed',
    tone: 'UPDATE',
    title: 'Targets changed: {{direction}} {{instrument}}',
    body: 'New targets on trade {{ref}}: {{targets}}\n{{comment}}',
  },
  {
    kind: 'PARTIAL_BOOKED',
    name: 'Book partial profit',
    tone: 'SUCCESS',
    title: 'Book {{portion}} at {{exit}}: {{direction}} {{instrument}}',
    body: 'Partial exit on trade {{ref}} at {{exit}}. Open portion remaining: {{remaining}}.\nMove recorded: {{movement}}\n{{comment}}',
  },
  {
    kind: 'FULL_PROFIT_BOOKED',
    name: 'Book full profit',
    tone: 'SUCCESS',
    title: 'Book full profit at {{exit}}: {{direction}} {{instrument}}',
    body: 'Trade {{ref}} closed at {{exit}}.\nMove recorded: {{movement}}\n{{comment}}',
  },
  {
    kind: 'STOP_LOSS_HIT',
    name: 'Stop-loss hit',
    tone: 'STOP',
    title: 'Stop-loss hit at {{exit}}: {{direction}} {{instrument}}',
    body: 'Trade {{ref}} closed at the stop-loss.\nMove recorded: {{movement}}\n{{comment}}',
  },
  {
    kind: 'TRADE_CANCELLED',
    name: 'Trade cancelled',
    tone: 'NEUTRAL',
    title: 'Cancelled, do not enter: {{direction}} {{instrument}}',
    body: 'Signal {{ref}} is cancelled.\n{{comment}}',
  },
  {
    kind: 'ENTRY_EXPIRED',
    name: 'Entry expired',
    tone: 'NEUTRAL',
    title: 'Expired without entry: {{direction}} {{instrument}}',
    body: 'Signal {{ref}} expired before the entry was reached. Do not enter.\n{{comment}}',
  },
  {
    kind: 'TRADE_CLOSED',
    name: 'Trade closed',
    tone: 'NEUTRAL',
    title: 'Trade closed at {{exit}}: {{direction}} {{instrument}}',
    body: 'Trade {{ref}} closed at {{exit}}. Reason: {{reason}}.\nMove recorded: {{movement}}\n{{comment}}',
  },
  {
    kind: 'URGENT_INSTRUCTION',
    name: 'Urgent instruction',
    tone: 'UPDATE',
    title: 'Urgent: {{direction}} {{instrument}}',
    body: '{{message}}',
  },
  {
    kind: 'CORRECTION',
    name: 'Correction',
    tone: 'UPDATE',
    title: 'Correction: {{direction}} {{instrument}}',
    body: 'Correction to trade {{ref}}: {{changes}}\nReason: {{reason}}',
  },
  {
    kind: 'MARKET_UPDATE',
    name: 'General market update',
    tone: 'NEUTRAL',
    title: 'Market update',
    body: '{{message}}',
  },
];

/** Verifies built-in defaults stay renderable. Exercised by tests rather than at runtime. */
export function defaultTemplate(kind: TemplateKind): TemplateDefinition {
  const found = DEFAULT_TEMPLATES.find((t) => t.kind === kind);
  if (!found) throw new Error(`No default template for ${kind}`);
  return found;
}

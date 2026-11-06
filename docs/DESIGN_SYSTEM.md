# Design system

**Direction:** a quiet instrument panel. Near-monochrome, so the only colour on screen means something.
The dominant action is a solid light button (dark in light mode), not a brand hue. Prices are set in a
monospaced face with tabular figures, so columns line up and digits do not jitter on update.

Tokens live in `apps/web/src/app/globals.css`. Dark is the default, light is fully supported.

## Colour

| Token                             | Dark                              | Light                             | Meaning                                                      |
| --------------------------------- | --------------------------------- | --------------------------------- | ------------------------------------------------------------ |
| `--bg` / `--surface` / `--raised` | `#0b0d10` / `#13161b` / `#1a1e24` | `#f6f7f8` / `#ffffff` / `#f1f2f4` | Layers                                                       |
| `--text` / `--muted` / `--subtle` | `#eceef1` / `#a4acb6` / `#7d8691` | `#14171b` / `#555d67` / `#6b737d` | Text hierarchy                                               |
| `--line`                          | white 8%                          | black 10%                         | Hairlines                                                    |
| `--buy`                           | `#5aa9ff`                         | `#0b62c4`                         | BUY / long. Blue, not green, so it is never read as "profit" |
| `--sell`                          | `#ee7ab6`                         | `#b51e76`                         | SELL / short                                                 |
| `--update`                        | `#f0b341`                         | `#8f5b00`                         | Operational change                                           |
| `--success`                       | `#3fcf8e`                         | `#0b7a4b`                         | Target reached                                               |
| `--stop`                          | `#ff6b6b`                         | `#c4282d`                         | Stop-loss event, destructive action                          |

**Colour is never the only signal.** Direction carries an arrow and the word BUY or SELL. Every event
has a text label. Reached targets also show a check and strike-through. There is no "high profitability" badge
of any colour: `PRIORITY` means time-critical, and its definition says nothing about likely outcome.

## Type and spacing

- Sans: Geist. Prices and identifiers: Geist Mono, `tabular-nums`.
- Scale: 12, 13, 14, 16, 18, 22, 28, 36 px. Inputs are at least 16 px on touch, which also stops iOS zooming on focus.
- Spacing: Tailwind's 4 px grid. Card padding 16 to 20 px.
- Radius: 8 px controls, 12 px cards, 16 px dialogs.
- Touch targets: buttons and navigation at least 44 px on touch layouts. Inline text links are smaller, and pass WCAG 2.2's 24 px rule.

## Motion

Only to explain a change: a new feed item fades and slides in, and connection state cross-fades.
`prefers-reduced-motion` removes it all.

## Components

`apps/web/src/components/ui.tsx`: Button (primary, secondary, ghost, danger), Field, Input, Textarea, Select,
Segmented, Switch, Card, Badge, Dialog, EmptyState, ErrorState, Skeleton, Pagination, PageHeader, Stat, Kbd.

`apps/web/src/components/trade.tsx`: DirectionBadge, StatusBadge, EventLabel, Levels, FeedCard, TradeCard, Timeline.

## Signal treatments

| Kind                             | Accent  | Label example            |
| -------------------------------- | ------- | ------------------------ |
| New BUY                          | blue    | `NEW SIGNAL` + `▲ BUY`   |
| New SELL                         | magenta | `NEW SIGNAL` + `▼ SELL`  |
| Operational update               | amber   | `UPDATE TO T-0042`       |
| Target or profit booking         | green   | `UPDATE TO T-0042`       |
| Stop-loss hit                    | red     | `CLOSED`                 |
| Cancelled, expired, announcement | neutral | `CLOSED`, `ANNOUNCEMENT` |

An update is visually subordinate to a new signal: it names its parent trade and shows what changed as
`before → after`, so it cannot be mistaken for a new entry.

## States every screen handles

Loading (skeletons shaped like the content), empty (what it means, what to do next), error (what happened,
with a retry), offline or reconnecting (a persistent, non-blocking banner), access ended (why, the last valid
date, how to renew).

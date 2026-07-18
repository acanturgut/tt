# tt — Design System (Precision Workbench)

> Quiet chrome. Loud work. Every pixel explains state, hierarchy, or action.

Source of truth for tt's visual language. Direction: **Precision Workbench** — a
flat, native-feeling desktop tool. **Borderless**: depth comes from tonal steps
(canvas → elevated surface), never hairlines. System-sans for the product UI,
monospace only for code and identifiers, and the **active project's color paints
the toolbar + active tab** as identity. No gradients, glass, glow, oversized
pills, chrome borders, or generic-AI decoration.

All tokens live in `src/styles.css` `:root`. This doc is the rationale; the CSS is
the implementation.

## Color — surfaces (depth by tone, no chrome borders)

Separation between regions comes from the tonal step, never a hairline.

| Token | Purpose | Value |
|---|---|---|
| `--bg` | Canvas: stage, rails, board/viewer body | `#0A0B0D` |
| `--chrome` | Elevated panels + bars: board columns, headers, strips | `#111317` |
| `--elev` | Tiles, cards, inputs, menus, chips | `#16191E` |
| `--elev-2` | Hover / pressed | `#1D2128` |
| `--line` | Markdown & table rules only — **never chrome** | `#232830` |
| `--line-strong` | Tree indent guide | `#2E343E` |

Terminal bodies stay **true black** (`#000`). Rails share the canvas tone; the
center reads as content because tiles are elevated off it — no dividers.

## Color — text (all meet WCAG AA at rendered size)

| Token | Purpose | Value |
|---|---|---|
| `--text` | Primary | `#F2F4F7` |
| `--muted` | Secondary | `#A4ACB7` |
| `--dim` | Tertiary metadata | `#7F8996` |

Retired: `#6b7280` (4.34:1), `#5f6773` (3.67:1), inactive-tab `#6f7886` — all
failed AA at their small sizes.

## Color — meaning (strict priority order)

Color is spent in this order; higher tiers always outrank lower ones:

1. **Human attention / destructive** — `--amber` `#E3B341` (attention), `--danger` `#F85149` (destructive/failure). Never color alone: pair with icon + label.
2. **Focus / selection** — `--accent` `#5B8CFF` (`--accent-hi` `#7BA3FF` on hover). Selection rings, active terminal edge, focused control only.
3. **Semantic workflow state** — planning `#BC8CFF`, in-progress `#E3B341`, in-review `#58A6FF`, done `#3FB950`, needs-you `#F0883E`. Used on the status pill, agent-name tint, and board column markers.
4. **Project identity** — `--tab-accent` (per-project). **Paints the toolbar and the active project tab**, plus the welcome mark. This is the app's primary sense of "which project am I in"; the color picker exists to set it, so it earns real surface area. Toolbar controls sit on it via white-alpha overlays (work on any hue).
5. **Provider / file-type** — lowest intensity, scanning aid only.

## Typography

- **UI**: `--font-ui` = `-apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif`
- **Code / identifiers**: `--font-mono` = `ui-monospace, "SFMono-Regular", Menlo, monospace`
- Mono is reserved for: terminal output, file paths, agent numbers (`#2`), slash commands, keyboard shortcuts, code.
- Base UI size **13px**; 12px secondary metadata; 11px only for rare tertiary content. No task-blocking text below 12px.
- Weights: primary labels **550–600**, not 700–800 everywhere.
- Tabular numerals (`font-variant-numeric: tabular-nums`) for counts, agent numbers, tokens, timings.
- Sentence case for labels. `tt` stays lowercase (brand). Uppercase only for rare, letter-spaced section labels.

## Spacing & shape

- Base unit **4px**. Gaps: 4 · 8 · 12 · 16 · 24 only.
- Control heights: 32 compact · 36 default · 40 primary.
- Radii: `--r-sm` 4px (small controls) · `--r` 6px (tiles, fields) · `--r-lg` 8px (menus, dialogs).
- **No chrome borders.** Surfaces separate by fill/tone; overlays get a shadow, not a border. The only 1px `--line` rules allowed are inside rendered markdown (heading underline, table cells, blockquote). Focus rings are the sole exception — they appear only on `:focus-visible`.
- Pills reserved for true status/count badges (filled chip, status via text color).

## Motion

- 100–160ms transitions on opacity / color / transform only.
- No bounce, pulse, gradient shimmer, or decorative terminal animation.
- Attention appears immediately, then stays steady.
- `prefers-reduced-motion: reduce` disables non-essential transitions.

## State coverage (every interactive element)

hover · active · `:focus-visible` (2px `--accent` ring) · disabled · selected (where applicable).
Hover-only actions (tree row actions, column delete) also reveal on `:focus-within`.
Icon-only controls carry an accessible name; destructive actions confirm or offer undo.

## Anti-patterns (do not ship)

Hairline/borders on chrome (panels, tiles, inputs, cards, board, toolbar) ·
Menlo as the product voice · one-off grays/radii/shadows · gradients / glass / glow ·
oversized pills · generic-AI illustrations · color-only state · hover-only discovery ·
`outline: none` with no replacement.

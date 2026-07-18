# TT Product Design Review

Date: 2026-07-18  
Scope: current `main` at `e9a1dec`, all frontend UI source in `src/`, and the product screenshot in `README.md`  
Review target: a flat, highly polished desktop workbench that feels intentionally designed—not like an AI dashboard or a collection of generic components

## Executive Verdict

TT has the right product skeleton: projects, agents, terminals, files, tasks, and broadcast are organized around real operator workflows. The premium gap is not a lack of decoration. It is the absence of one strict visual and interaction system.

The current interface has three competing languages:

1. The project tabs, top bar, broadcast control, agent rail, and terminal tiles use a newer rounded dark UI.
2. The task board and code viewer use a visibly older, harder-edged gray UI.
3. Terminal conventions—Menlo everywhere, tiny labels, status dots, and terse icon actions—have leaked into the application chrome.

This makes the product feel assembled rather than art-directed. The strongest direction is a **Precision Workbench**: quiet neutral chrome, system-sans typography for the product UI, monospaced type only for code and identifiers, exact spacing, hairline separators, one restrained project accent, and extremely clear state changes.

The north-star principle is:

> Quiet chrome. Loud work. Every pixel explains state, hierarchy, or action.

## Review Confidence

The current source is the primary evidence. The README screenshot is useful for understanding information density and the multi-pane workflow, but it shows the older bottom broadcast bar while the current source places broadcast in the top bar. Visual observations based only on that screenshot are called out as such.

The frontend currently builds successfully and all 26 tests pass. The production build reports a 713 kB JavaScript chunk, which is a later performance-polish concern rather than the main design blocker.

## Design Scorecard

| Area | Current | Premium target | Main gap |
|---|---:|---:|---|
| Product architecture | 8/10 | 9/10 | Core jobs are present and sensibly grouped |
| Information density | 7/10 | 9/10 | Dense, but hierarchy and progressive disclosure need work |
| Visual hierarchy | 4/10 | 9/10 | Too much black, weak separation, accent used across large areas |
| Typography | 3/10 | 9/10 | 12 px Menlo is used as the entire product voice |
| Consistency | 4/10 | 10/10 | Shell, board, viewer, dialogs, and popovers do not share a system |
| Interaction clarity | 4/10 | 9/10 | Many actions are icon-only, hover-only, or undiscoverable |
| Accessibility | 2/10 | 9/10 | Keyboard, focus, semantics, labels, and dialog behavior need a pass |
| Product character | 6/10 | 9/10 | Strong concept; current component styling is too generic |
| Overall craft | 4.8/10 | 9+/10 | Needs a system-level redesign, not isolated CSS polish |

## What Is Already Strong

- The three-zone workspace—agents, terminals, files—maps well to the operator's mental model.
- Broadcast is a distinctive product capability and deserves to be the signature interaction.
- Focus mode plus the tiled overview is a strong answer to managing many active sessions.
- Agent attention, working/idle state, workflow state, and task progress are the right status dimensions.
- The application is unapologetically desktop-first. That is an advantage; it should feel closer to a premium IDE or operations console than a responsive SaaS dashboard.
- The default is already dark and restrained. The redesign should refine this character, not replace it with gradients, glass, illustrations, or large marketing-style cards.

## Why It Does Not Yet Feel “Million-Dollar”

### 1. Flat Has Become Visually Undifferentiated

Pure black is used for the canvas, panels, stage, and terminal background. Tiles are only slightly lighter. At a glance, the shell, navigation, content, and terminal surfaces occupy nearly the same depth.

Premium flat design still has hierarchy. It uses tonal steps and hairlines rather than large shadows. TT needs a deliberate canvas, chrome surface, content surface, hover surface, and selected surface—not one black field plus scattered rounded rectangles.

### 2. The Product UI Sounds Like a Terminal

`src/styles.css:15` applies 12 px Menlo to the entire app. This makes metadata, settings, tabs, onboarding, buttons, and task cards all speak with the same technical tone as the terminal content.

Use the macOS system UI stack for application chrome. Keep monospace for terminal output, paths, agent numbers, slash commands, keyboard shortcuts, and code. This one change will make TT feel materially more considered.

### 3. The Interface Has No Token Discipline

The stylesheet uses many one-off grays, blues, border colors, radii, shadows, and font sizes. Similar controls vary between 4, 5, 6, 7, 8, 10, 11, 12, 14, and 16 px radii. The board and viewer introduce another palette entirely.

Expensive-looking interfaces are usually less expressive at the component level and more rigorous at the system level. TT should have a small set of primitives and almost no local visual invention.

### 4. Too Many Actions Are Invisible Until You Already Know Them

Examples include double-click to rename, hover-only tree actions, hover-only board deletion, click-anywhere agent rows, clickable tile headers, and status pills implemented as spans. These patterns reward familiarity but create uncertainty and weak keyboard behavior.

The best operator tools are fast for experts without being cryptic for new users. TT needs visible defaults, tooltips with shortcuts, command-palette parity, and proper focus states.

### 5. State Priority Is Not Strong Enough

The most important question is “Which agent needs me right now?” That state must outrank provider brand, project color, workflow status, and decorative accents. The current UI uses several blue treatments plus amber attention, green activity, provider icons, file colors, status colors, and project colors. The result can become noisy even though each element is individually small.

Use color in this order:

1. Human attention and destructive state.
2. Focus/selection.
3. Semantic workflow state.
4. Project identity.
5. Provider and file-type identity only when it improves scanning.

## Three Viable Visual Directions

### A. Precision Workbench — Recommended

Neutral near-black shell, subtle gray tonal hierarchy, system-sans UI, compact 32–36 px controls, 1 px dividers, small corner radii, minimal shadow, and one project accent shown only on the active tab, focus ring, and active terminal edge.

Why it fits:

- Feels native to a professional desktop tool.
- Preserves terminal density and screen real estate.
- Ages well and avoids the current “AI product” visual clichés.
- Scales cleanly across agent rail, terminals, board, viewer, settings, and popovers.

Risk: restraint exposes every alignment and spacing mistake, so implementation quality must be exact.

### B. Editorial Console

Stronger typography, larger section labels, more white space, bold black-and-off-white contrast, fewer simultaneous controls, and a more opinionated visual voice.

Why it could work: distinctive, branded, and highly legible.

Risk: reduces information density and may feel more like a crafted content tool than a high-throughput terminal orchestrator.

### C. Cinematic Command Center

Layered translucent surfaces, soft blur, animated status light, richer project colors, and floating command controls.

Why it could work: immediately dramatic in screenshots.

Risk: most likely to feel trend-driven, “AI-like,” visually noisy, and less performant. It is not recommended for TT.

## Recommended Design System

### Color

Use a neutral system with only 4 core surface levels:

| Token | Purpose | Suggested value |
|---|---|---|
| `canvas` | Window background | `#090A0C` |
| `chrome` | Rails and title bar | `#0E1013` |
| `surface` | Tiles, fields, menus | `#14171B` |
| `surface-hover` | Hover and pressed states | `#1A1E24` |
| `line` | Hairline structure | `#242932` |
| `line-strong` | Selected/active boundaries | `#343B47` |
| `text` | Primary text | `#F2F4F7` |
| `text-muted` | Secondary text | `#A4ACB7` |
| `text-dim` | Tertiary metadata | `#7F8996` |
| `accent` | Selection/focus only | `#5B8CFF` |

Rules:

- Keep terminal canvases true black if users prefer it; do not make the entire product shell true black.
- Show the project color as a 2 px active marker, small icon field, or focused control accent. Do not flood the whole toolbar with project color.
- Reserve amber/orange for human attention. Reserve red for destructive actions and failure.
- Do not color every file type and provider at full intensity. Use color as a scanning aid, not decoration.
- Maintain WCAG AA contrast for all normal text. Current `#6b7280` on black is 4.34:1, `#5f6773` on black is 3.67:1, and inactive project text is about 3.99:1 on its surface; all are too weak for their small sizes.

### Typography

- UI: `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`.
- Code: `ui-monospace, "SFMono-Regular", Menlo, monospace`.
- Default UI size: 13 px; use 12 px for secondary metadata and 11 px only for exceptional tertiary content.
- Primary labels: 550–600 weight, not 700–800 everywhere.
- Use tabular numerals for task counts, agent numbers, timing, and token values.
- Use sentence case for labels. Keep the product name `tt` lowercase as a deliberate brand exception.
- Avoid uppercase section labels unless they are rare and letter-spaced with sufficient contrast.

### Spacing and Shape

- Base spacing unit: 4 px.
- Common gaps: 4, 8, 12, 16, and 24 px only.
- Control heights: 32 px compact, 36 px default, 40 px primary.
- Radii: 4 px for small controls, 6 px for tiles and fields, 8 px for floating menus/dialogs.
- Borders: 1 px hairline; use shadow only on floating overlays.
- Remove pill shapes except for true status badges and count badges.

### Motion

- Use 100–160 ms transitions for opacity, color, and transform only.
- No bouncing, pulsing gradients, background glows, or decorative terminal animations.
- Attention should appear immediately, then remain steady.
- Add a `prefers-reduced-motion` mode that disables nonessential transition and animated attention behavior.

## North-Star Layout

### Window Chrome

Reduce the current 40 px project-tab bar plus 48 px toolbar into one 44–48 px title bar where platform constraints allow it.

Left to right:

1. Traffic-light safe area.
2. Project switcher with icon, project name, and compact dropdown.
3. Spawn control as one primary button with a provider menu; optionally keep 2–3 pinned providers.
4. Broadcast command field as the visual center.
5. Board, layout, panel, settings, and overflow controls.

Multiple projects should use a horizontal project strip only when 2 or more are open. It should scroll, expose an overflow menu, and never squeeze the command field below a usable width.

### Workspace

- Left agent rail: resizable, 224–280 px, persisted width, collapses automatically at constrained widths.
- Center stage: the dominant surface; terminal content should receive at least 65% of the window width in the normal layout.
- Right file rail: resizable, 240–320 px, persisted width, collapses independently.
- Use a 1 px line between structural regions and 6–8 px gutters between terminal tiles.
- Keep the task/status strip at 28–32 px; make it a clear button with progress semantics, not an anonymous clickable div.
- At narrow desktop sizes, collapse the right rail first, then the left rail. Do not shrink terminals into unusable columns.

## Surface-by-Surface UX Review

### Project Navigation

Current risk: overlapping rounded tabs with negative margins look like browser chrome and can overflow without a clear strategy.

Recommended behavior:

- One active project control by default; reveal a project strip only when it adds value.
- Use the project icon as identity, not as a hidden nested click target.
- Move project appearance and removal into a proper context menu.
- Show the active project with a 2 px accent and stronger label, not a fully colored toolbar.
- Provide `⌘1`–`⌘9` project shortcuts only if they do not conflict with agent focus shortcuts; otherwise use `⌘⇧1`–`⌘⇧9`.

### Agent Rail

Current risk: whole rows, close spans, status spans, drag behavior, and attention affordances compete inside one small region.

Recommended row anatomy:

- 36–44 px primary row: state indicator, agent name, provider glyph, human-attention icon, overflow menu.
- Optional second line: workflow state and short task/title, truncated to one line.
- Clicking the primary area focuses the agent.
- Close/kill lives in the overflow menu; `⌘W` can close the focused agent with an undo toast.
- Attention uses icon + label + color, never color alone.
- Dragging shows a precise insertion line and supports keyboard reordering through the command palette.

### Terminal Tiles

Current risk: tile-header click, zoom spans, close span, status pill, and double-click rename are not discoverable or keyboard-complete.

Recommended behavior:

- Header height 32 px with a stable action order.
- One focus action on the name/title area; separate real buttons for layout and overflow.
- Put destructive close in an overflow menu or require an undo toast.
- Replace double-click-only rename with a context-menu command and `F2` shortcut while retaining double-click as a convenience.
- Use a 2 px active edge or focus ring. Avoid coloring the whole tile.
- Show agent title/task only when it adds information; do not repeat provider, generated name, status, and path simultaneously.

### Broadcast

Broadcast should become TT's signature interaction.

Recommended behavior:

- `⌘L` or another unambiguous shortcut focuses the field.
- Field label changes with targeting: “Message all 6 agents” or “Message 2 selected agents.”
- Target control shows a clear count and `aria-expanded` state.
- Keep `/all`, `/none`, and `#2` expert syntax, but do not place the full manual in the placeholder.
- Move the numbering option into a compact options menu unless it is used frequently enough to deserve constant visibility.
- On send, briefly confirm destination count without moving layout; failures stay visible and explain the next action.
- Never clear a long draft if delivery fails.

### File Tree

Current risk: folder and action spans are mouse-first, the action icons appear only on hover, and the row heights are very small.

Recommended behavior:

- Use native tree keyboard behavior: arrows navigate and expand, Enter opens, Space selects, and Shift+F10 opens context actions.
- 24–28 px rows with clear focus treatment.
- One context-menu button appears on row hover **and focus-within**.
- Search supports `⌘P`/`⌘⇧O`, clear button, result count, and empty/error states.
- Creating a folder uses inline validation, not blocking browser alerts.
- Reduce file-type color saturation. The tree should support navigation, not compete with agent attention.

### Task Board

Current risk: the source defines 5 workflow columns while the CSS explicitly creates 4 columns. “Done” can wrap into a second row, breaking the board model.

Recommended behavior:

- Render all 5 stages in one horizontal track with 240–280 px minimum column widths and horizontal overflow.
- Put “Needs You” immediately after “In Progress”; it is the board's highest-priority state.
- Use one colored 2 px column marker and neutral card surfaces.
- Make counts tabular and align them consistently.
- Keep “delete all” visible on keyboard focus and in a column menu; retain confirmation.
- Long task titles and results should clamp with an explicit expand affordance.
- If the board is truly read-only, remove drag affordances and cursor styles that suggest editing.

### Code Viewer

Current risk: the viewer is useful but uses a separate legacy visual vocabulary.

Recommended behavior:

- Reuse the same shell header, buttons, surface, line, and typography tokens as the rest of TT.
- Treat the path as a breadcrumb with copy action in an overflow menu.
- Use a segmented Rendered/Source control for Markdown.
- Keep the selection-to-agent action; it is differentiated product value. Make it keyboard reachable and announce copy success.
- Constrain prose line length in rendered Markdown to roughly 72–88 characters while allowing tables and code to break out to full width.

### Settings, Templates, Install Help, and Command Palette

Current risk: all are visually similar overlays but none implements complete dialog/combobox semantics or focus management.

Recommended behavior:

- One shared overlay primitive with dialog semantics, initial focus, focus trap, Escape handling, focus restoration, and inert background.
- Command palette uses a real combobox/listbox pattern.
- Settings uses semantic headings and associated labels.
- Templates asks for confirmation or provides undo after deletion.
- Copy/install feedback uses a polite live region.
- Keep shadows only on these floating layers; structural panels remain flat.

### Onboarding

Current risk: 6 equal feature cards explain the product before the user has completed the first action. This is a common generic dashboard/onboarding pattern.

Recommended behavior:

- Lead with a single 3-step story: add a project, spawn an agent, coordinate the work.
- One primary “Add Project Folder” action.
- Show 3 concise keyboard/product benefits below, not 6 equal cards.
- Use a tiny live workspace preview or a precise text diagram only if it materially clarifies the model; avoid abstract AI artwork.

## Accessibility and Interaction Priorities

These are release-quality requirements, not optional polish:

1. Every interactive element is reachable and operable by keyboard.
2. Every icon-only action has an accessible name and visible tooltip.
3. Every control has a visible `:focus-visible` treatment.
4. Dialogs trap focus, restore focus, expose a title, and mark the background inert.
5. Forms have visible or programmatic labels, names, and appropriate autocomplete behavior.
6. Popovers and menus expose expanded, selected, and checked state.
7. Text meets WCAG AA contrast at its rendered size.
8. Attention, workflow, activity, and error are never conveyed by color alone.
9. Destructive actions require confirmation or a reliable undo window.
10. Async status changes use a polite live region.

## Priority Roadmap

### P0 — Fix Interaction and Accessibility Defects

- Correct the 5-column task board layout.
- Add a global focus-visible system.
- Replace clickable spans/divs in primary flows with buttons or appropriate semantic patterns.
- Label icon-only buttons and all form controls.
- Add dialog, menu, listbox, combobox, tree, and progress semantics.
- Add close/kill and delete undo or confirmation behavior.
- Fix small-text contrast failures.

### P1 — Establish One Visual System

- Introduce surface, text, line, accent, radius, spacing, and type tokens.
- Move application chrome from Menlo to system sans.
- Refactor board, viewer, dialogs, menus, and onboarding onto shared primitives.
- Reduce project color from a large toolbar fill to a selection accent.
- Remove unused custom-select styles or implement one accessible shared select.

### P2 — Recompose the Shell

- Consolidate project navigation and toolbar height.
- Add resizable/persisted rails and responsive collapse thresholds.
- Give broadcast a clearer target model and expert shortcut layer.
- Simplify tile and rail actions with progressive disclosure.

### P3 — Craft and Product Character

- Refine copy, spacing, truncation, empty states, and status language.
- Add restrained, interruptible motion and reduced-motion support.
- Test high-density states: 1, 4, 9, 20+ agents; deep file trees; 20 projects; very long names and paths.
- Test at 1280×720, 1440×900, 1728×1117, and 200% text zoom.
- Audit the production bundle and load heavy viewer/terminal features only when needed.

## Definition of Done

The redesign is ready when:

- A new user can add a project, spawn an agent, focus it, broadcast, and find a file without instruction.
- An expert can complete every common action without the mouse.
- At 1280×720, the focused work surface remains useful and neither rail forces terminal text into an unreadable column.
- At least 4 agents are scannable in under 2 seconds by attention, activity, workflow state, and name.
- Every clickable target has a hover, active, focus-visible, disabled, and—when applicable—selected state.
- No UI text below 12 px is required to complete a task.
- Normal text meets 4.5:1 contrast and meaningful non-text indicators meet 3:1.
- The design uses no gradients, glow effects, generic AI illustrations, oversized pills, or decorative glass.
- Board, viewer, onboarding, menus, settings, and terminals are visibly part of the same product.

## Source-Level Web Interface Audit

The findings below follow the current [Vercel Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines). They are grouped by source file and prioritized for design-system implementation.

### `index.html`

`index.html:5` - add a theme-color meta value matching the window canvas  
`index.html:11` - no skip link or equivalent keyboard path to the main work surface  
`index.html:12` - project navigation container needs a navigation/tab semantic model  
`index.html:20` - workspace regions need stable accessible labels

### `src/styles.css`

`src/styles.css:15` - 12 px Menlo applied to the entire product UI; reserve monospace for code and identifiers  
`src/styles.css:38` - only responsive rule covers onboarding; shell has no constrained-width behavior  
`src/styles.css:50` - 30×30 icon controls are visually small and have no shared focus-visible style  
`src/styles.css:55` - project strip has no overflow strategy for many or long project names  
`src/styles.css:57` - inactive project text contrast is about 3.99:1 at 12 px  
`src/styles.css:65` - 24×24 color swatches are undersized and rely on border color for selection  
`src/styles.css:115` - agent row exposes hover but no focus-visible state  
`src/styles.css:133` - agent-number color is about 3.67:1 on black at 10 px  
`src/styles.css:149` - tile action targets are only icon padding around spans and have no focus state  
`src/styles.css:159` - `outline: none` on rename input without replacement  
`src/styles.css:162` - status pill is styled as interactive but has no keyboard/focus treatment  
`src/styles.css:171` - `outline: none` on tree search without replacement  
`src/styles.css:183` - tree actions are hover-only; reveal them on `:focus-within` too  
`src/styles.css:191` - `outline: none` on new-folder input without replacement  
`src/styles.css:194` - popovers need overscroll containment and a consistent menu focus style  
`src/styles.css:221` - `outline: none` on command palette input without replacement  
`src/styles.css:236` - native select needs explicit focus-visible styling  
`src/styles.css:253` - `outline: none` on template input without replacement  
`src/styles.css:276` - `outline: none` on broadcast input without a visible control-level focus ring  
`src/styles.css:278` - broadcast popover needs overscroll containment and keyboard-active styling  
`src/styles.css:305` - CSS renders 4 grid columns while the board source defines 5 workflow columns  
`src/styles.css:309` - destructive column action is opacity-zero until mouse hover; keyboard users cannot discover it  
`src/styles.css:324` - clickable task strip has no focus-visible state and no button semantics  
`src/styles.css:345` - rendered Markdown headings need `scroll-margin-top`  
`src/styles.css:355` - rendered Markdown images have no rule or preprocessing path for intrinsic dimensions  
`src/styles.css:358` - toast is visually styled, but the system needs a shared live-region pattern  
`src/styles.css:1` - no `prefers-reduced-motion` variant for UI transitions

### `src/topbar.ts`

`src/topbar.ts:24` - icon button helper uses `title`; add an explicit accessible name  
`src/topbar.ts:66` - color swatches need meaningful names and `aria-pressed` selected state  
`src/topbar.ts:82` - icon picker buttons need selected state and keyboard navigation  
`src/topbar.ts:131` - project controls should expose `tablist`/`tab` and `aria-selected` semantics  
`src/topbar.ts:136` - nested project-style icon is not an independently keyboard-reachable action  
`src/topbar.ts:184` - provider spawn buttons are icon-only and need accessible names beyond tooltips

### `src/sidebar.ts`

`src/sidebar.ts:65` - agent row is a clickable div without keyboard activation  
`src/sidebar.ts:72` - focus action should be a button; current handler is mouse-only  
`src/sidebar.ts:101` - close action is a clickable span without keyboard support or accessible name  
`src/sidebar.ts:112` - long instructional `title` is not a replacement for visible or accessible help  
`src/sidebar.ts:72` - close/kill behavior has no confirmation or undo path

### `src/main.ts`

`src/main.ts:116` - close-agent handler kills immediately; add confirmation for risky cases or a reliable undo/reconnect window  
`src/main.ts:337` - spawn failure uses a blocking browser alert instead of an inline, actionable error

### `src/tiles.ts`

`src/tiles.ts:63` - clickable tile header has no keyboard activation or button semantics  
`src/tiles.ts:96` - zoom-out action is a clickable span, mouse-only  
`src/tiles.ts:104` - zoom-in action is a clickable span, mouse-only  
`src/tiles.ts:112` - close action is a clickable span without confirmation/undo  
`src/tiles.ts:63` - draggable tile has no keyboard reorder equivalent in the surface

### `src/naming.ts`

`src/naming.ts:21` - rename is discoverable only by mouse double-click; add `F2` and menu access  
`src/naming.ts:23` - rename input lacks label, name, autocomplete policy, and visible focus replacement

### `src/statuspill.ts`

`src/statuspill.ts:36` - interactive status control is a span, not a button  
`src/statuspill.ts:47` - menu lacks menu semantics, focus management, arrow navigation, and Escape handling  
`src/statuspill.ts:50` - menu items are clickable divs without keyboard activation  
`src/statuspill.ts:26` - placeholder copy “status” is vague; use a specific action label such as “Set Status”

### `src/tree.ts`

`src/tree.ts:40` - search input lacks a label, name, and autocomplete policy  
`src/tree.ts:96` - search result row is mouse-only  
`src/tree.ts:106` - open-agent action is a clickable span, mouse-only  
`src/tree.ts:136` - folder row lacks complete treeitem semantics and keyboard expansion  
`src/tree.ts:145` - open-agent and new-folder controls are hover-only clickable spans  
`src/tree.ts:207` - new-folder input lacks label/name and uses blocking alerts for validation  
`src/tree.ts:217` - replace browser alert with inline error text and focus/announce it  
`src/tree.ts:307` - popup menu lacks menu semantics, focus management, and keyboard navigation  
`src/tree.ts:334` - popup items are clickable divs

### `src/broadcast.ts`

`src/broadcast.ts:137` - slash-command options are clickable divs and mouse-down-only  
`src/broadcast.ts:175` - target popup lacks dialog/listbox semantics and focus management  
`src/broadcast.ts:209` - target rows need checkbox/option semantics and selected state  
`src/broadcast.ts:247` - target trigger needs `aria-expanded`, `aria-controls`, and a clear accessible name  
`src/broadcast.ts:262` - broadcast input lacks label, name, and autocomplete policy  
`src/broadcast.ts:264` - placeholder carries too many instructions; move help to shortcuts/menu  
`src/broadcast.ts:305` - numbered-message toggle needs `aria-pressed`

### `src/palette.ts`

`src/palette.ts:42` - overlay lacks dialog semantics, accessible title, focus trap, and focus restoration  
`src/palette.ts:46` - input lacks combobox semantics, label, name, and autocomplete policy  
`src/palette.ts:49` - results container lacks listbox semantics  
`src/palette.ts:61` - command option is a mouse-down div without option semantics  
`src/palette.ts:59` - filtered empty state is not rendered

### `src/settings.ts`

`src/settings.ts:54` - settings overlay lacks dialog semantics, focus trap, initial focus, and focus restoration  
`src/settings.ts:59` - title should be a semantic heading and label the dialog  
`src/settings.ts:115` - section labels should use hierarchical headings  
`src/settings.ts:127` - checkboxes need stable names  
`src/settings.ts:141` - select label is a sibling span rather than an associated label  
`src/settings.ts:145` - select needs a stable name and explicit focus-visible styling

### `src/templates.ts`

`src/templates.ts:65` - template overlay lacks dialog semantics and focus management  
`src/templates.ts:83` - use an em dash instead of a spaced hyphen in empty-state copy  
`src/templates.ts:105` - delete action is a clickable span with no accessible name, confirmation, or undo  
`src/templates.ts:121` - template-name input lacks label, name, and autocomplete policy  
`src/templates.ts:130` - invalid save silently does nothing; explain whether name or current agents are missing  
`src/templates.ts:152` - autofocus needs restoration to the invoking control when the dialog closes

### `src/installs.ts`

`src/installs.ts:61` - install-help overlay lacks dialog semantics and focus management  
`src/installs.ts:70` - title should be a semantic heading and label the dialog  
`src/installs.ts:84` - icon-only copy button needs an explicit accessible name  
`src/installs.ts:88` - copied state changes only the tooltip/class; announce success in a live region  
`src/installs.ts:106` - “Open Docs” should expose external navigation behavior consistently

### `src/board.ts`

`src/board.ts:6` - source defines 5 columns; current 4-column CSS causes the final column to wrap  
`src/board.ts:53` - board title should be a semantic heading  
`src/board.ts:64` - columns need named region/list semantics  
`src/board.ts:69` - column names should be headings and counts should use tabular numerals  
`src/board.ts:75` - icon-only delete-all button needs an explicit accessible name  
`src/board.ts:89` - task cards need list-item semantics and an empty state per column

### `src/taskstrip.ts`

`src/taskstrip.ts:19` - clickable strip div has no keyboard handler or button semantics  
`src/taskstrip.ts:36` - visual progress bar lacks progressbar semantics and accessible value  
`src/taskstrip.ts:56` - changing agent/task status line needs a polite live region

### `src/providers.ts`

`src/providers.ts:22` - provider images need explicit width and height attributes to avoid layout shift  
`src/providers.ts:24` - provider image may be decorative beside a text label; use empty alt where duplicated

### `src/icon.ts`

`src/icon.ts:4` - shared decorative icon helper should set `aria-hidden="true"`; interactive parents still need explicit accessible names

### `src/welcome.ts`

`src/welcome.ts:53` - welcome title should be the screen's semantic `h1`  
`src/welcome.ts:70` - add-project failure uses a blocking alert instead of an inline error with a next step  
`src/welcome.ts:74` - 6 equal feature cards dilute the primary onboarding action and should be reduced to a short guided sequence

### `src/viewer.ts`

`src/viewer.ts:114` - viewer header should be a named navigation/toolbar region  
`src/viewer.ts:127` - Rendered/Raw control needs pressed/selected state, not only changing text  
`src/viewer.ts:148` - viewer error should include a next action and use an alert/status announcement  
`src/viewer.ts:243` - floating selection action is positioned from a layout read; keep reads/writes batched during frequent selection changes  
`src/viewer.ts:264` - pass: copy toast uses `role="status"`; retain this pattern in the shared toast primitive

## Final Recommendation

Do not begin by polishing individual cards. First establish tokens, type, focus, semantics, shell geometry, and state priority. Then rebuild each surface from the same primitives.

The premium version of TT should not look more “designed” at first glance. It should feel calmer, faster, and more inevitable. Users should notice the work and the agent state—not the component library.

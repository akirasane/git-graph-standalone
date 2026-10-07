# Git Graph Standalone - UI contract (Nocturne)

One look for every window. The system is **Nocturne**, from Claude Design
(project `d159ee38-74b3-4b94-873b-b8b113157ac2`; mock-ups in project `1ba2ed91-7c1e-463d-8094-e4f101a265ac`,
files "Home Hub.dc.html" and "Graph View.dc.html"). Reference renders: `home-hub.png`, `graph-view.png` in this folder.

Code foundation (already in the repo - USE IT, do not re-invent):

| File | What |
| --- | --- |
| `electron/ui/nocturne.css` | tokens + components (`.btn`, `.input`, `.check`, `.tag`, `.card`, `.dialog`, `.table`, `.gg-menu`, `.gg-toast`, `.kbd`, `.skeleton`, ...). Link from EVERY page/window. |
| `electron/ui/icons.js` | Phosphor icons: `<i data-icon="git-branch"></i>` (auto-hydrates, also for nodes added later) or `GG.icon('git-branch')`. Add icons by editing `scripts/build-icons.js` and re-running it (`node scripts/build-icons.js <path to @phosphor-icons/core>`; the package is in `/tmp/gg-assets/node_modules` or `npm i @phosphor-icons/core` anywhere). |
| `electron/ui/fonts/` | Inter variable (bundled - the app must work offline). |

## Principles (non-negotiable)

1. **Tokens only.** Never hard-code a hex, font, radius or shadow that a token carries (`var(--color-*)`, `--radius-*`, `--shadow-*`, `--space-*`, `--font-*`). New values must be derived from the ramps (`color-mix()` of a token, or an `--color-accent-N` step).
2. **Outlined actions, never solid fills.** Primary = accent outline (`.btn-primary`), secondary = divider outline, destructive = `.btn-danger` (outlined). No gradient on any control, no saturated flood, no emoji, no glassmorphism blur panels.
3. **The accent is a line and a glow.** Selection / current item = 2px accent edge line + faint accent tint (`color-mix(accent 10%)`). Focus = the 2px accent `:focus-visible` ring (already global). Hover = `--color-hover` tint; pressed = `--color-pressed`.
4. **Quiet, compact, left-aligned.** Body 13px (Nocturne is dense on purpose), list rows 28-30px, controls 30-32px high, radius 8 (cards/inputs/buttons), 14 (dialogs), 4 (small chips). Headings weight 500 only; hierarchy by size/space/muted color. Section kickers: 10px, uppercase, `letter-spacing:.1em`, `--color-muted`.
5. **Surfaces by tone.** Ground `--color-bg`; panels/sidebars a touch darker (`color-mix(in srgb, var(--color-bg) 82%, black)`); raised things (cards, dialogs, menus, inputs) `--color-surface` with `--shadow-sm/md/lg` (hairline edge + ambient dark). Freestanding rules fade at their ends (`.hr`, table rows, list separators use the fading-gradient rule); boxed outlines stay solid.
6. **Status colors** (derived, defined in nocturne.css): `--color-success`, `--color-warning`, `--color-danger`, `--color-info`, with `-bg` tints. Use as text/icon color + 14% tint, never as a flood.
7. **Motion is restrained**: 140-240ms, opacity/translate only (`gg-fade`, `gg-rise`, `gg-pop`, `--ease`). No looping decorative animation (no shimmer sweeps, no pulsing dots, no aurora). Spinners only for real progress. `prefers-reduced-motion` is already handled globally.
8. **Every window looks the same**: main window, hub, graph, dialogs, context menus, dropdowns, find/settings widgets, conflict editor, diff window, picker/input prompts, credential prompt, update prompts, native-dialog replacements. If a surface cannot be themed (native OS dialog), replace it with a themed one.
9. **Accessibility**: visible focus on every interactive element, text contrast >= 4.5:1 (use `--color-text`/`--color-muted`; never `--color-faint` for essential text), hit targets >= 28px, full keyboard operation, `aria-label` on icon-only buttons, `title` tooltips.
10. **No dead code left behind**: when a restyle makes an old rule/file obsolete (e.g. `electron/theme.css` "Obsidian" hacks, `fx.js` spotlight), delete it.

## Graph lane palette

Branch lines/dots: ~10 hues at the same lightness/chroma (oklch ~ .72 .10 H) so lanes read as one family, first lane = accent `#9184d9`. Suggested: `#9184d9` `#6fb5c9` `#c79a6a` `#7fc79b` `#d98fa6` `#a8b86a` `#7a9fe0` `#c98ad9` `#6fc9b0` `#d9a06f` `#9aa0b8`. Set in `electron/src/config.ts` default `graph.colours` / `electron/index.html` `initialState.config.graph.colours`, and the `--git-graph-color*` vars.

## Screens

- **Hub** (`home.html`): see `home-hub.png`. Title bar, "Repositories" h2 + inline stats, outlined actions, search + segmented filter + sort, kicker-headed sections (Pinned / Recent), `.card`-surface repo cards (monogram tile in `--color-accent-800`, tags for branch / changes / sync / clean, last-commit line). Hover card = accent 1px outline + soft accent glow + 2px lift.
- **Graph shell** (`index.html`): see `graph-view.png`. Left sidebar 248px (back link, branch line, Pull/Push/Fetch, filter, collapsible Local/Remote/Tags/Stashes with the accent-edge current branch), centre commit table with thin-line graph, right panel 318px (Working copy / Stash tabs with accent underline, file rows with status letter + diff counts + hover actions, commit form with the sparkle AI button).
- **Dialogs** (`.dialog` on `.dialog-backdrop`): 440px, radius 14, `--shadow-lg`, title 18px, body 13px, actions right-aligned outlined buttons (primary right-most). Destructive confirm uses `.btn-danger`.
- **Context menus / dropdowns**: `.gg-menu` look (surface, `--shadow-md`, radius 8, 6px/12px items, hover tint, thin separators, right-aligned `.kbd`).
- **Toasts**: `.gg-toast` (success / error icon in status color), bottom-centre.
- **Secondary windows** (picker, input, credential prompt, diff, update progress): frameless-or-themed window, `gg-titlebar` style header, same tokens, Esc closes, Enter submits.

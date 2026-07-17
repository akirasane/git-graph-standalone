# Git Graph Standalone (Electron) — Theming Bug Brief

## Project context

`vscode-git-graph` is being ported from a VSCode extension to a standalone Electron
app. The frontend (`web/*.ts` compiled to `media/out.min.js` + `media/out.min.css`)
is reused **verbatim** — it is the exact same JS/CSS the VSCode extension ships,
unmodified. It was written assuming it always runs inside a real VSCode
`WebviewPanel`.

Repo root: `D:\Development_Projects\vscode-git-graph`
Electron shell: `D:\Development_Projects\vscode-git-graph\electron\`
- `electron/index.html` — static HTML shell, hand-written for this port (safe to edit)
- `electron/src/*.ts` — Electron main-process code (safe to edit)
- `media/out.min.css`, `media/out.min.js` — **generated** from `web/*.ts`/`web/styles/*.css`
  by the root project's own build (`npm run compile-web`). Do not hand-edit; treat as
  a build artifact reused as-is.
- `web/styles/*.css` — the **source** stylesheets that get concatenated/minified into
  `media/out.min.css`. Read-only reference for understanding what selectors expect.

## The bug

After adding a set of `--vscode-*` CSS custom property values to `electron/index.html`
(to fix transparent dropdown/menu backgrounds — see "What was already tried" below),
the app now renders with a **dark background and dark (unreadable) text** — i.e.
background flipped correctly to dark, but general text did not flip to a light color,
so it's dark-on-dark.

## Root cause

`web/styles/main.css` (source of `out.min.css`) sets the app's background like this:

```css
/* web/styles/main.css line 20-30 */
body #view{
	display:block;
	position:fixed;
	top:0; left:0; right:0; bottom:0;
	background-color:var(--vscode-editor-background);
	overflow-x:hidden;
	overflow-y:auto;
}
```

But **nowhere in `web/styles/*.css` is a base text `color` ever set on `body` or
`#view`.** Confirmed by grepping every `color:`/`background-color:` declaration in
`main.css` — foreground vars (`--vscode-editor-foreground`, `--vscode-menu-foreground`,
etc.) are only applied to specific decorated elements (git-decoration labels, links,
menu items, table headers), never as a general base text color.

This is because in a **real VSCode webview**, VSCode itself injects a base
stylesheet into every webview (outside of the extension's own CSS) that sets
something equivalent to:

```css
body {
	color: var(--vscode-editor-foreground);
	font-family: var(--vscode-font-family);
	font-size: var(--vscode-font-size);
}
```

`out.min.css` was written assuming that host-provided base rule always exists — it
only ever *overrides* specific pieces on top of it. Our Electron `index.html` never
replicated that VSCode-webview-host base stylesheet.

**Before** the `--vscode-*` variable fix: `--vscode-editor-background` was undefined
→ `background-color: var(--vscode-editor-background)` fell back to `transparent` →
the page showed through to the browser's default white background, and text (default
browser black) was readable *by accident* (black-on-white).

**After** the fix: `--vscode-editor-background` now resolves to `#1e1e1e` (dark) →
`#view`'s background is correctly dark → but text color was **never** explicitly set
anywhere by us or by `out.min.css`, so it's still whatever the browser default /
inherited value is (effectively black) → dark-on-dark.

## What was already tried (current state of `electron/index.html`)

A `<style>` block was added inside `<head>` defining a static dark-theme value for
every `--vscode-*` custom property referenced across `web/styles/*.css` (see full
list below), plus a hand-styled `#addRepoBtn`. It does **not** set a base `color`
on `body`/`#view`, which is the missing piece causing this specific regression.

Current relevant excerpt of `electron/index.html`:

```html
<style>
	body{
		--git-graph-color0:#0085d9; --git-graph-color1:#d9008f; --git-graph-color2:#00d90a; --git-graph-color3:#d98500; --git-graph-color4:#a300d9; --git-graph-color5:#ff0000; --git-graph-color6:#00d9cc; --git-graph-color7:#e138e8; --git-graph-color8:#85d900; --git-graph-color9:#dc5b23; --git-graph-color10:#6f24d6; --git-graph-color11:#ffcc00;

		--vscode-font-family: -apple-system, BlinkMacSystemFont, "Segoe WPC", "Segoe UI", sans-serif;
		--vscode-editor-background: #1e1e1e;
		--vscode-editor-foreground: #d4d4d4;
		--vscode-editorWidget-background: #252526;
		--vscode-editorSuggestWidget-foreground: #d4d4d4;
		--vscode-selection-background: #264f78;
		--vscode-scrollbar-shadow: #000000;
		--vscode-widget-shadow: rgba(0,0,0,0.36);
		--vscode-focusBorder: #007fd4;
		--vscode-textLink-foreground: #3794ff;
		--vscode-textLink-activeForeground: #3794ff;
		--vscode-menu-background: #3c3c3c;
		--vscode-menu-foreground: #cccccc;
		--vscode-menu-border: rgba(128,128,128,0.35);
		--vscode-menu-separatorBackground: #606060;
		--vscode-menu-selectionBackground: #04395e;
		--vscode-menu-selectionForeground: #ffffff;
		--vscode-menu-selectionBorder: transparent;
		--vscode-input-background: #3c3c3c;
		--vscode-input-foreground: #cccccc;
		--vscode-input-placeholderForeground: #a6a6a6;
		--vscode-inputOption-activeBorder: #007acc;
		--vscode-inputOption-activeBackground: rgba(0,127,212,0.4);
		--vscode-inputValidation-errorBorder: #be1100;
		--vscode-inputValidation-errorBackground: #5a1d1d;
		--vscode-editor-findMatchHighlightBorder: #ea5c00aa;
		--vscode-gitDecoration-modifiedResourceForeground: #e2c08d;
		--vscode-gitDecoration-addedResourceForeground: #81b88b;
		--vscode-gitDecoration-deletedResourceForeground: #c74e39;
	}
	[data-color="0"]{--git-graph-color:var(--git-graph-color0);} /* ...same pattern through 11... */
	#addRepoBtn{
		position:absolute; left:8px; top:50%; transform:translateY(-50%);
		height:22px; padding:0 10px; line-height:22px; font-size:12px;
		background:var(--vscode-input-background); color:var(--vscode-input-foreground);
		border:1px solid var(--vscode-menu-border); border-radius:3px; cursor:pointer;
	}
	#addRepoBtn:hover{ background:var(--vscode-menu-selectionBackground); color:var(--vscode-menu-selectionForeground); }
	#controls{ padding-left:110px; }
</style>
```

Also note: this is a **static, hardcoded dark palette** — there is no light/dark
theme switching in the standalone app (unlike VSCode, which pushes live theme
variables). That's an open design question, not just a bug: does this app need a
theme toggle, or is a single fixed dark theme acceptable for v1?

## Full inventory of `--vscode-*` variables referenced in `web/styles/*.css`

(grepped directly from the source stylesheets that get compiled into
`media/out.min.css` — this is the complete surface that must be styled/verified)

```
web/styles/settingsWidget.css:10  --vscode-editorWidget-background
web/styles/settingsWidget.css:11  --vscode-widget-shadow
web/styles/settingsWidget.css:14  --vscode-editorSuggestWidget-foreground
web/styles/settingsWidget.css:15  --vscode-editorSuggestWidget-foreground
web/styles/settingsWidget.css:71  --vscode-editorSuggestWidget-foreground
web/styles/settingsWidget.css:186 --vscode-editorSuggestWidget-foreground

web/styles/dropdown.css:40   --vscode-editor-foreground
web/styles/dropdown.css:43   --vscode-editor-foreground
web/styles/dropdown.css:50   --vscode-menu-background
web/styles/dropdown.css:51   --vscode-menu-foreground
web/styles/dropdown.css:83   --vscode-menu-selectionBackground / --vscode-menu-background
web/styles/dropdown.css:84   --vscode-menu-selectionForeground / --vscode-menu-foreground
web/styles/dropdown.css:87   --vscode-menu-selectionBorder
web/styles/dropdown.css:102  --vscode-menu-foreground
web/styles/dropdown.css:114  --vscode-menu-foreground
web/styles/dropdown.css:119  --vscode-menu-selectionForeground / --vscode-menu-foreground
web/styles/dropdown.css:146  --vscode-menu-foreground

web/styles/contextMenu.css:4   --vscode-menu-background
web/styles/contextMenu.css:5   --vscode-widget-shadow
web/styles/contextMenu.css:6   --vscode-menu-foreground
web/styles/contextMenu.css:15  --vscode-menu-border
web/styles/contextMenu.css:30  --vscode-menu-selectionBackground / --vscode-menu-background
web/styles/contextMenu.css:31  --vscode-menu-selectionForeground / --vscode-menu-foreground
web/styles/contextMenu.css:34  --vscode-menu-selectionBorder
web/styles/contextMenu.css:40  --vscode-menu-separatorBackground
web/styles/contextMenu.css:61  --vscode-menu-foreground
web/styles/contextMenu.css:66  --vscode-menu-selectionForeground

web/styles/findWidget.css:9   --vscode-editorWidget-background
web/styles/findWidget.css:10  --vscode-widget-shadow
web/styles/findWidget.css:13  --vscode-editorSuggestWidget-foreground
web/styles/findWidget.css:14  --vscode-editorSuggestWidget-foreground
web/styles/findWidget.css:25  --vscode-inputValidation-errorBorder
web/styles/findWidget.css:37  --vscode-inputValidation-errorBackground
web/styles/findWidget.css:50  --vscode-input-background
web/styles/findWidget.css:51  --vscode-input-foreground
web/styles/findWidget.css:56  --vscode-focusBorder
web/styles/findWidget.css:59  --vscode-input-placeholderForeground
web/styles/findWidget.css:74  --vscode-input-foreground
web/styles/findWidget.css:78  --vscode-inputOption-activeBorder
web/styles/findWidget.css:80  --vscode-inputOption-activeBackground
web/styles/findWidget.css:132 --vscode-editor-findMatchHighlightBorder

web/styles/main.css:27   --vscode-editor-background   (on body #view — see root cause above)
web/styles/main.css:36   --vscode-selection-background
web/styles/main.css:39   --vscode-selection-background
web/styles/main.css:78   --vscode-scrollbar-shadow
web/styles/main.css:97   --vscode-editor-background
web/styles/main.css:101  --vscode-editor-background
web/styles/main.css:112  --vscode-editor-background
web/styles/main.css:140  --vscode-menu-background
web/styles/main.css:144  --vscode-menu-foreground
web/styles/main.css:155  --vscode-widget-shadow
web/styles/main.css:376  --vscode-editor-foreground
web/styles/main.css:504  --vscode-editor-foreground
web/styles/main.css:577  --vscode-editor-foreground
web/styles/main.css:599  --vscode-gitDecoration-modifiedResourceForeground
web/styles/main.css:602  --vscode-gitDecoration-addedResourceForeground
web/styles/main.css:605  --vscode-gitDecoration-deletedResourceForeground
web/styles/main.css:621  --vscode-gitDecoration-addedResourceForeground
web/styles/main.css:624  --vscode-gitDecoration-deletedResourceForeground
web/styles/main.css:667  --vscode-editor-findMatchHighlightBorder
web/styles/main.css:718  --vscode-editor-background
web/styles/main.css:761  --vscode-editor-foreground
web/styles/main.css:846  --vscode-editor-foreground
web/styles/main.css:848  --vscode-editor-foreground
web/styles/main.css:934  --vscode-textLink-foreground
web/styles/main.css:939  --vscode-textLink-activeForeground
web/styles/main.css:942  --vscode-focusBorder
web/styles/main.css:991  --vscode-editor-foreground
web/styles/main.css:1013 --vscode-editor-foreground (used as a BACKGROUND color, line 1013 — worth double-checking in context, looked unusual during the original audit)

web/styles/dialog.css:4    --vscode-menu-background
web/styles/dialog.css:5    --vscode-menu-foreground
web/styles/dialog.css:14   --vscode-widget-shadow
web/styles/dialog.css:17   --vscode-menu-border
web/styles/dialog.css:80,83,94,103,154,215,233,243,302  --vscode-menu-foreground
web/styles/dialog.css:95   --vscode-font-family
web/styles/dialog.css:100,237  --vscode-focusBorder
web/styles/dialog.css:251  --vscode-menu-background
web/styles/dialog.css:278  --vscode-menu-selectionBackground
web/styles/dialog.css:279,306  --vscode-menu-selectionForeground / --vscode-menu-foreground
web/styles/dialog.css:282  --vscode-menu-selectionBorder
```

Notably **absent** from this list anywhere as a base/body-level foreground color —
confirming the root cause: nothing in `out.min.css` sets a default text color, it's
always assumed to come from the VSCode webview host's own base stylesheet.

## What "claude design" should do

1. Add a base foreground rule to `electron/index.html`'s `<style>` block, e.g.:
   ```css
   body, #view { color: var(--vscode-editor-foreground); font-family: var(--vscode-font-family); }
   ```
   (exact selector/scope needs verification against the live app — `#view` already
   gets the background-color rule from `main.css:27`, so mirroring the foreground
   color on the same selector is the natural fix, but confirm nothing downstream
   double-overrides it unexpectedly.)
2. Review the full dark-theme variable palette above for contrast/correctness (I
   picked standard VS Code "Dark+" defaults from memory, not verified pixel-by-pixel
   against a running instance).
3. Verify every element category renders legibly: main commit graph/table, repo &
   branch dropdowns, right-click context menu, dialogs (add tag, create branch,
   etc.), settings widget, find widget, the new `#addRepoBtn`.
4. Decide/confirm: single fixed dark theme is acceptable, or should this read the
   OS-level light/dark preference (`prefers-color-scheme`) and swap two palettes?

## How to run and verify

```
cd D:\Development_Projects\vscode-git-graph\electron
npm run start
```
This runs `tsc` then launches Electron loading `electron/index.html` directly (dev
mode, requires the sibling `../media/out.min.css`/`out.min.js` already built at the
repo root via `npm run compile-web` from the repo root — already built, no rebuild
needed unless `web/*.ts` changes).

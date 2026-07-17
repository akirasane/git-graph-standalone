---
name: Terminal Velocity
colors:
  surface: '#131313'
  surface-dim: '#131313'
  surface-bright: '#393939'
  surface-container-lowest: '#0e0e0e'
  surface-container-low: '#1b1b1c'
  surface-container: '#202020'
  surface-container-high: '#2a2a2a'
  surface-container-highest: '#353535'
  on-surface: '#e5e2e1'
  on-surface-variant: '#c0c7d3'
  inverse-surface: '#e5e2e1'
  inverse-on-surface: '#303030'
  outline: '#8a919d'
  outline-variant: '#404752'
  surface-tint: '#9fcaff'
  primary: '#9fcaff'
  on-primary: '#003258'
  primary-container: '#3495eb'
  on-primary-container: '#002b4d'
  inverse-primary: '#0061a4'
  secondary: '#a6c8ff'
  on-secondary: '#003060'
  secondary-container: '#3391fc'
  on-secondary-container: '#002a54'
  tertiary: '#ffb784'
  on-tertiary: '#4f2500'
  tertiary-container: '#db761e'
  on-tertiary-container: '#451f00'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#d1e4ff'
  primary-fixed-dim: '#9fcaff'
  on-primary-fixed: '#001d36'
  on-primary-fixed-variant: '#00497d'
  secondary-fixed: '#d5e3ff'
  secondary-fixed-dim: '#a6c8ff'
  on-secondary-fixed: '#001c3b'
  on-secondary-fixed-variant: '#004787'
  tertiary-fixed: '#ffdcc6'
  tertiary-fixed-dim: '#ffb784'
  on-tertiary-fixed: '#301400'
  on-tertiary-fixed-variant: '#713700'
  background: '#131313'
  on-background: '#e5e2e1'
  surface-variant: '#353535'
typography:
  headline-lg:
    fontFamily: -apple-system, BlinkMacSystemFont, 'Segoe WPC', 'Segoe UI', sans-serif
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 36px
  headline-md:
    fontFamily: -apple-system, BlinkMacSystemFont, 'Segoe WPC', 'Segoe UI', sans-serif
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-md:
    fontFamily: -apple-system, BlinkMacSystemFont, 'Segoe WPC', 'Segoe UI', sans-serif
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: -apple-system, BlinkMacSystemFont, 'Segoe WPC', 'Segoe UI', sans-serif
    fontSize: 11px
    fontWeight: '400'
    lineHeight: 16px
  code-md:
    fontFamily: jetbrainsMono
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 20px
  label-caps:
    fontFamily: -apple-system, BlinkMacSystemFont, 'Segoe WPC', 'Segoe UI', sans-serif
    fontSize: 11px
    fontWeight: '700'
    lineHeight: 16px
    letterSpacing: 0.05em
spacing:
  unit: 4px
  gutter: 12px
  margin-page: 16px
  panel-padding: 8px
---

## Brand & Style

This design system is built for power users, developers, and engineers who require a high-density, low-friction interface for visualizing complex version histories. The brand personality is **utilitarian, precise, and systematic**, echoing the aesthetic of modern integrated development environments.

The design style is **Corporate Modern with an Emphasis on Precision**. It leverages a dark-mode-first approach to reduce eye strain during long sessions, utilizing crisp borders and high-contrast logic to define structural boundaries rather than soft shadows. The emotional response should be one of competence and control, where every pixel serves a functional purpose.

## Colors

The palette is derived directly from the Dark+ environment to ensure seamless integration for developers. 

- **Backgrounds:** Use `#1e1e1e` for the primary canvas. Layered elements like sidebars or panels use `#252526` to provide subtle depth.
- **Accents:** `#007fd4` is reserved for focus states and primary actions. `#3794ff` is used for interactive text and links to ensure high legibility against the dark background.
- **Inputs:** The background for form elements is `#3c3c3c`, providing a clear visual "recess" from the primary surface.

## Typography

The system utilizes a native stack to ensure the UI feels like a part of the operating system. For the Git Graph visualization specifically, **JetBrains Mono** or a similar monospaced font is used for commit hashes and branch names to maintain alignment.

Typography is optimized for **high information density**. Most body text is set at 13px, allowing for maximum data visibility without sacrificing legibility. Headers are kept modest in size to preserve vertical space.

## Layout & Spacing

This design system uses a **fluid layout model** optimized for multi-pane interfaces. 

- **Grid:** A 4px baseline grid governs all internal spacing.
- **Panels:** The layout is divided into collapsible panels. Gutters between panels should be 1px to 2px, filled with a subtle border color (`#333333`) rather than wide gaps.
- **Density:** Padding within list items and graph nodes is tight (4px to 8px) to accommodate long git histories.
- **Responsive:** On mobile, sidebars collapse into a drawer, and the graph expands to fill the viewport width, prioritizing the horizontal space needed for branch visualization.

## Elevation & Depth

In this system, depth is communicated through **Tonal Layering** and **Borders** rather than shadows.

- **Level 0 (Base):** `#1e1e1e` (Main editor/graph area).
- **Level 1 (Panels):** `#252526` (Sidebars, status bars).
- **Level 2 (Popovers/Menus):** `#3c3c3c` (Context menus, tooltips).
- **Focus State:** Interactive elements receive a 1px solid border of `#007fd4` when focused. 

Avoid using blurs or shadows. Distinction between surfaces is achieved purely through color shifts and 1px lines.

## Shapes

The shape language is **Sharp and Architectural**. 

All buttons, inputs, and panels use 0px border-radius to align with the technical nature of a developer tool. The only exception is the Git Graph nodes (the "dots" on the lines), which remain circular to distinguish them from the UI layout elements.

## Components

### Buttons
- **Primary:** Background `#007fd4`, foreground `#ffffff`, no radius.
- **Secondary:** Background `#3c3c3c`, foreground `#cccccc`. Hover state lightens background by 10%.

### Input Fields
- **Default:** Background `#3c3c3c`, border 1px transparent. 
- **Focus:** Border 1px solid `#007fd4`.
- **Text:** 13px, color `#d4d4d4`.

### Chips / Tags
- Used for branch names and tags. Use a subtle background (`#2a2d2e`) with a 1px border. Branch labels in the graph should use high-contrast text against a background color that matches the branch line color.

### Lists (Commit History)
- 24px - 28px row height. Alternating row colors are discouraged; use a subtle hover state (`#2a2d2e`) to indicate selection.

### Cards
- Cards are not used. Information is organized into **Panels** with header bars to maximize screen real estate for the graph data.
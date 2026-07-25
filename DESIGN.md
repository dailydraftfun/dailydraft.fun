---
version: "alpha"
name: dailydraft Design System
description: "Premium dark gacha arena with deep charcoal surfaces, crisp card values, and a high-contrast lime action for Pack Duel."

colors:
  primary: "#fafafa"
  bg-primary: "#070807"
  bg-secondary: "#0d100f"
  bg-tertiary: "#131714"
  bg-elevated: "#191e1b"
  bg-hover: "#202721"
  text-primary: "#f6f8f3"
  text-secondary: "#b7c0b6"
  text-muted: "#909a90"
  accent: "#b8ff5a"
  accent-hover: "#c9ff82"
  accent-foreground: "#10150d"
  success: "#48e08a"
  warning: "#f7c948"
  danger: "#ff6464"
  agent: "#62d8ff"
  done: "#a78bfa"

typography:
  sans:
    fontFamily: "DM Sans"
  mono:
    fontFamily: "JetBrains Mono"

rounded:
  sm: 4px
  md: 6px
  lg: 10px
  xl: 16px

spacing:
  base: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px

components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-foreground}"
    rounded: "{rounded.md}"
    padding: 8px 16px
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
    textColor: "{colors.accent-foreground}"
    rounded: "{rounded.md}"
    padding: 8px 16px
  button-ghost:
    backgroundColor: transparent
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: 8px 16px
  button-ghost-hover:
    backgroundColor: "{colors.bg-hover}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: 8px 16px
  card:
    backgroundColor: "{colors.bg-elevated}"
    rounded: "{rounded.lg}"
    padding: 16px
  input:
    backgroundColor: "{colors.bg-secondary}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: 8px 12px
  nav:
    backgroundColor: "{colors.bg-tertiary}"
    textColor: "{colors.text-secondary}"
    padding: 8px 16px
  badge-success:
    backgroundColor: "{colors.success}"
    textColor: "{colors.bg-primary}"
    rounded: "{rounded.sm}"
    padding: 2px 8px
  badge-warning:
    backgroundColor: "{colors.warning}"
    textColor: "{colors.bg-primary}"
    rounded: "{rounded.sm}"
    padding: 2px 8px
  badge-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.bg-primary}"
    rounded: "{rounded.sm}"
    padding: 2px 8px
  badge-agent:
    backgroundColor: "{colors.agent}"
    textColor: "{colors.bg-primary}"
    rounded: "{rounded.sm}"
    padding: 2px 8px
  badge-done:
    backgroundColor: "{colors.done}"
    textColor: "{colors.bg-primary}"
    rounded: "{rounded.sm}"
    padding: 2px 8px
  tooltip:
    backgroundColor: "{colors.bg-hover}"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.md}"
    padding: 4px 8px
  link:
    textColor: "{colors.primary}"
  link-hover:
    textColor: "{colors.accent-hover}"
---

## Overview

Pack Duel uses a dark premium gacha arena: deep charcoal surfaces, crisp white typography, compact on-chain proof, and lime actions.

Design reference: https://styles.refero.design/style/90ce5883-bb24-4466-93f7-801cd617b0d1

## Colors

The palette uses layered dark surfaces for visual hierarchy instead of shadows or outlines.

**Surface layers (darkest to lightest):**
- **bg-primary (#070807)** — page background
- **bg-secondary (#0d100f)** — sidebar, nav panels
- **bg-tertiary (#131714)** — grouped content areas
- **bg-elevated (#191e1b)** — cards, floating panels
- **bg-hover (#202721)** — interactive hover state

**Text scale:**
- **text-primary (#f6f8f3)** — headings, important content
- **text-secondary (#b7c0b6)** — body text, descriptions
- **text-muted (#909a90)** — labels, placeholders, timestamps

**Borders** (not in YAML — these use rgba for transparency):
- **border:** rgba(255, 255, 255, 0.10) — subtle dividers
- **border-strong:** rgba(255, 255, 255, 0.18) — emphasized dividers

**Semantic colors:**
- **accent (#b8ff5a)** — primary actions, CTA buttons
- **success (#48e08a)** — positive states, confirmations
- **warning (#f7c948)** — caution, pending states
- **danger (#ff6464)** — errors, destructive actions
- **agent (#62d8ff)** — AI/agent activity indicators
- **done (#a78bfa)** — completed states

## Typography

Two typefaces cover all use cases:

- **DM Sans** — all UI text: headings, body, labels, buttons.
- **JetBrains Mono** — code blocks, terminal output, technical strings, monospaced data.

System fonts are fallbacks only, never used as primary typeface.

| Token | Size | Usage |
|-------|------|-------|
| metadata | 11px minimum | Compact nonessential labels only |
| body-small | 12px minimum | Meaning-bearing labels and supporting copy |
| body | 16px | Default prose and controls |
| title | Responsive clamp | Page and section hierarchy |

DM Sans weights 400, 500, 600, and 700 are loaded explicitly. Weight 800 is
not used, and all surfaces disable synthetic font styles.

## Layout

Built on a **4px base unit**. All spacing values are multiples of this base:

| Token | Value | Usage |
|-------|-------|-------|
| base | 4px | Tight gaps: icon-to-text, inline elements |
| sm | 8px | Element padding, list item gaps |
| md | 16px | Card padding, section gaps |
| lg | 24px | Section separators, major groupings |
| xl | 32px | Page-level margins, hero spacing |

Body background uses a subtle radial gradient overlay: `radial-gradient(circle at top, rgba(255, 255, 255, 0.04), transparent 40rem)` for depth.

## Elevation & Depth

Depth comes from **background color layering**, not box-shadows. Five surface layers (bg-primary → bg-hover) create visual hierarchy.

Shadows are reserved for floating elements only:
- **Tooltips, dropdowns:** `rgba(0, 0, 0, 0.4) 0px 2px 4px`
- **Modals, sheets:** `rgba(0, 0, 0, 0.6) 0px 4px 12px`

## Shapes

Consistent corner radius scale:

| Token | Value | Usage |
|-------|-------|-------|
| sm | 4px | Tags, badges, small pills |
| md | 6px | Buttons, inputs, selects (default) |
| lg | 10px | Cards, panels, containers |
| xl | 16px | Dialogs, sheets, modals |

## Components

**Button (primary):** Accent background (#b8ff5a) with dark text (#10150d). 6px radius, 8px/16px padding. Hover shifts to #c9ff82.

**Button (ghost):** Transparent background, white text. Same radius and padding. Hover shows bg-hover layer.

**Card:** bg-elevated background (#191e1b). 10px radius, 16px padding. No border by default; optional rgba(255, 255, 255, 0.10) border for emphasis.

**Input:** bg-secondary background (#0d100f). 6px radius, 8px/12px padding. Border on focus: rgba(255, 255, 255, 0.18).

## Do's and Don'ts

**Do:**
- Use `bg-*` utility classes, not raw hex values
- Pair DM Sans with JetBrains Mono for code
- Use the 5-layer surface hierarchy for depth
- Use semantic colors (success/warning/danger) for status

**Don't:**
- Use light/white backgrounds — this is a dark-only system
- Invent colors outside the defined palette
- Use border-radius values larger than xl (16px)
- Use box-shadow for layout hierarchy — use bg layers instead
- Mix system fonts into primary text positions

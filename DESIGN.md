---
name: Orbi
description: Adaptive Soft UI — one component system, three lighting worlds (Dark, Light, Terminal).
colors:
  orbit-lime: "#bce64a"
  orbit-lime-ink: "#4a6a2a"
  lime-text-on-accent: "#1e2718"
  phosphor-green: "#58f28b"
  phosphor-ink: "#041008"
  ghost-violet: "#b499cf"
  ghost-violet-light: "#9b7bb6"
  node-image-blue: "#5f9fd0"
  node-video-teal: "#4fbf9a"
  node-text-plum: "#9a7db0"
  node-audio-amber: "#e08a4b"
  dark-desk: "#121416"
  dark-desk-deep: "#0b0d0f"
  dark-surface: "#202326"
  dark-text: "#f0f2ef"
  dark-muted: "#a2aaa5"
  dark-faint: "#8a938e"
  light-desk: "#e8eeea"
  light-desk-deep: "#dfe7e2"
  light-surface: "#edf2ef"
  light-text: "#27332c"
  light-muted: "#525e57"
  light-faint: "#58645d"
  terminal-desk: "#060908"
  terminal-desk-deep: "#020403"
  terminal-surface: "#0d1812"
  terminal-text: "#dff8e8"
  terminal-muted: "#82b995"
  terminal-faint: "#5f8b70"
typography:
  display:
    fontFamily: "Manrope, sans-serif"
    fontSize: "30px"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Manrope, sans-serif"
    fontSize: "22px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Manrope, sans-serif"
    fontSize: "15px"
    fontWeight: 700
    lineHeight: 1.3
  body:
    fontFamily: "DM Sans, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.55
  body-small:
    fontFamily: "DM Sans, sans-serif"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "DM Sans, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.3
  micro:
    fontFamily: "DM Sans, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.3
  terminal:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  xs: "6px"
  sm: "8px"
  md: "12px"
  lg: "14px"
  xl: "18px"
  pill: "999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  "8": "32px"
  "10": "40px"
components:
  button-primary:
    backgroundColor: "{colors.orbit-lime}"
    textColor: "{colors.lime-text-on-accent}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "8px 14px"
    height: "34px"
  button-soft:
    backgroundColor: "{colors.dark-surface}"
    textColor: "{colors.dark-text}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
    height: "34px"
  chip:
    backgroundColor: "{colors.dark-surface}"
    textColor: "{colors.dark-muted}"
    typography: "{typography.micro}"
    rounded: "{rounded.pill}"
    padding: "4px 10px"
  input:
    backgroundColor: "{colors.dark-desk-deep}"
    textColor: "{colors.dark-text}"
    typography: "{typography.body-small}"
    rounded: "{rounded.sm}"
    padding: "9px 10px"
  card:
    backgroundColor: "{colors.dark-surface}"
    textColor: "{colors.dark-text}"
    rounded: "{rounded.lg}"
    padding: "16px"
  tab-active:
    backgroundColor: "{colors.dark-surface}"
    textColor: "{colors.dark-text}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "8px 14px"
---

# Design System: Orbi

## Overview

**Creative North Star: "The Studio Desk"**

Orbi is a professional's desk where every tool is within reach: chat, images, video, voice, workflows, agents and a terminal laid out on one surface. The desk is soft and tactile — controls feel like they rise out of the surface they sit on — and the user's work is always the brightest thing on it. Ornament stays quiet until something is active; then it is bold: the active tab glows, the message box ring circles and breathes, a running node pulses with its own color.

The language is **Adaptive Soft UI**: the same components, sizes, spacing and interaction hierarchy in every theme, with three lighting worlds that change only tokens (color, shadow, border, font and effects):

- **Orbi Dark — Premium Dark Soft UI.** Deep graphite desk, soft lifted surfaces, faint ambient light, Orbit Lime for action.
- **Orbi Light — Soft Neumorphic UI.** Pale sage desk; controls extruded with paired light and dark shadows, pressed controls inset.
- **Orbi Terminal — Cyberpunk Terminal UI.** Near-black desk, phosphor-green text and thin neon borders, monospace everywhere.

Neumorphism is a material here, not a rule: it never costs contrast or makes a clickable thing look like decoration. Every control keeps a visible border or label in addition to its relief.

**Key Characteristics:**
- One component system, three themes; switching theme never moves anything.
- Soft relief at rest, bold light on state (active, focus, running, success).
- Orbit Lime is the single action color; node hues label media types only.
- Rounded, friendly geometry (8–18px), pills for chips and tags.
- Manrope for headings, DM Sans for everything else, monospace only in Terminal and code.

## Colors

A calm desk of near-neutrals with one confident lime for action and a small family of media hues.

### Primary
- **Orbit Lime** (#bce64a): primary buttons, the active rail item, selected states, progress, the Orbi mark. On light backgrounds lime text becomes **Orbit Lime Ink** (#4a6a2a) so it stays readable. Text on a lime fill uses **Lime Text** (#1e2718).
- **Phosphor Green** (#58f28b): Terminal's accent, replacing Orbit Lime one-to-one; text on it is #041008.

### Secondary
- **Ghost Violet** (#b499cf dark, #9b7bb6 light): temporary chat and anything that will not be kept — the ghost icon, the temporary composer.

### Tertiary — media hues
- **Image Blue** (#5f9fd0), **Video Teal** (#4fbf9a), **Text Plum** (#9a7db0), **Audio Amber** (#e08a4b): workflow node headers, ports, wires and kind chips. They label what a thing *is*, never what to *do*.

### Neutral
- **Desk** (dark #121416 · light #e8eeea · terminal #060908): the app background.
- **Desk Deep** (dark #0b0d0f · light #dfe7e2 · terminal #020403): inset wells — text areas, canvas stage, inputs.
- **Surface** (dark #202326 · light #edf2ef · terminal #0d1812): panels, cards, popovers, nodes.
- **Text** (dark #f0f2ef · light #27332c · terminal #dff8e8), **Muted** (dark #a2aaa5 · light #525e57 · terminal #82b995), **Faint** (dark #8a938e · light #58645d · terminal #5f8b70): primary text, secondary text, placeholders and hints. All pass WCAG AA on their desk.

### Named Rules
**The One Action Color Rule.** Only Orbit Lime (Phosphor Green in Terminal) means "do this". Media hues never fill a primary button.

**The Token-Only Rule.** Colors come from `--neo-*` tokens; a hardcoded gray is a bug because it breaks one of the three themes.

## Typography

**Display Font:** Manrope (with sans-serif)
**Body Font:** DM Sans (with sans-serif)
**Label/Mono Font:** ui-monospace stack — Terminal theme and code only

**Character:** Manrope's geometric, slightly rounded headings match the soft desk; DM Sans keeps dense tool UI calm and legible.

### Hierarchy
- **Display** (700, 30px, 1.15): the greeting and empty-state headlines.
- **Headline** (700, 22px, 1.2): page titles — Creative, Creator Studio, Explore, Launchpad.
- **Title** (700, 15px, 1.3): section and panel heads, card titles.
- **Body** (400, 14px, 1.55): chat messages and descriptions; messages cap at 760px.
- **Body small** (400, 12.5px, 1.5): hints, helper text, card descriptions.
- **Label** (600, 12px): buttons, tabs, field labels.
- **Micro** (600, 11px): badges, counts, port labels, meta rows.

### Named Rules
**The 11/12 Floor Rule.** No UI text below 11px; no sentence below 12px.

**The Terminal Voice Rule.** In Terminal every face becomes the monospace stack; sizes and weights stay the same.

## Layout

A three-zone desk: the **tool rail** (56px) on the left, an optional **workspace panel** (≈300px) and the **main stage**. Creative and Creator Studio pages use a **top bar** (54px) with page tabs, then a three-column work area: **control column** (300px) · **stage** (fluid) · **library column** (300px). Spacing follows a 4px base (4, 8, 12, 16, 20, 24, 32, 40): 8px inside a control group, 12–16px between controls, 20–24px between sections. Below 860px side columns stack above or below the stage.

**The Same Grid Rule.** Every Creative tab uses the same top bar height, column widths and section rhythm, so switching tabs never shifts the frame.

## Elevation & Depth

Hybrid soft relief. Surfaces rise with paired shadows — a dark shadow down-right and a light highlight up-left — strongest in Light, softer in Dark, replaced by thin neon borders in Terminal. Pressed and input wells sit inset. State adds light, not height.

### Shadow Vocabulary
- **Raised** (`3px 3px 8px var(--neo-shadow-dark), -3px -3px 8px var(--neo-shadow-light)`): buttons, chips, tabs at rest.
- **Lifted** (`8px 8px 18px var(--neo-shadow-dark), -6px -6px 16px var(--neo-shadow-light)`): panels, popovers, the composer.
- **Inset** (`inset 2px 2px 5px var(--neo-inset-dark), inset -2px -2px 5px var(--neo-shadow-light)`): inputs, pressed toggles, the active segment.
- **Active glow** (`0 0 0 1px color-mix(accent 55%), 0 6px 18px color-mix(accent 28%)`): the selected tab, primary action, running node.

### Named Rules
**The Light-On-State Rule.** At rest things are soft; when active, focused or running they glow in their color. Never glow something that is idle (the composer's breathing ring is the one invitation).

## Shapes

Friendly rounded geometry: 6px for small inner chips, 8px for inputs, 12px for buttons and tabs, 14px for cards and nodes, 18px for the composer and large panels; pills (999px) for tags and filters. Borders are 1px hairlines; no side stripes thicker than 1px.

## Components

### Buttons
- **Shape:** gently rounded (12px), 34px tall.
- **Primary:** Orbit Lime fill, Lime Text, label type, active glow on hover.
- **Soft:** surface fill with raised shadow; hover lifts the border toward lime; pressed goes inset.
- **Icon:** 32–36px square soft button; the ghost and theme switcher live here.

### Chips
- **Style:** pill, surface fill, hairline border, micro type.
- **State:** selected chips fill with Orbit Lime at 18% and lime border; media chips use their hue at 18%.

### Cards / Containers
- **Corner Style:** 14px.
- **Background:** Surface.
- **Shadow Strategy:** Raised at rest, Lifted on hover for clickable cards.
- **Border:** 1px `--neo-line`.
- **Internal Padding:** 16px.

### Inputs / Fields
- **Style:** Desk Deep well, inset shadow, 8px radius, 1px line.
- **Focus:** border to Orbit Lime at 60% plus a soft lime ring; placeholders use Faint.

### Navigation
- **Tool rail:** icon buttons; the active one gets Orbit Lime and the orbiting satellite dot.
- **Page tabs:** label type, 12px radius; active tab = surface + active glow + lime icon; inactive tabs are plain text that gains a surface on hover.

### Composer (signature)
Lifted 18px panel with the rainbow ring: colors circle the box and the ring breathes while idle, holds steady while typing, static with reduced motion. In temporary chat the ring and send button turn Ghost Violet.

### Workflow node (signature)
14px surface card; header tinted with the node's media hue at 10%; colored ports and wires by type; a running node glows in its hue and its wires flow.

## Do's and Don'ts

### Do:
- **Do** build every new screen from the `--neo-*` tokens so it works in Dark, Light and Terminal at once.
- **Do** make active, selected and running states bold: lime (or the media hue) plus the active glow.
- **Do** keep text at 11px minimum and sentences at 12px; check contrast in all three themes.
- **Do** keep the Draft Creative / Daniel Rodrigues signature where the brand requires it (About, exports).

### Don't:
- **Don't** hardcode grays or hex text colors in components.
- **Don't** use a colored side stripe thicker than 1px, an icon tile above a heading, or gradient text.
- **Don't** let neumorphic relief be the only sign that something is clickable.
- **Don't** change layout, sizes or positions between themes — only tokens change.

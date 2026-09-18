# Reckue Design System

A restrained, modern-minimalist design system for **Reckue**. Monochrome foundation — near-black ink and clean whites — with a single **sky-blue** accent used sparingly. Roboto throughout.

> **Sources provided:** brand notes + a logo mark (no codebase, Figma, or slide deck was attached). This system was authored from those notes:
> *Modern minimalism. Roboto-like type. Restrained palette — black & white with light notes of blue. Key color: a dark gray with a slight blue tint that reads as black but is never pure black. Reckue reads as sky-blue — build it in as the accent, carefully.*
> If you have brand fonts, product screens, or a Figma file, share them and this system will be updated to match.

---

## Company / product context

Reckue is treated as a modern software product with a calm, functional, professional interface. The visual language favors clarity over decoration: generous whitespace, hairline borders, quiet surfaces, and a single accent color reserved for the one action that matters on each screen. Nothing shouts. The near-black "ink" does the heavy lifting; blue is a guest, not the host.

Because no specific product surfaces were supplied, the UI kit demonstrates a generic Reckue web-app shell (workspace list, detail view, settings) built entirely from the primitives in this system. Swap in real screens when available.

---

## Content fundamentals

How Reckue copy is written:

- **Tone:** calm, plain, and precise. Say what the thing does, not how remarkable it is. No hype, no exclamation marks.
- **Voice / person:** address the user as **you**; refer to the product as **Reckue** or **we** sparingly. "You have 3 drafts." "We'll email you when it's ready."
- **Casing:** **Sentence case everywhere** — buttons, headings, labels, menu items. "Save changes", not "Save Changes". Only the wordmark and proper nouns are exceptions.
- **Length:** short. Button labels are 1–2 words ("Save", "New project"). Descriptions are one sentence. Empty states are one line plus one action.
- **Numbers & data:** set figures, counts, IDs, and code in Roboto Mono so they align and read as data.
- **Emoji:** not used. Meaning is carried by type, color, and iconography.
- **Examples:**
  - Button: `Save changes` · `Invite member` · `Delete` (destructive uses the plain verb)
  - Empty state: "No projects yet. Create your first to get started."
  - Toast: "Saved · Your changes are live."
  - Error: "That email is already in use."

---

## Visual foundations

**Color.** The palette is deliberately narrow. The core neutral is the **Ink** ramp — a cool gray scale with a faint blue undertone; `--ink-900` (#16181E) is the key brand color and reads as black without being pure black. A single **sky-blue** accent (`--sky-600` #1E7AD1) is used only for the primary action, focus, links, and selection; a brighter sky (`--sky-500` #3F9BEE, `--accent-bright`) carries accents on the dark ink surfaces (the wordmark dot, sidebar highlights). The `--blue-*` names remain as aliases of the sky ramp. Functional status colors (muted green/amber/red) appear only to convey meaning, never for decoration. Target **max one accent per view**.

**Type.** Roboto for everything; Roboto Mono for numbers, code, and data. Display and headings use **Roboto Medium (500)** with slightly tightened tracking; body is **Regular (400)** at 15px / 1.5. Weights in use: 300 / 400 / 500 / 700. No other typefaces.

**Spacing & layout.** 4px base grid (`--space-*`). Layouts are calm and gridded with generous gutters (24px default). Content max-width ~1200px. Fixed elements: a top app bar and a left sidebar in the app shell; content scrolls beneath.

**Pixel / "dots" motif.** The logo is built from staggered rounded blocks; that same shape is the one decorative accent — a few small rounded squares (`--radius-sm`, ~10–34px) scattered sparsely in a corner or staggered like the mark. Use it occasionally, never as a repeating pattern or texture: mostly quiet ink/neutral squares with one or two sky accents. It appears on the title and section slides; see the **Pixel motif** brand card.

**Backgrounds.** Flat and quiet. The page is a very light cool gray (`--surface-page` #F5F7F9); cards are white. **No gradients, no imagery, no textures, no patterns.** Depth comes from hairline borders and soft shadows, not color washes. The one bold surface is the inverse **ink** panel (dark) used for the sidebar or marketing hero.

**Borders.** Hairline **1px** borders in the ink neutrals (`--border-subtle` / `--border-default` / `--border-strong`) define structure. Borders — not shadows — are the primary separators.

**Shadows / elevation.** Subtle and **ink-tinted, never pure black** (`rgba(22,24,30,·)`). Five steps xs→xl, low spread. Cards rest at `--shadow-sm`; hover lifts to `--shadow-md`; dialogs use `--shadow-xl`.

**Corner radii.** Moderate and consistent: inputs/buttons `--radius-md` (8px), cards `--radius-lg` (12px), chips small (`--radius-sm` 5px), pills/avatars full. Nothing sharp-cornered, nothing overly rounded.

**Cards.** White fill, 1px `--border-subtle`, `--radius-lg`, `--shadow-sm`. Interactive cards lift to `--shadow-md` and darken the border slightly on hover. No colored left-border accents.

**Hover states.** Subtle background fills (`--surface-subtle`) for ghost/secondary controls; the primary button darkens to `--accent-hover`. Links darken. No large color jumps.

**Press states.** Handled via the darker hover/active accent; no scale-down/shrink animations. Keep it quiet.

**Focus.** A soft blue ring — `--focus-ring` (3px `--blue-100`) — plus a blue border. Always visible for keyboard users.

**Motion.** Minimal and quick. Durations 120–260ms; easing `--ease-standard` (cubic-bezier(0.2,0,0.1,1)) for most transitions, `--ease-out` for entrances. Fades and short slides only — **no bounces, no springy overshoot**. Dialogs fade in; toasts slide a few px.

**Transparency & blur.** Used only for the dialog scrim (`rgba(16,18,22,0.44)`). No frosted-glass/backdrop-blur surfaces by default.

**Imagery vibe.** None supplied. If added, keep it cool-toned, calm, and low-saturation to match the restraint of the palette; avoid warm or high-contrast photography.

---

## Iconography

- **Set:** No icon assets were provided. This system standardizes on **[Lucide](https://lucide.dev)** — clean, 1.5–2px stroke, rounded joins, outline style — which matches Reckue's minimal, functional tone. **This is a substitution; flag it and swap for Reckue's real icon set if one exists.**
- **Usage:** inline SVG at **16px** in dense UI, 20px for standalone. `stroke="currentColor"` so icons inherit text color; `fill="none"`. Default color is `--text-secondary`, `--text-primary` when active, `--accent` only when the icon marks the primary action.
- **Delivery:** load from CDN (`https://unpkg.com/lucide-static`) or paste individual SVG paths (as the cards/UI kit do). Do **not** hand-draw bespoke icons.
- **Emoji / unicode:** not used as icons anywhere. The one exception is small typographic glyphs already in the components (× for close/remove, ▾ for the select chevron, ✓-style checkmark drawn with borders).

---

## Components

Reusable React primitives (import from `window.ReckueDesignSystem_18ab0e` in cards; each has a `.d.ts` contract and `.prompt.md` usage note). Since no source defined an inventory, a standard set was authored.

**Core** (`components/core/`): `Button`, `IconButton`, `Card`, `Badge`, `Tag`, `Avatar`
**Forms** (`components/forms/`): `Input`, `Textarea`, `Select`, `Checkbox`, `Radio`, `Switch`
**Feedback** (`components/feedback/`): `Dialog`, `Toast`, `Banner`, `Tooltip`, `Spinner`, `ProgressBar`
**Navigation** (`components/navigation/`): `Tabs`, `Breadcrumb`

---

## UI kits

- `ui_kits/app/` — a generic Reckue web-app shell (workspace list → project detail → settings), interactive click-through, composed from the primitives above.

## Slides

- `slides/` — sample 16:9 slide layouts (title, section, content, big quote) using the brand foundations.

---

## Index / manifest (root)

- `styles.css` — the single entry point consumers link; `@import`s every token file.
- `tokens/` — `colors.css`, `typography.css`, `spacing.css`, `effects.css`, `fonts.css`.
- `components/{core,forms,feedback,navigation}/` — primitives (`.jsx` + `.d.ts` + `.prompt.md` + a `@dsCard` HTML per group).
- `guidelines/` — foundation specimen cards (Colors, Type, Spacing, Brand).
- `ui_kits/app/` — product UI kit.
- `slides/` — sample slides.
- `thumbnail.html` — homepage tile.
- `SKILL.md` — Agent-Skills wrapper.
- `assets/` — the Reckue logo mark: `logo.png` (black, transparent), `logo-white.png` (white, for dark surfaces), `logo-original.png` (as supplied). Pair with the wordmark `reckue.` (Roboto Medium, sky-blue period) for the full lockup.

---

## Caveats / substitutions

- **Logo:** provided by the user and extracted to transparent PNGs (`assets/logo*.png`). The wordmark `reckue.` (Roboto Medium, sky period) accompanies it.
- **Sky accent:** at the user's direction the accent is a deep, usable sky-blue (`--sky-600`), applied carefully — primary action, focus, links, selection, and the wordmark dot only.
- **Fonts:** Roboto & Roboto Mono are loaded from Google Fonts (the specified family). If Reckue has licensed brand fonts, provide them to replace the webfont import.
- **Icons:** Lucide is a substitution (see Iconography).
- **Product surfaces:** the UI kit is a plausible generic Reckue app, not a recreation of real screens (none were provided).

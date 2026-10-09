# Senvia OS Design System

## 1. Atmosphere & Identity

Senvia OS is a calm, operational CRM. Interfaces favor clear hierarchy, compact actions and predictable navigation. Deep navy anchors the application shell while electric blue identifies primary actions. Security messages use the same card and dialog surfaces as the rest of the product.

## 2. Color

The canonical tokens live in `src/index.css` and are consumed through Tailwind semantic utilities.

| Role | Token | Usage |
|---|---|---|
| Page surface | `--background` | Main application background |
| Primary text | `--foreground` | Headings and body text |
| Elevated surface | `--card`, `--popover` | Cards, dialogs and menus |
| Primary action | `--primary` | Buttons, links and focus rings |
| Secondary surface | `--secondary`, `--muted` | Quiet controls and supporting regions |
| Supporting text | `--muted-foreground` | Descriptions and metadata |
| Dividers | `--border` | Surface separation |
| Caution | `--warning` | Deadlines and non-blocking security notices |
| Success | `--success` | Completed and protected states |
| Error | `--destructive` | Blocking errors and destructive actions |
| Shell | `--sidebar-*` | Desktop and mobile navigation chrome |

Colors must use semantic utilities such as `bg-card`, `text-primary`, `bg-warning/10` and `border-border`. New raw color values require a token first.

## 3. Typography

Primary font: Inter with the system sans-serif fallback declared in `src/index.css`.

| Level | Tailwind size | Weight | Usage |
|---|---|---|---|
| Page title | `text-2xl` | 700 | Primary page heading |
| Dialog title | `text-xl` | 600–700 | Focused overlay heading |
| Section title | `text-lg` | 600 | Cards and subsections |
| Body | `text-base` | 400 | Primary explanatory copy |
| Supporting | `text-sm` | 400–500 | Descriptions and metadata |
| Caption | `text-xs` | 500 | Compact labels and secondary notes |

Body copy must remain at least `text-sm`. Long text uses normal wrapping and readable line height.

## 4. Spacing & Layout

The base spacing unit is 4px and Tailwind's default scale is canonical. Common gaps are `gap-2` (8px), `gap-3` (12px), `gap-4` (16px), `gap-6` (24px) and `gap-8` (32px). Cards and dialogs use 16–24px internal spacing.

The application shell uses `min-h-dvh`. The page owns vertical scrolling; dialogs constrain their content with a dynamic-viewport maximum height and an internal scroll body. At 375px, actions stack into one column and no primary content may create horizontal scrolling.

## 5. Components

### Button

- **Structure**: semantic `button` through `components/ui/button`.
- **Variants**: primary, outline, secondary, ghost and destructive.
- **States**: default, hover, active, focus-visible, disabled and loading.
- **Accessibility**: visible focus ring, descriptive label and native keyboard activation.
- **Motion**: existing 200ms color transition only.

### Dialog

- **Structure**: Radix dialog overlay, elevated content, header, description and footer.
- **Variants**: informational and action-oriented.
- **Spacing**: 24px content rhythm; footer actions wrap or stack on narrow screens.
- **States**: opening, open, focus trap, dismissal and closed.
- **Accessibility**: labelled title and description, Escape dismissal when the action is optional, initial focus managed by Radix.
- **Motion**: existing fade and scale transitions; reduced-motion behavior follows the shared primitive.
- **Layout**: centered overlay; dialog content owns overflow when required.

### Card

- **Structure**: card, header, title, description and content primitives.
- **Variants**: default, status and interactive.
- **States**: default, hover when interactive, loading, empty and error.
- **Accessibility**: headings preserve document order; interactive cards expose a semantic control.

### Application shell

- **Structure**: persistent navigation with a responsive main content region.
- **Variants**: desktop sidebar and mobile header/bottom navigation.
- **Accessibility**: main landmark remains available; overlays do not reorder focus.
- **Layout**: the page is the scroll owner; fixed navigation remains outside modal focus traps.

## 6. Motion & Interaction

Micro interactions use 100–150ms ease-out. Dialog and panel transitions use 200–300ms ease-in-out. Motion communicates a state change and only animates opacity or transforms. Shared primitives must respect `prefers-reduced-motion`.

## 7. Depth & Surface

The product uses a mixed depth strategy already defined by `--shadow-sm`, `--shadow-md`, `--shadow-lg` and `--shadow-card`. Borders separate ordinary cards; shadows are reserved for elevated dialogs, menus and selected interactive surfaces. Modal overlays use the shared Radix backdrop.

## 8. Accessibility Constraints & Accepted Debt

Target WCAG 2.2 AA: body-text contrast of at least 4.5:1, visible keyboard focus, full keyboard reachability, labelled dialogs and no interaction that depends only on color. Security deadlines must be written explicitly in text.

Existing legacy screens contain raw colors and type assertions outside the scope of this feature. New work must use the semantic primitives and tokens documented here.

## 9. Inbox document preview

Preserve the existing Senvia inbox, shadcn primitives and Tailwind tokens. PDF cards use the existing rounded-xl document surface, text-sm filename, text-xs metadata, background/muted/primary foreground tokens and Lucide icons. The first page is a white document canvas inside a reserved preview area; loading and failure states occupy that same area to prevent layout jumps.

The reader uses the existing accessible Dialog, a readable title, labelled icon buttons with 40px touch targets, page navigation, fit-width rendering, bounded zoom and download. At 375px controls wrap without horizontal overflow; the document viewport alone scrolls when zoomed. Canvas pixels are rendered for the device pixel ratio up to 2, with a bounded pixel budget. Offscreen message previews defer PDF loading. Closing or replacing a document cancels rendering and destroys the loading task. Existing non-PDF downloads retain their behavior.

Accepted limitation: canvas content is not selectable text. The original PDF remains available for the browser's accessible native reader through download/open.

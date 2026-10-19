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
| Secondary action text | `--action` | Accessible blue text and icons on tinted secondary controls; 221 83% 45% in light mode, 213 94% 78% in dark mode |
| Secondary surface | `--secondary`, `--muted` | Quiet controls and supporting regions |
| Supporting text | `--muted-foreground` | Descriptions and metadata |
| Dividers | `--border` | Surface separation |
| Caution | `--warning` | Deadlines and non-blocking security notices |
| Success | `--success` | Completed and protected states |
| Error | `--destructive` | Blocking errors and destructive actions |
| Shell | `--sidebar-*` | Desktop and mobile navigation chrome |
| Navigation areas | `--nav-communication`, `--nav-commercial`, `--nav-finance`, `--nav-calendar`, `--nav-neutral` | Blue communication/overview, violet commercial, green finance, orange calendar, slate utilities; brighter tones on the navy sidebar and in dark mode |

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
- **Secondary actions**: outline buttons use a primary-blue border, primary/5 background and action-colored text; secondary buttons use primary/10 background and action-colored text. Hover deepens the tint and border, focus keeps the shared ring, and disabled controls retain reduced opacity. Primary and destructive variants keep their established hierarchy. Quiet ghost actions remain unfilled; important Inbox navigation and toolbar controls use outline so their clickable bounds remain visible without hover.

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

- A labelled “Versão antiga” switch in desktop/tablet and mobile headers selects the classic shell. New interface is the default; selection persists in this browser. Classic hides workspace tabs/search, restores flat page surfaces and plain navigation icons. Both modes share the same mounted routes and Inbox provider; toggling must not reload the document or remount composers. Fiscal fixes and data are common to both modes.

- The expanded sidebar uses the existing white Senvia logo asset, not a recreated initial or wordmark. Its footprint stays within the available header space beside announcements and the collapse control.

- Module icons use a shared 32px rounded tile with an 18px Lucide icon, a soft tinted background and a subtle matching border. Communication and overview are blue, commercial modules and automations violet, finance green, calendar orange, and settings/admin/portal slate. Labels stay neutral; the active page retains its blue row highlight and gains a blue tile ring. Expanded, collapsed and mobile menus use the same route-to-color mapping. Locked modules remain muted and expose the existing lock indicator. No gradients or decorative animation are added.

- The sidebar always exposes a labelled 40px expand/collapse control, including when temporarily collapsed by the responsive layout. On tablets, expansion overlays the page with a dismissible backdrop and closes after navigation; it does not change the saved desktop preference. On desktop, a docked Inbox respects the saved sidebar preference: both can stay open, and manual menu expansion never minimizes the Inbox.

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

### Inbox message task actions

When the conversation is scrolled away from the latest messages, a labelled 44px circular “Ir para a última mensagem” button appears at the bottom right of the message viewport, above the composer. Activating it moves only that conversation to the bottom immediately and hides the button, without changing the draft or reply. Reading older messages must not trigger automatic jumping.

Task actions remain visible beside their source message: after incoming bubbles and before outgoing bubbles. They use the existing ghost icon button, accessible label and touch target. A bounded AI batch may expose the existing link button to continue pending analysis; loading disables continuation. Drafts remain scoped to the selected contact and box.

## 10. Persistent inbox workspace

### Pages beside the Inbox

Leads responds to its own available width through the named `leads` container. Below 1100px of page width, filters move above the results into an accordion, secondary toolbar actions move into a labelled “Mais” menu, and the table prioritizes name, phone, status and actions. Below 520px phone moves out of the table; the complete contact remains accessible through its details. Essential actions and the grid/list toggle remain visible. Above 1100px the sidebar filters and full toolbar return. No resize may reset filters, selections, drafts or view preference.

### Responsive workspace navigation

The persistent workspace is WhatsApp-only. Compact mailbox selection lists only WhatsApp channels. Email and other channels remain available on the full Inbox page; selecting them parks the reader when leaving and shows no persistent panel or restore control. The WhatsApp pin preference remains enabled, and hidden readers retain their drafts without read receipts. WhatsApp is the default channel when one is available.

The Inbox keeps a stable reader and draft owner at every size. Below 1440px, leaving the Inbox parks it in the background and exposes a labelled “Retomar Inbox” control; restoring opens the Inbox page. It must not cover the destination page. On phones and tablets the Inbox page keeps the application header, hides workspace tabs and bottom navigation, and fills the remaining dynamic viewport. Its own lists and message reader own scrolling.

At 1440px and above, the pinned 28rem panel reserves its column while the application sidebar keeps its saved width (16rem expanded or 4rem collapsed). Page dialogs use these same boundaries. Minimize, restore, resize and moving the reader must not remount the draft owner.

The Inbox toolbar stays in one row with a visible “Caixas” control on narrow and compact surfaces, the current box name, a 40px minimize button and a labelled options popover. Window, full-page and enable/disable actions remain in that popover. Mailbox selection is available while reading a message as well as in the list. No primary action may depend on a viewport-only breakpoint inside the compact panel. Mailbox Sheets stay above the mobile application header.

The optional inbox workspace uses existing background/card/border/primary tokens and Lucide icons. Wide desktop uses a 28rem right panel and reserves that width in the main content; narrower screens keep it parked when navigating away. The toolbar and options expose labelled controls to minimize, restore, return to Inbox, open a separate window and disable the feature. Minimization hides the entire workspace, including email composers. A stable portal host preserves reader, draft, reply and attachment state across navigation and window moves. Only the enabled preference is stored locally, scoped by user and organization; message content is not persisted by this feature. Organization/logout changes unmount and close detached content. Detached windows require the original CRM tab to remain open. Turning the feature off restores ordinary page navigation without deleting the current in-memory draft.

The workspace pins automatically on the first Inbox visit unless explicitly disabled. While docked at desktop widths (1440px+), a stable dialog portal occupies the main page region between the sidebar (16rem expanded or 4rem collapsed) and the 28rem Inbox column. Dialogs and Sheets in this mode permit interaction with the Inbox and ignore Inbox clicks as outside dismissal. Minimize, pop-out and disable restore the full dialog area without remounting forms. Destructive AlertDialogs retain their confirmation focus trap; their visual overlay still respects the reserved column. Mobile retains the existing full-screen modal behavior.

Inbox media previews use the shared modal portal (or detached window body), outside the narrow transformed Inbox host. Fit uses the actual available content width and height, with room for sender, caption, thumbnails and zoom controls. Media clicks are Inbox workspace interactions and do not dismiss an open client form. Escape closes the preview before background dialogs.

### Inbox emoji composer

The message composer offers a 40px outlined emoji trigger. Its lazy-loaded full Emoji Mart picker uses the existing native emoji set, categories, search and skin tones, with a viewport-constrained popover. A colon at the beginning of a word opens up to eight suggestions, using Portuguese aliases and the full English index. Arrow keys select, Enter/Tab inserts and Escape dismisses. Insertion replaces only the active shortcut or selected text, restores caret/focus, and never sends. IME composition bypasses send shortcuts. The existing draft owner and persistence remain unchanged.

Inbox emoji artwork preview: Google Noto images replace device glyphs in the full picker, colon suggestions and current message bodies. The unmodified emoji-datasource-google 15.0.1 sprite is hosted locally under /emoji/google, with Google attribution and license. Picker and glyph renderer share the same dataset coordinates. Actual message content remains Unicode; the plain text editing field keeps platform glyphs. This is an alternative visual set, not WhatsApp artwork.

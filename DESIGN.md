# Senvia OS Design System

Client metric cards in the modern Workplace use an intrinsic grid with a 14rem minimum card width, bounded by the available width. They wrap when the Inbox is docked, independently of the browser viewport, so monetary values remain readable. The classic interface retains its existing responsive grid.

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

## 11. Workplace preview: Realize reference, Senvia identity

This local-only iteration carries the Realize workspace's navy framing, softly elevated paper surfaces, strong page hierarchy and colorful dimensional module tiles into Senvia. Keep the real white Senvia logo and electric-blue primary actions. The existing Inter font remains to avoid a network dependency; headings use tighter tracking and stronger weight. No new RH, feed or chat routes are implied.

Navigation is one shared inventory grouped into Visão geral, Comunicação, Trabalho, Comercial and Gestão. Sidebar, command search and mobile menus consume that inventory; permissions, plans and route destinations remain unchanged. Calendar is Trabalho, Inbox and Marketing are Comunicação, Financeiro and Definições are Gestão. Modern navigation uses 32px saturated gradient tiles with white 18px Lucide symbols: blue overview, violet communication, amber work/calendar, cyan commercial, emerald finance and slate management. Active navigation adds a quiet blue surface and ring; labels carry meaning independently of color.

Shared modern cards use a 14px corner, fine cool border and a two-layer soft shadow; financial tables retain existing row heights. Primary buttons use the Senvia blue ramp and restrained elevation. Page titles are 24px bold, descriptions wrap, actions flow below titles when space is limited. Main canvas is cool near-white. The modern shell owns these changes; Versão antiga keeps flat surfaces and plain icons. Reduced motion disables nonessential transitions. No provider keys, route mounts, draft persistence or editor code change.

Accessibility: keep text contrast AA, visible focus, labelled icon-only controls and existing 40px touch targets. Personas: commercial desktop user with a docked conversation, tablet user with overlay navigation, phone user reading and composing. Parent QA must exercise all three, switching classic mode without losing an unsent draft. Accepted scope: deeper per-module content composition remains on existing reusable primitives rather than replacing business screens.

## 12. Feed and Tasks: shared Workplace, local frontend preview

Realize source references: social/pages/FeedPage.tsx and tasks/pages/TasksPage.tsx. Carry forward the editorial two-column Feed, white rounded composer, segmented scope filters, small author avatars, blue primary publish action, threaded comments and a useful contextual rail. Tasks use a compact heading, view switcher, personal/team filters, grouped rows or three status lanes and an editable detail sheet. Senvia blue replaces Realize primary; existing Inter, navy ink, cool canvas and colorful Lucide symbols remain. Avoid a new KPI dashboard: the work itself is the focal content.

Feed and Tasks are connected to the shared Supabase organization. Feed posts, comments and reactions have organization and MFA policies. Tasks reuse inbox_tasks and its existing channel access policies; status changes stay synchronized with done_at for Inbox callers. Drafts remain private under organization AND signed-in user browser keys and clear only after confirmed persistence. Prior browser rehearsal content is preserved without automatic publication. Stable publication IDs prevent duplicate retries; task versions reject stale overwrites. Empty states contain no fabricated colleagues. Frontend routes remain available only in development/local-preview builds until publication is authorized.

Task states: to do, in progress, done; priorities low, normal, high. All state changes work with labelled controls, not drag alone. Task editor supports title, description, assignee and due date, with persistent local draft and explicit cancel that retains it. Feed composer also retains its draft across navigation/reload. Auth/organization changes must select a different storage scope. Mobile layouts stack; board lanes stack rather than overflowing the document, contextual rail moves below content. Keyboard focus, accessible labels, error/loading/empty states and reduced motion are required. Attachments, employee notifications, subtasks and recurring tasks are outside this first shared release and must not be simulated. Feed explicitly shows the latest 100 posts; interactions and tasks are paginated without silent count truncation. Pending controls prevent repeat submissions, failures retain drafts, and concurrent edits require explicit review.

Workplace status text tokens are canonical in index.css: --workplace-danger-ink (0 65% 42%), --workplace-warning-ink (28 65% 30%) and --workplace-success-ink (158 65% 30%). Task surfaces use existing card, muted, border, foreground, primary, warning and success tokens; low-alpha semantic fills keep the Realize-inspired paper treatment without feature-local color literals.

## 13. Realize screenshot: Workplace shell and Feed composition

Reference: user screenshot codex-clipboard-852e7ef1-ff3d-4806-b276-9ae67466dc23.png (1906×997). Its geometry and component anatomy are the contract, adapted to Senvia content and existing permissions: 256px dark sidebar, 64px dark header, 44px integrated tab strip, one inset paper canvas with 28px outer corners. Keep the real Senvia logo. No Realize logo, fabricated recognition cards, fake notifications, attachment affordances without working upload, or employee data from the reference.

Tokens (modern shell only): --workplace-shell 240 9% 5%, --workplace-canvas 248 33% 98%, --workplace-tabs 246 17% 94%, --workplace-line 245 25% 90%, --workplace-ink 245 28% 14%, --workplace-muted 245 13% 44%, --workplace-radius 1.75rem, --workplace-card-radius 1.75rem. Keep existing electric-blue primary/action/focus tokens. Shadows: 0 2px 3px hsl(245 28% 14% / .025), 0 8px 20px hsl(245 28% 14% / .04). White elevated cards, cool very pale canvas, near-black chrome. Dark theme uses dark canvas/card tokens rather than forcing white.

Navigation primitive: 32px rounded dimensional tiles, 18px white symbols; Feed coral/red, conversations violet, mail/marketing blue, calendar rose, Tasks teal, commercial cyan, finance emerald, neutral slate. Active row is a translucent white bordered capsule rather than the old heavy blue block. Menu group labels remain small uppercase and muted; all existing modules stay accessible. Tabs reuse the same module tile at 24px/14px, active tab merges with the canvas through a rounded top; inactive tabs share the soft grey strip. Preserve close, external-tab and keyboard controls; all actions have labelled 32px minimum targets (40px on coarse pointers).

Header: compact pill-shaped search, actual notification count and real Inbox destinations in a popover, actual profile photo with initials fallback and account actions. Attendance pill is visual-only by explicit user choice: show current local clock and a labelled preview entry, no invented worked hours or stored time records. Preview popover must say it does not register entries/pauses/exits. Avoid a fake online indicator. Admin navigation follows current authorization. Existing interface-version control remains reachable without reloading routes.

Feed: editorial centered max-width ~1090px, 320px context rail when available, 24px gap. Heading and search share a row; compact 28px rounded composer uses actual avatar, muted textarea, current organization audience and real publish controls. Filters are rounded pills with dark ink selected state. Post cards use 24–28px corners and soft border/shadow; author photos, typography and actions remain real DOM controls. No test/seed activity is published. Communicado rail derives only from real fetched posts. Existing Supabase subscriptions, draft/attempt keys, publication confirmation and task linkage remain unchanged.

Scroll ownership: keep existing page/document scroll model to protect stable Inbox reader/provider; sidebar scrolls independently, desktop header/tabs remain reachable through sticky chrome. Tabs alone may scroll horizontally; primary page never does. Containers respond to available width, especially with docked Inbox. At 768px sidebar overlay/compact header remain functional; 375px Feed stacks with no overflow and essential controls remain available. Mobile Inbox immersive behavior is preserved. Reduced motion removes cosmetic transitions. Classic mode remains a reversible option.

Acceptance: real-browser Feed, Tasks and one CRM page at 375/768/1280+ widths; notification/account/ponto popovers, tab navigation and draft preservation exercised. This phase is visual only for attendance and does not alter database schema.

The modern account identity/actions live in the top-right avatar menu, avoiding a duplicate account block at the foot of the sidebar and giving navigation more room. Classic mode retains its original sidebar account controls. Organization switching and the app version link remain available.

User correction: the old-version switch is always visible in the header, outside the account menu. Phone mode uses a compact `Antiga` label with the full accessible name `Versão antiga`; the brand mark reduces to 64px to fit every control without overflow. The switch stays reversible without route reload.

### Inbox interior: Realize reference
Modern workspace uses a compact channel rail, white conversation column, softly tinted reading canvas, rounded search and spacious borderless conversation rows. Senvia blue remains the accent. Existing email folders, message actions, draft ownership and responsive navigation remain unchanged. Classic interface retains its current styling.

### Tasks reference
Centered task list with independent rounded rows, compact toolbar, colored priority pills and a right detail drawer. Existing task fields, persistence and drafts are retained.

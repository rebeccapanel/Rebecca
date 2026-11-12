# Chakra → Tailwind/shadcn migration: handoff spec

Read this file completely before touching code. It is the contract for porting the
remaining Chakra UI surface of the Rebecca dashboard to Tailwind v4 + shadcn/ui.

Target repo: `rebecca-new-dashboard/dashboard` (the **legacy** dashboard, Vite 3 +
React 18). Do **not** touch `dashboard-next/`; it is a separate app.

Branch: work on a branch off `refactor/legacy-tailwind`. Never push.

---

## 1. Non-negotiables

1. **The look must not change.** This is a re-implementation, not a redesign. Same
   spacing, same colours, same radii, same order of elements. The only allowed
   visual differences are the ones written in this document.
2. **Zero `@chakra-ui/react` imports** in a file when you claim it is migrated.
   `useColorMode` is the single exception and only until the theme provider is
   replaced (it is listed as a known follow-up).
3. **Do not touch business logic.** Hooks, stores, API calls, permission checks,
   i18n keys, event handlers stay byte-identical. You are changing the markup and
   its styling only.
4. **No new colours.** Every colour comes from the panel tokens (section 3).
5. **RTL is a first-class requirement.** Use logical utilities (`ps-*/pe-*`,
   `ms-*/me-*`, `start-*/end-*`, `border-s-*`, `rounded-s-*/rounded-e-*`) instead of
   `pl-*/pr-*`, `left-*/right-*`. Test with `?lang=fa`.
6. **Numbers keep their alignment.** Add `rb-tabular` (tabular numerals) to numeric
   cells and stat values.
7. **`tsc`, `biome lint` and `vite build` must pass** before you report a file done.

---

## 2. Commands

```bash
cd rebecca-new-dashboard/dashboard

npm run dev                 # dev server, reads VITE_BASE_API from .env.local
VITE_BASE_API=https://roverloom.com/api npx vite --port 3000   # real backend
npx tsc --noEmit            # typecheck
npm run build               # production build (must succeed)

# Visual check without credentials: stub API on :3199, then a second instance
node /tmp/legacy-mock.mjs &                                    # stub
CHOKIDAR_USEPOLLING=1 VITE_BASE_API=http://127.0.0.1:3199 npx vite --port 3001
```

Screenshot helper (headless Chromium is already installed):

```js
// /tmp/pw/shot.mjs style:
import { chromium } from "playwright-core"
const EXE = "/home/pouria/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell"
const b = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] })
const p = await b.newPage({ viewport: { width: 1440, height: 1000 } })
await p.goto("http://127.0.0.1:3001/users", { waitUntil: "networkidle" })
await p.waitForTimeout(1500)
await p.screenshot({ path: "/tmp/shot.png" })
await b.close()
```

If Vite dies with `EMFILE`, start it with `CHOKIDAR_USEPOLLING=1` and
`ulimit -n 8192`.

---

## 3. Token system (already wired, use it)

`src/tailwind.css` maps the panel's CSS variables to Tailwind colours. Never
hard-code a hex value.

| Meaning | CSS variable | Tailwind class |
| --- | --- | --- |
| page background | `--rb-panel-bg` | `bg-panel-app` |
| app background | `--rb-panel-main` | `bg-panel-main` |
| sidebar | `--rb-panel-sidebar` | `bg-panel-sidebar` |
| card surface | `--rb-panel-surface` | `bg-panel-surface` |
| raised surface / hover | `--rb-panel-elevated` | `bg-panel-elevated` |
| border | `--rb-panel-border` | `border-panel-border` |
| strong border | `--rb-panel-border-strong` | `border-panel-border-strong` |
| text | `--rb-panel-text` | `text-panel-text` |
| secondary text | `--rb-panel-text-secondary` | `text-panel-text-secondary` |
| muted text | `--rb-panel-text-muted` | `text-panel-text-muted` |
| accent (crimson) | `--rb-panel-accent` | `bg-panel-accent` / `text-panel-accent` |
| accent hover | `--rb-panel-accent-hover` | `bg-panel-accent-hover` |
| success / warning / danger / info | `--rb-panel-*` | `text-panel-success`, `bg-panel-danger/10`, … |

Dark mode: the panel does **not** use `prefers-color-scheme`. It toggles
`.rb-theme-dark` on `<html>`/`<body>`, and `dark:` is already bound to that class
in `src/tailwind.css`. Use `dark:` normally.

Fonts: `--rb-font-stack` is already the Tailwind `font-sans`.

---

## 4. Chakra → Tailwind mapping

### 4.1 Layout primitives

| Chakra | Replacement |
| --- | --- |
| `<Box>` | `<div>` |
| `<VStack spacing={n}>` | `<div className="flex flex-col gap-{n*4}">` (spacing 4 → `gap-4`) |
| `<HStack spacing={n}>` | `<div className="flex flex-row items-center gap-{n*4}">` |
| `<Flex direction=… align=… justify=…>` | `<div className="flex flex-…">` |
| `<Stack>` | `<div className="flex flex-col gap-…">` |
| `<SimpleGrid columns={n} spacing={m}>` | `<div className="grid grid-cols-{n} gap-…">` |
| `<Center>` | `<div className="flex items-center justify-center">` |
| `<Spacer>` | `<div className="flex-1" />` |
| `<Divider>` | `<hr className="border-panel-border" />` or `border-t` |
| `<Text fontSize="sm">` | `<p className="text-sm">` |
| `<Heading size="md">` | `<h2 className="text-lg font-semibold">` |

### 4.2 Controls

| Chakra | Replacement |
| --- | --- |
| `<Button>` | `Button` from `src/components/shadcn/button.tsx` |
| `<IconButton icon={…} aria-label=…>` | `<Button variant="ghost" size="icon-sm" aria-label=…>` |
| `<Button isLoading>` | `disabled={loading}` + spinner icon (`motion-safe:animate-spin`) |
| `<Input>` | `input` + the field classes from `src/pages/Login.tsx` (`LoginField`) |
| `<FormControl><FormLabel/><FormErrorMessage/>` | `<div class="space-y-2"><label htmlFor/><input aria-invalid/><p role="alert"/>` |
| `<Switch>` | keep until batch D, then port to a `button[role=switch]` + `aria-checked` |
| `<Checkbox>` | `input[type=checkbox]` + `accent-panel-accent` (or a shadcn checkbox) |

### 4.3 Overlays

| Chakra | Replacement |
| --- | --- |
| `<Menu>/<MenuButton>/<MenuList>/<MenuItem>` | the shadcn `DropdownMenu` in `src/components/shadcn/dropdown-menu.tsx` |
| `<Popover>` | shadcn `Popover` (add `@radix-ui/react-popover`, same forwardRef rules) |
| `<Modal>/<ModalOverlay>/<ModalContent>` | shadcn `Dialog` (add `@radix-ui/react-dialog`) |
| `<Drawer>` | shadcn `Sheet`-style Dialog with `side` classes |
| `<Tooltip label=…>` | the shadcn `Tooltip`, or `title=` for text-only tooltips |

### 4.4 Data

| Chakra | Replacement |
| --- | --- |
| `<Table>/<Thead>/<Tr>/<Th>/<Td>` | plain `<table>` + the classes already used in `src/components/ui/DataTable.tsx` |
| `<Tag>/<Badge>` | `<span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs">` + a tone class |
| `<Alert status="error">` | the alert markup from `src/pages/Login.tsx` (`border-s-2 border-panel-danger bg-panel-danger/10`) |
| `<Spinner>` | `<span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />` |
| `<Skeleton>` | `<div className="animate-pulse rounded-md bg-panel-elevated" />` |
| `<Progress>` | `<div className="h-1 rounded-full bg-panel-border"><div className="h-full rounded-full bg-panel-accent" style={{width}} /></div>` |

### 4.5 Prop translation

| Chakra prop | Tailwind |
| --- | --- |
| `p={4}` `px={3}` `py={2}` | `p-4` `px-3` `py-2` |
| `p={{ base: 3, md: 5 }}` | `p-3 md:p-5` |
| `spacing={2}` | `gap-2` |
| `w="full"` `h="14"` | `w-full` `h-14` (Chakra number × 4px = Tailwind scale) |
| `borderRadius="md"` | `rounded-md` |
| `borderWidth="1px"` | `border` |
| `color="panel.textMuted"` | `text-panel-text-muted` |
| `bg="panel.surface"` | `bg-panel-surface` |
| `noOfLines={1}` | `truncate` |
| `isDisabled` | `disabled` |
| `_hover={{ bg: "panel.elevated" }}` | `hover:bg-panel-elevated` |
| `_focusVisible={{ borderColor: "primary.400" }}` | `focus-visible:border-panel-accent` |
| `sx={{ … }}` | the equivalent Tailwind class; **do not keep `sx`** |
| `useColorModeValue("a", "b")` | a token class (`text-panel-text`), or `dark:` when the two values really differ |

---

## 5. The shadcn kit (already installed)

- `src/lib/cn.ts` — `cn()` (clsx + tailwind-merge).
- `src/components/shadcn/button.tsx` — `Button`, variants `default|outline|ghost|subtle|destructive|link`, sizes `default|sm|xs|icon|icon-sm`.
- `src/components/shadcn/dropdown-menu.tsx` — Root/Trigger/Content/Item/CheckboxItem/Label/Separator.

### Hard-won rules — read these twice

1. **Every component that can be a Radix trigger must `forwardRef`.**
   We lost an afternoon to a dropdown that rendered at `translate(0,-200%)`
   because `Button` was a plain function component and React 18 dropped the ref.
2. **Never nest `<button>` inside a Chakra `MenuButton`.** If a trigger must look
   like a shadcn button, either use the shadcn `DropdownMenu.Trigger asChild`
   (requires forwardRef) or keep the Chakra trigger and style it with Chakra props.
3. Radix portals render into `document.body`; their content inherits the panel's
   `.rb-theme-dark`, so `dark:` works inside them.
4. `ChakraProvider` runs with `resetCSS={false}`. Tailwind's preflight is **not**
   imported either (see `src/tailwind.css`), so Chakra's global styles are still
   the only reset. Do not re-enable Chakra's reset; utilities would lose to it
   again (that is why borders silently disappeared before).
5. **Legacy `src/index.scss` sets `* { min-width: 0 }` without a layer.** Unlayered
   CSS beats Tailwind's layered utilities, so every `min-w-*` class is silently
   ignored. Add the important suffix: `min-w-[…]!`, `sm:min-w-[…]!`.
6. **Chakra's global style sets `border-color` on `*`, also unlayered.** Every
   Tailwind border-colour class (`border-panel-border`, `border-panel-accent`, …)
   is overridden, and the element shows Chakra's `rgba(255,255,255,0.16)`. Use the
   suffix form: `border-panel-border!`, `hover:border-panel-accent!`. This applies
   to shadcn components too, so the shared `DropdownMenuContent` base still needs it.
   Login uses these classes without the suffix and may have the same problem; check
   it before trusting its borders.
7. **Radix portals and Chakra's transformed containers.** Chakra's `MenuList`
   carries a transform, and a `fixed` popper inside it is offset by about 24px. Pass
   `container` to nested popovers so they stay inside the open menu, and expect the
   offset until the parent menu is off Chakra. `AppLayout` is now off Chakra.
8. **Placement follows direction, not Chakra's logical names.** Chakra's
   `bottom-end` flips in RTL, so the menu aligns to the start edge. Radix's `end` is
   physical. Use `align={isRTL ? "start" : "end"}`. A checkmark or inset that Chakra
   placed physically (`right`) should stay physical, not logical.

---

## 6. Reference implementations (copy their patterns)

| File | Why it is the reference |
| --- | --- |
| `src/pages/Login.tsx` | full screen: fields, labels, error alert, 2FA, theme dropdown |
| `src/components/AppSidebar.tsx` | navigation rail: fixed shell, groups, active state, collapsed rail with hover labels |
| `src/components/users/UsersOverviewBand.tsx` | stat card: grid, tabular numbers, stacked bar, RTL-safe dividers |
| `src/components/users/RefreshSplitButton.tsx` | split control + shadcn dropdown |
| `src/components/ui/DataTableColumnMenu.tsx` | chooser menu pattern |

---

## 7. Work batches

Order is deliberate: each batch is verifiable on its own, and later batches depend
on the components introduced earlier. File sizes are lines from
`grep -rl "@chakra-ui" src`.

### Batch A — the shell (highest value, highest risk)

1. `components/AppLayout.tsx` (1797) — header bar, breadcrumb, notifications menu,
   profile menu, mobile drawer, keyboard shortcuts. **Do the header bar first**,
   keep the menus working, then the drawer.
2. `components/HeaderCalendar.tsx` — date/calendar popover.
3. `components/GitHubStars.tsx` — small stat link.
4. `components/ThemeSelector.tsx` (568) — theme grid + triggers.
5. `components/SponsorCarousel.tsx` — used by the sidebar.

### Batch B — shared primitives (unblocks everything else)

`components/ui/*` except `DataTableColumnMenu.tsx` (already done):
`DataTable.tsx` (1502), `ResourceListCard.tsx`, `Pagination`, `PageLoadingSkeleton`,
`BulkActionBar.tsx`, `ExpandedPanel.tsx`, `DataTableRowActions.tsx`.
`components/common/PanelSelect.tsx` (911), `components/common/SearchInput.tsx`,
`components/Filters.tsx` (741), `components/Icon.tsx`, `components/Language.tsx`.

> Do `PanelSelect` and `DataTable` early: most pages depend on them, and every page
> migration gets cheaper afterwards.

### Batch C — dialogs (the "one kit" goal)

`components/dialogs/*`, then `components/UserDialog.tsx` (4195) and
`components/AdminDialog.tsx` (1857). These two currently duplicate the same
create/edit form; part of the port is extracting the shared fields into
`components/users/UserFormFields.tsx` used by both admins and users dialogs.
Ask before changing their behaviour: validation, partial PUT and tab order must
stay identical.

### Batch D — list pages

`components/UsersTable.tsx` (2228), `AdminsTable.tsx` (1503),
`HostsManager.tsx` (3085), `pages/NodesPage.tsx` (3493) + `NodeFormModal.tsx` (720),
`pages/ServicesPage.tsx` (2433), `pages/BulkActionsPage.tsx` (1480),
`pages/RecentActionsPage.tsx` (1122).

### Batch E — settings (do last; largest and least visited)

`pages/CoreSettingsPage.tsx` (6232), `pages/IntegrationSettingsPage.tsx` (4066),
`components/InboundsManager/*` (`FormDrawer.tsx` 7622 is the single biggest file),
`components/OutboundModal.tsx` (2614), `pages/HAProxyPage.tsx` (2044),
`components/Statistics.tsx` (2583), `pages/MyAccountPage.tsx` (1529), plus the long
tail of ~60 small modals (`DnsModal`, `WarpModal`, `NordVPNModal`, …).

---

## 8. Definition of done for one file

1. No `@chakra-ui/react` import left (except the documented `useColorMode` case).
2. No `sx`, no `useColorModeValue`, no `chakra(…)`, no Chakra prop names.
3. Visual parity checked at 1440×1000 **and** 390×844, in `en` and `fa`.
4. `npx tsc --noEmit`, `npx biome lint <file>`, `npm run build` all pass (this project uses Biome, not ESLint).
5. Commit with the message `refactor(dashboard): port <file> to tailwind`
   and paste the before/after screenshot paths in the commit body.
6. Update the table in `docs/migration/chakra-inventory.md` (add the file, mark it
   `done`, and note the commit hash).

---

## 9. Copy-paste prompt for the next AI (Batch A)

> You are continuing a UI migration in `/home/pouria/project/rebeca-panel/rebecca-new-dashboard/dashboard`,
> a Vite 3 + React 18 + TypeScript app that is being ported from Chakra UI v2 to
> Tailwind v4 + shadcn/ui. Read `docs/migration/chakra-removal-prompt.md` first;
> it contains the token map, the component map, the reference implementations and
> the definition of done. Then port **`src/components/AppLayout.tsx`** and
> **`src/components/ThemeSelector.tsx`**: replace every `@chakra-ui/react` import
> with Tailwind classes and the components in `src/components/shadcn/`, keep the
> markup order, colours and behaviour identical, keep all hooks/stores/handlers
> untouched, and use logical properties for RTL. Verify with `npx tsc --noEmit`,
> `npm run build`, and screenshots of `/dashboard` at 1440×1000 and 390×844 in
> both `en` and `fa`. Do not touch `dashboard-next/`, do not change API calls,
> do not push. Report per file: imports removed, behaviour preserved, screenshot
> paths, and any Chakra dependency you could not remove with the reason.

---

## 10. What NOT to do

- Do not redesign, re-space or "improve" anything. If a value looks wrong, it is a
  bug in your port, not an invitation.
- Do not migrate `@chakra-ui/react`'s `useToast` to `sonner` in the same commit as a
  layout port; do it as a separate, mechanical commit.
- Do not add a second design system: no MUI, Ant, Bootstrap, no new CSS framework.
- Do not touch `dashboard-next/` or the Go backend.
- Do not push. Everything stays local on the branch.

# UI references — open-source admin dashboards for the VPN panel console

**Verified:** 2026-10-20. Every repo, star count, license and last-push date below was fetched from
`api.github.com/repos/<owner>/<name>` on that date (star counts drift; treat as approximate).
Live demos were fetched with HTTP `200` unless marked. Source-tree claims were read from the repos'
actual files (paths quoted below), not from marketing pages.

**Our target stack:** React 18/19 + TypeScript + Vite + Tailwind CSS + shadcn/ui (or equivalent headless
approach). Go/FastAPI backend serves the SPA — **no SSR need**, so Next-only projects are marked as
"patterns only, port the components".

**What we need to fix:** (a) too few dashboard statistics, (b) weak sidebar/menu presentation,
(c) thin filter UX on the users page. Plus: RTL/Persian, thousands-row tables, live CPU/RAM/network metrics.

**Legend for the "Copy from it for" column:** `code-copy` = permissive license, drop the source in;
`port` = permissive, but stack differs enough that you re-implement the pattern; `reference only` = do
not copy code.

---

## 1. Shortlist (12 candidates)

| # | Repo | Live demo | License | Stars | Last push | Stack | Build | RTL | Copy from it for |
|---|------|-----------|---------|-------|-----------|-------|-------|-----|------------------|
| 1 | [satnaing/shadcn-admin](https://github.com/satnaing/shadcn-admin) | [shadcn-admin.netlify.app](https://shadcn-admin.netlify.app/) | **MIT** | ~15.8k | 2026-09-10 | React 19, TS, Tailwind v4, shadcn/ui (Radix), @tanstack/react-table 8, @tanstack/react-router 1, Recharts, zod | **Vite 8** | **Yes — first-class** (`DirectionProvider`, 10 components patched for RTL) | **code-copy** — the base to fork. Sidebar, RTL, data-table, filters, users page. |
| 2 | [shadcnstore/shadcn-dashboard-landing-template](https://github.com/shadcnstore/shadcn-dashboard-landing-template) | [demo](https://shadcnstore.com/templates/dashboard/shadcn-dashboard-landing-template/dashboard) | **MIT** | ~1.2k | 2026-10-09 | React 19, TS, Tailwind v4 (`@tailwindcss/vite`), shadcn/ui, react-router 7, @tanstack/react-table, Recharts, RHF | **Vite 8** (`vite-version/`) | No | **code-copy** — richest set of dashboard widget cards in a Vite+shadcn repo. |
| 3 | [shadcndashboard/shadcndashboard](https://github.com/shadcndashboard/shadcndashboard) | [shadcndashboard.dev](https://shadcndashboard.dev) | **MIT** | ~501 | 2026-10-01 | React 19, TS, Tailwind v4, shadcn/ui, @tanstack/react-table | **Vite 8** | No | code-copy — lightweight second opinion on dashboard/table composition. |
| 4 | [TailAdmin/free-react-tailwind-admin-dashboard](https://github.com/TailAdmin/free-react-tailwind-admin-dashboard) | [react-demo.tailadmin.com](https://react-demo.tailadmin.com) | **MIT** | ~1.3k | 2026-09-15 | React 19, TS, Tailwind v4, **ApexCharts**, react-i18next — *no shadcn, no table lib* | **Vite 8** | No | **code-copy** — widget density: gauge, KPI tiles, map, chart tabs. |
| 5 | [tremorlabs/tremor](https://github.com/tremorlabs/tremor) | [tremor.so](https://tremor.so) (docs/demos) | **Apache-2.0** | ~3.7k | 2025-10-10 | React, TS, Tailwind, Recharts wrappers — chart primitives only (v3 "raw") | library | No | code-copy — KPI sparklines, area/bar/donut/combo chart wrappers. |
| 6 | [Kiranism/next-shadcn-dashboard-starter](https://github.com/Kiranism/next-shadcn-dashboard-starter) | [shadcn-dashboard.kiranism.dev](https://shadcn-dashboard.kiranism.dev/dashboard) | **MIT** | ~7.1k | 2026-09-11 | React 19, TS, Tailwind v4, shadcn/ui (Base UI), @tanstack/react-table 8, **nuqs** URL state, Recharts | **Next 16** | No | **port** — best filter/table architecture in the ecosystem (filter variants, date/slider filters). |
| 7 | [arhamkhnz/next-shadcn-admin-dashboard](https://github.com/arhamkhnz/next-shadcn-admin-dashboard) | [studio-admin.arhamkhnz.com](https://studio-admin.arhamkhnz.com) | **MIT** | ~3.2k | 2026-10-20 | React 19, TS, Tailwind v4, shadcn/ui, Recharts, TanStack | **Next 16** | No | port — polished visual polish/typography reference for shadcn dashboards. |
| 8 | [refinedev/refine](https://github.com/refinedev/refine) | [refine.dev/templates](https://refine.dev/templates/) | **MIT** | ~35.9k | 2026-09-10 | React, TS, headless data/router layer; **official shadcn/ui integration** (`documentation/docs/ui-integrations/shadcn`) | any (Vite templates) | Via UI lib / i18n | port — filter model (`filters`, `sorters`, `useTable`) if we want URL/query-driven lists. |
| 9 | [marmelab/react-admin](https://github.com/marmelab/react-admin) | [react-admin-demo](https://marmelab.com/react-admin-demo/) | **MIT** | ~27.0k | 2026-10-19 | React, TS, MUI (not Tailwind) | library (CRA/Vite/Next) | Yes (MUI `direction: rtl`) | **port** — the reference for *saved queries + filter chips* UX, which nobody else has. |
| 10 | [ant-design/ant-design-pro](https://github.com/ant-design/ant-design-pro) | [pro.ant.design](https://pro.ant.design) | **MIT** | ~38.9k | 2026-10-15 | React, TS, Ant Design (not Tailwind), UmiJS | Umi | Yes (antd `direction="rtl"`) | reference/port — ProTable: column settings, density, search form, editable rows. |
| 11 | [MiladJoodi/FarsiUI](https://github.com/MiladJoodi/FarsiUI) | [farsiui.ir](https://farsiui.ir/) | **MIT** | ~212 | 2026-10-20 | React, TS, Tailwind 3.4, Base UI/Radix/React Aria; shadcn-style CLI registry | registry (docs app = Next; components are framework-agnostic) | **Yes — Persian-first** (RTL, Persian digits, Jalali calendar) | **code-copy** — Persian/RTL primitives: date pickers, number inputs, RTL layout blocks. |
| 12 | [tabler/tabler](https://github.com/tabler/tabler) | [preview.tabler.io](https://preview.tabler.io) | **MIT** | ~41.9k | 2026-10-20 | Bootstrap 5 (Astro site), 100+ pages, **every stylesheet ships an `.rtl` version** | not React | **Yes (CSS-level)** | **reference only / CSS port** — RTL mechanics, dense tables, sidebar/nav patterns. |

### Considered, not shortlisted (with reason)

| Repo | License | Stars | Why not |
|------|---------|-------|---------|
| [ColorlibHQ/AdminLTE](https://github.com/ColorlibHQ/AdminLTE) | MIT | ~45.7k | Bootstrap 5.3 + vanilla JS; v4 advertises "dark mode, RTL" but nothing React/Tailwind. Useful only as a page/layout benchmark. |
| [coreui/coreui-free-react-admin-template](https://github.com/coreui/coreui-free-react-admin-template) | MIT | ~4.96k | Stack is **React 17 + CRA + Bootstrap 4-era** (`@coreui/react` 3.4.6). Too old to borrow from. |
| [themesberg/flowbite-admin-dashboard](https://github.com/themesberg/flowbite-admin-dashboard) | MIT | ~2.9k | HTML/Tailwind only, last push 2025-03-20. Demo probe returned HTTP 429 (unverified; likely Vercel rate-limit). |
| [themeselection/materio-mui-nextjs-admin-template-free](https://github.com/themeselection/materio-mui-nextjs-admin-template-free) | MIT | ~1.97k | Next + MUI. README feature table marks **"RTL (right-to-left) support" as premium-only (`-` in the free column)** — the RTL selling point does not apply to the MIT repo. |
| [justboil/admin-one-react-tailwind](https://github.com/justboil/admin-one-react-tailwind) | MIT | ~589 | Was Vite; master is now **Next 15** (`next dev --turbopack`), so the Vite variant is the old release, not the maintained tree. |
| [horizon-ui/horizon-ui-chakra](https://github.com/horizon-ui/horizon-ui-chakra) | MIT | ~2.9k | Chakra UI + CRA, last push 2025-01-13. |
| [creativetimofficial/material-dashboard-react](https://github.com/creativetimofficial/material-dashboard-react) | MIT | ~3.0k | MUI + CRA, last push 2024-08-17. |
| [shadcn-ui/ui](https://github.com/shadcn-ui/ui) (official dashboard block) | MIT | ~126k | The `apps/www/app/(app)/examples/dashboard` block is Next-only; code is MIT so components can be lifted, but it has no filters/RTL beyond base primitives. |

---

## 2. Category notes

**(i) shadcn/ui + Tailwind starters (our home turf)**
`satnaing/shadcn-admin` is the only one that is simultaneously Vite, RTL-aware, and has a real
TanStack data-table + sidebar system. `shadcnstore` and `shadcndashboard` are Vite too and have
better *dashboard card variety*. Fork #1, harvest #2/#3 for cards.

**(ii) Tailwind admin templates with rich dashboard widgets**
`TailAdmin` wins on widget *density* (gauges, maps, chart tabs, KPI tiles) but has no shadcn and no
TanStack table — treat it as a widget catalogue. `Tremor` (Apache-2.0) is the cheapest way to get
sparklines and consistent chart styling without pulling a whole template.

**(iii) Excellent filter/table UX**
`Kiranism/next-shadcn-dashboard-starter` is the strongest technical reference: column-meta-driven
filters with six variants, date and slider filters, URL-persisted state (nuqs), column pinning,
sticky headers. `react-admin` owns *saved queries* (persisted filter+sort presets) and removable
filter chips. `Ant Design Pro`'s ProTable is the benchmark for column settings/density/search-form
ergonomics. `refine` is the cleanest *data* abstraction (filters/sorters/pagination as typed arrays)
if we later want URL-shareable views without hand-rolling TanStack state.

**(iv) First-class RTL**
Only two projects really qualify: **`satnaing/shadcn-admin`** (DirectionProvider + 10 components
manually patched for RTL, documented in README) and **`FarsiUI`** (Persian-first shadcn fork:
RTL-first layout, Persian digits, Jalali calendar). `Tabler` and `AdminLTE 4` ship `.rtl` stylesheet
variants but are Bootstrap/HTML. `Materio`'s free repo does **not** include RTL despite the paid
product having it.

**No open-source repo found that is RTL-first *and* a full React+Tailwind+shadcn admin app.** The
practical path: fork shadcn-admin, keep its DirectionProvider, add FarsiUI's Jalali/Persian-digit
components, and use Vazirmatn + logical Tailwind utilities.

---

## 3. Deep dive — TOP 4

### 3.1 `satnaing/shadcn-admin` — MIT — the base to fork ★ recommended

Verified `package.json`: `react ^19.2.5`, `vite ^8.0.8`, `tailwindcss ^4.2.2`, `@tanstack/react-table ^8.21.3`,
`@tanstack/react-router ^1.168.22`, `recharts ^3.8.1`, `zod ^4.3.6`, `@radix-ui/react-direction ^1.1.1`.
Note the **router is TanStack Router, not react-router** — if we keep react-router-dom, only the
`useTableUrlState` hook and route links need swapping; components are router-agnostic.

**RTL — this is the differentiator.** `src/context/direction-provider.tsx`:

```tsx
// src/context/direction-provider.tsx
const [dir, _setDir] = useState<Direction>(() => getCookie('dir') || 'ltr')
useEffect(() => { document.documentElement.setAttribute('dir', dir) }, [dir])
return <DirectionContext value={{ defaultDir, dir, setDir, resetDir }}>
  <RdxDirProvider dir={dir}>{children}</RdxDirProvider>   // @radix-ui/react-direction
</DirectionContext>
```

`useDirection()` is consumed in `src/components/config-drawer.tsx` (a live LTR/RTL toggle with
`IconDir` previews) and `src/context/layout-provider.tsx`. README lists the **"RTL Updated Components"**:
`alert-dialog, calendar, command, dialog, dropdown-menu, select, table, sheet, sidebar, switch`
(plus `scroll-area, sonner` modified). That list is the exact set of upstream shadcn components that
need `ms-*/me-*`, `start-*/end-*`, and icon-flip fixes — copy that patch list instead of re-auditing
every primitive. Also note `src/features/dashboard/components/overview.tsx` pins
`<YAxis direction='ltr' />` and `nav-group.tsx` uses `rtl:rotate-180` for the chevron: chart axes and
chevrons must be un-flipped by hand.

**Dashboard widget set** (`src/features/dashboard/`):
- `index.tsx` — `Tabs` (Overview / Analytics / Reports / Notifications, last two `disabled`),
  4 KPI cards in `grid gap-4 sm:grid-cols-2 lg:grid-cols-4`, each `Card` = icon + title + big value +
  "+20.1% from last month" delta; `Overview` bar chart (4/7 cols) + `RecentSales` list (3/7 cols).
- `components/analytics.tsx` — secondary tab: area chart card, 4 KPI cards (clicks / visitors /
  bounce / avg session), then `Referrers` + `Devices` as **`SimpleBarList`** (inline progress bars,
  `tabular-nums`, no chart library needed) — perfect for top nodes / top protocols.
- `components/overview.tsx` — Recharts `BarChart` with `className='fill-primary'`, 350px height.
- `components/analytics-chart.tsx` — Recharts `AreaChart`, two series, `fillOpacity 0.15/0.1`.
- `components/recent-sales.tsx` — avatar + name + email + amount feed rows.

**Sidebar anatomy** (`src/components/layout/`):
- `app-sidebar.tsx` = `Sidebar` + `SidebarHeader` (`TeamSwitcher` workspace dropdown) +
  `SidebarContent` (`sidebarData.navGroups.map(NavGroup)`) + `SidebarFooter` (`NavUser`) + `SidebarRail`.
  `collapsible`/`variant` come from `useLayout()`.
- `ui/sidebar.tsx` API: `variant: 'sidebar' | 'floating' | 'inset'`, `collapsible: 'offcanvas' | 'icon' | 'none'`,
  widths `16rem` / `3rem` (icon), cookie `sidebar_state`, keyboard shortcut **`b`**.
- `nav-group.tsx`: `SidebarGroup` + `SidebarGroupLabel` + `SidebarMenu`;
  three render modes — `SidebarMenuLink` (leaf, `isActive` + `tooltip`),
  `SidebarMenuCollapsible` (`Collapsible` + `SidebarMenuSub` + rotating `ChevronRight`, default-open when
  a child matches the URL), and `SidebarMenuCollapsedDropdown` (icon-rail mode: children fly out in a
  `DropdownMenu` at `side='right'`).
  Active state is one helper — `checkIsActive(href, item, mainNav)` — matching exact pathname,
  path without query, any child URL, or first path segment for parent groups.
  Badges: `NavBadge` renders `<Badge className='rounded-full px-1 py-0 text-xs'>` (unread tickets,
  expired users — useful for "12 expiring today").
- `data/sidebar-data.ts` is a typed `SidebarData` literal (`teams`, `user`, `navGroups[] → items[]`
  with `title/url/icon/badge/items`): the whole menu is data, so we can generate it from backend
  permissions.
- Extra patterns: `TeamSwitcher` (server/tenant switcher), `command-menu.tsx` (⌘K), `top-nav.tsx`
  (secondary tab row in header), `config-drawer.tsx` (layout/theme/direction live settings).

**Table toolbar anatomy** (`src/components/data-table/`):
- `toolbar.tsx` — one search `Input` (per-column `searchKey` or `globalFilter`), a `filters[]` prop
  (`{columnId, title, options}`) mapped to faceted filters, a `Reset` ghost button with `X` icon shown
  only when `isFiltered`, and `DataTableViewOptions` on the right.
- `faceted-filter.tsx` — `Popover` + `Command` (searchable) + checkbox tiles; shows selected values as
  `Badge`s on the trigger, collapses to "N selected" past 2, and shows **live facet counts** from
  `column.getFacetedUniqueValues()` on the right of each option. Has a "Clear filters" row.
- `view-options.tsx` — "View" dropdown of `DropdownMenuCheckboxItem`s over
  `table.getAllColumns().filter(c => c.getCanHide())` → **column visibility**.
- `bulk-actions.tsx` — floating bar over `table.getFilteredSelectedRowModel().rows` with
  `entityName` ("3 users selected"), screen-reader announcement via `queueMicrotask`, keyboard
  handling, clear-selection. Rendered by each feature with its own action buttons.
- `pagination.tsx` — page-size `Select`, "Page X of Y", first/prev/next/last, `getPageNumbers()`.
- `column-header.tsx` — sort toggle (`ArrowUpDown`/`ArrowUp`/`ArrowDown`) for sortable headers.
- Wiring example `src/features/users/components/users-table.tsx`: `useTableUrlState({ search, navigate,
  columnFilters: [{ columnId:'username', type:'string' }, { columnId:'status', type:'array' },
  { columnId:'role', type:'array' }], pagination: { defaultPageSize: 10 } })` +
  `getFacetedRowModel`/`getFacetedUniqueValues` → filters and page live in the URL (shareable links).
  `users-columns.tsx` defines `meta.className` for column widths/nowrap; feature also ships
  `users-primary-buttons.tsx` (Invite), `data-table-row-actions.tsx` (row menu),
  `users-invite-dialog.tsx`, `users-multi-delete-dialog.tsx`, `confirm-dialog.tsx`.

**Verdict:** fork it. It is our stack, MIT, RTL-proven, and its data-table package is exactly the
"users page" we are missing. Gaps to fill ourselves: no i18n framework (direction ≠ translation),
no date-range/slider filters, no saved views, no live-metric widgets.

---

### 3.2 `shadcnstore/shadcn-dashboard-landing-template` — MIT — the widget catalogue

Monorepo: `vite-version/` and `nextjs-version/` side by side — **use `vite-version/`**. Verified deps:
`vite ^8.3.3`, `react ^19.3.0`, `react-router-dom ^7.18.4`, `@tailwindcss/vite ^4.3.3`,
`@tanstack/react-table`, `recharts 3.10.1`, `shadcn` CLI 4.21.4, RHF + zod.

**Two dashboards** (`vite-version/src/app/`):
- `dashboard/` — `components/section-cards.tsx` (4 KPI cards: `CardDescription` label,
  `CardTitle` value with `tabular-nums`, `CardAction` + `Badge` with `TrendingUp/TrendingDown`,
  `CardFooter` with a "Trending up this month / Visitors for the last 6 months" two-line explanation;
  cards are `@container` and use `*:data-[slot=card]:bg-gradient-to-t` for a subtle gradient),
  `components/chart-area-interactive.tsx` (interactive area chart), `components/data-table.tsx`.
- `dashboard-2/` — 8 separate widgets, each its own component:
  `metrics-overview.tsx` (4 KPI cards with icon, delta badge, footer+subfooter text),
  `revenue-breakdown.tsx`, `sales-chart.tsx`, `top-products.tsx` (ranked list with bars),
  `recent-transactions.tsx` (table-style feed), `customer-insights.tsx` (segments/demographics),
  `quick-actions.tsx`, `dashboard-header.tsx` (date-range + export controls).
- Bonus non-dashboard pages worth copying for "nodes/hosts/services": `calendar/` (with
  `calendar-sidebar.tsx`, `use-calendar.ts`), `kanban/`, `chat/`, `tasks/` — all Vite + shadcn.

**Verdict:** legally and technically the easiest source of "more dashboard statistics". Copy
`section-cards.tsx`, `metrics-overview.tsx`, `top-products.tsx`, `recent-transactions.tsx`,
`revenue-breakdown.tsx` and re-map the data to nodes/traffic/users. No RTL work is done here, so
its `ps-*/me-*` usage is inconsistent — audit before shipping in Persian.

---

### 3.3 `Kiranism/next-shadcn-dashboard-starter` — MIT — filters/table architecture (Next, port the components)

**The filter system is the most reusable thing here** (`src/components/ui/table/`):
- `data-table-toolbar.tsx` — `role='toolbar'`; instead of hardcoding filter widgets it maps
  `table.getAllColumns().filter(c => c.getCanFilter())` and switches on `column.columnDef.meta.variant`:
  `text | number | range | date | dateRange | select | multiSelect`. Adding a filter = adding
  `meta: { variant, label, placeholder, unit, options }` to a column def. This is the pattern I'd adopt
  for our users page (status / plan / node / expiry / used-traffic).
- `data-table-date-filter.tsx` — calendar popover for `date` and `dateRange` (expiry windows,
  signup cohorts). `data-table-slider-filter.tsx` — **range slider** (used traffic GB, days left).
  `data-table-faceted-filter.tsx` (same Command+Popover approach as shadcn-admin, with `multiple` prop),
  `data-table-filter-clear.tsx`, `data-table-column-header.tsx`, `data-table-view-options.tsx`,
  `data-table-pagination.tsx`, `data-table-skeleton.tsx`.
- `data-table.tsx` — sticky header (`bg-muted sticky top-0 z-10`), `ScrollArea`, **column pinning** via
  `getCommonPinningStyles` (`src/lib/data-table.ts`), `actionBar?: ReactNode` slot for bulk actions.
- URL state via **nuqs** (`nuqs ^2.8.9`), `shallow: true` for client-side instant updates; the
  overview page uses Next parallel routes (`@area_stats`, `@bar_stats`, `@pie_stats`, `@sales`) each
  with its own `loading.tsx` / `error.tsx` — Next-only, skip it, but copy the idea of giving each
  dashboard widget its own loading/empty/error state.
- Dashboard pieces: `src/features/overview/components/{area-graph,bar-graph,pie-graph,recent-sales}.tsx`;
  forms (`src/components/forms/fields/*` — combobox, tags, date-picker, otp…), kanban, notifications
  center, `kbar` command palette.

**Caveats:** Next 16 + Clerk + Base UI primitives; `"use client"` and `<Link>` from `next/link` appear
throughout — strip on port. MIT so the code is fair game.

---

### 3.4 `TailAdmin/free-react-tailwind-admin-dashboard` — MIT — widget categories (no shadcn)

`src/components/` — every dashboard widget is a standalone component, easy to lift:
- `ecommerce/EcommerceMetrics.tsx` — KPI tile: 48px icon tile, label, `text-title-sm` value, colored
  `Badge` with `ArrowUpIcon`/`ArrowDownIcon` + %.
- `ecommerce/MonthlySalesChart.tsx` + `StatisticsChart.tsx` — ApexCharts line/bar area charts.
- `ecommerce/MonthlyTarget.tsx` — **radial gauge** (`type: 'radialBar'`, `hollow.size: '80%'`,
  `startAngle: -90, endAngle: 90`, big centered value) → ideal for CPU/RAM/disk utilisation.
- `ecommerce/RecentOrders.tsx` — dense orders table (status pills, avatars, amounts).
- `ecommerce/DemographicCard.tsx` + `CountryMap.tsx` — geo/segment breakdown + map → "nodes by country".
- `charts/{bar/BarChartOne,line/LineChartOne}.tsx`, `common/ChartTab.tsx` (7d/30d/90d switch),
  `tables/BasicTables/BasicTableOne.tsx`, `header/{NotificationDropdown,UserDropdown}.tsx`,
  `ui/{badge,dropdown,button,alert,avatar}/*` (own primitives, not shadcn).
- i18n already wired with **react-i18next** (`useTranslation('common', { keyPrefix: … })`) — useful
  precedent for our fa/en split, though it has no RTL layout handling.

**Caveats:** no TanStack Table (tables are hand-rolled markup), no shadcn, no routing abstractions
(it's a demo config). MIT → copy components, but restyle to our tokens; do not copy its palette.

---

## 4. RTL / Persian implementation notes (verified sources)

- **shadcn-admin** is the only full admin app with a working direction switch: `DirectionProvider`
  (Radix `@radix-ui/react-direction`) + `html[dir]` + cookie persistence + the 10-component patch list.
  Use this as the reference implementation; it proves shadcn/ui is usable in RTL with targeted patches.
- **FarsiUI** (`apps/v4` shadcn-style registry, MIT): Persian digits, **Jalali/Shamsi date picker**
  (needed for expiry/`expire_at` columns), Persian form patterns (national ID, card, Sheba), RTL-first
  spacing. Caveat: Tailwind **3.4** based (`tailwindcss ^3.4.18`), while our stack is Tailwind 4 —
  port the components, re-check `tailwind-merge`/utility names, and don't expect a dashboard app.
- **Tabler**: "every stylesheet ships in an RTL version" and `.rtl` builds of all CSS — the cleanest
  reference for flipping *charts, tables, and nav* at the CSS layer (Bootstrap, so CSS-only reference).
- **AdminLTE 4**: README advertises "Bootstrap 5.3, dark mode, RTL" and a dedicated "RTL Support"
  docs page; useful as a visual/layout benchmark only.
- **Materio free**: RTL is a **premium-only** feature — the MIT repo's feature table has `-` for
  "RTL (right-to-left) support". Don't cite it as an RTL source.
- Practical checklist for us: `dir="rtl"` + `lang="fa"` on `<html>`, `Vazirmatn` (or IRANSansX) as
  `--font-sans`, Persian digits via `Intl.NumberFormat('fa-IR')` at the display layer only, Jalali
  dates at the display layer (store UTC/ISO), icon mirroring only for directional icons
  (`rtl:rotate-180`), and chart Y-axis pinned `direction='ltr'` (shadcn-admin does exactly this).

---

## 5. What our dashboard is missing, borrowed from these

Actionable checklist — each item names the source that does it best (path to look at).

| # | Missing today | What to build | Borrow from |
|---|---------------|---------------|-------------|
| 1 | Too few stats | **KPI stat-card row** (label, big value, ±delta badge, one-line explanation footer) — 4–6 cards: active users, online now, expired today, total traffic, nodes up, bandwidth | `shadcnstore` `vite-version/src/app/dashboard/components/section-cards.tsx`; `dashboard-2/components/metrics-overview.tsx` |
| 2 | No trend at a glance | **Sparkline inside each KPI card** (7/30-day series, no axes) | `tremor` `src/components/SparkChart/SparkChart.tsx` |
| 3 | No resource gauges | **Radial gauge** for CPU / RAM / disk / per-node load | `TailAdmin` `src/components/ecommerce/MonthlyTarget.tsx` (ApexCharts `radialBar`) |
| 4 | No live traffic view | **Area chart with 1h/24h/7d/30d tab switch** + last-updated timestamp | `TailAdmin` `common/ChartTab.tsx` + `StatisticsChart.tsx`; `shadcn-admin` `analytics-chart.tsx` |
| 5 | No breakdowns | **Ranked bar-list** (top nodes / protocols / countries, inline `%` bars, `tabular-nums`) — no chart lib needed | `shadcn-admin` `features/dashboard/components/analytics.tsx` (`SimpleBarList`) |
| 6 | No activity feed | **Recent activity list** (avatar/icon, actor, target, amount/status, time) | `shadcn-admin` `recent-sales.tsx`; `TailAdmin` `RecentOrders.tsx` |
| 7 | No geo view | **Map/segment card** for nodes & users by region | `TailAdmin` `CountryMap.tsx` + `DemographicCard.tsx` |
| 8 | Thin user filters | **Faceted filters with live counts** (status/plan/node), multi-select, searchable, removable chips | `shadcn-admin` `components/data-table/faceted-filter.tsx`; `Kiranism` `data-table-faceted-filter.tsx` |
| 9 | No date filtering | **Date + date-range filter** (expiry window, signup cohort) | `Kiranism` `src/components/ui/table/data-table-date-filter.tsx` |
| 10 | No numeric filtering | **Range slider filter** (used traffic GB, days remaining, data limit) | `Kiranism` `src/components/ui/table/data-table-slider-filter.tsx` |
| 11 | Filters not shareable | **URL-synced table state** (q, filters, page, sort in query string) so an operator can send a filtered view | `shadcn-admin` `src/hooks/use-table-url-state.ts`; `Kiranism` (nuqs) |
| 12 | Fixed columns only | **Column visibility + density + reset** ("View" menu) | `shadcn-admin` `components/data-table/view-options.tsx`; `ant-design-pro` ProTable column settings |
| 13 | No bulk ops UX | **Floating bulk-action bar** with selection count, a11y announcement, and bulk actions (extend expiry, disable, move node) | `shadcn-admin` `components/data-table/bulk-actions.tsx` |
| 14 | No saved views | **Saved/personal filter presets** persisted per user ("Expiring in 3 days on node DE-1") | `marmelab/react-admin` — `SavedQueriesList` + `FilterList` chips (concept; re-implement in Tailwind) |
| 15 | Weak sidebar | **Grouped, collapsible sidebar with badges + icon-rail flyout** (and ⌘K palette) | `shadcn-admin` `components/layout/nav-group.tsx`, `ui/sidebar.tsx`, `command-menu.tsx` |
| 16 | No layout control | **Sidebar variants** (inset/floating) + keyboard toggle `b` + persisted state | `shadcn-admin` `ui/sidebar.tsx` (`variant`, `collapsible`, cookie) |
| 17 | RTL/Persian gaps | **DirectionProvider + logical utilities + Jalali date picker + Persian digits** | `shadcn-admin` `context/direction-provider.tsx`; `FarsiUI` (Jalali, fa digits) |
| 18 | Empty/loading states | **Table skeletons + per-widget loading/error states** | `Kiranism` `data-table-skeleton.tsx`; parallel-route `loading.tsx`/`error.tsx` pattern |

Also worth adopting (cheap wins): row quick-action menu + confirm dialog before destructive actions
(`shadcn-admin` `data-table-row-actions.tsx`, `confirm-dialog.tsx`), command palette global search
(`command-menu.tsx`), and a header breadcrumb/tab row (`top-nav.tsx`).

---

## 6. Recommended adoption plan (short)

1. **Fork `satnaing/shadcn-admin`** (MIT) — it is the only repo matching React+Vite+Tailwind+shadcn
   *and* having an RTL implementation + data-table + sidebar system. Keep its `DirectionProvider`,
   `nav-group`, and `data-table/*`.
2. **Port the filter engine from `Kiranism`** (MIT): `column.columnDef.meta.variant` switch model,
   `data-table-date-filter`, `data-table-slider-filter`, sticky header + column pinning.
3. **Add dashboard widgets** by copying `shadcnstore` (cards/charts), `TailAdmin` (gauge, map,
   chart tab), `tremor` (sparklines). Re-map to VPN metrics: online users, bandwidth in/out,
   node health, expiring subscriptions, top protocols.
4. **Add saved-view UX** modelled on `react-admin` (`SavedQueriesList` + `FilterList`) implemented
   with our own API (`POST /saved-views`) since it is a product feature, not a UI one.
5. **RTL/Persian pass**: Vazirmatn, `Intl` fa digits, Jalali date picker from `FarsiUI`,
   mirrored chevrons, `direction='ltr'` on chart axes.

## 7. License caveats (read before copying)

- **Permissive — code may be copied/forked into our product:** MIT for #1–#4, #6–#12; Apache-2.0 for
  #5 (Tremor — keep the `NOTICE`/attribution requirements of Apache-2.0; it is still commercial-use
  friendly). MIT requires keeping the copyright/license notice. That's it.
- **No GPL/AGPL code in the shortlist.** If someone proposes a VPN-panel repo as a UI source:
  `Gozargah/Marzban` (backend FastAPI; dashboard = **React 18 + Vite + Chakra UI**, so also the wrong
  UI stack) is **AGPL-3.0** and `MHSanaei/3x-ui` is **GPL-3.0** (Go backend, non-React UI).
  → **reference only — do not copy code** into a proprietary panel; AGPL/GPL would force us to
  publish our source. Studying their *information architecture* (user rows, traffic columns,
  expiry badges) is fine; copying files is not.
- **"Free but not permissive" traps:** premium Next.js/MUI templates (Materio, Materio-family,
  Vuexy, etc.) ship a *free version* whose MIT repo may exclude the feature you actually want
  (Materio: RTL is premium-only). Always read the repo's own feature table, not the product page.
- **Attribution/asset traps even in MIT repos:** demo images, fonts and brand logos inside these
  templates are often not MIT. Use our own assets and fonts (Vazirmatn is SIL OFL — fine).
- Vendor demos (Netlify/Vercel) are not licenses: a repo with a live demo but no `LICENSE` file is
  "all rights reserved" by default. All 12 shortlisted repos have an explicit permissive license
  (checked via the GitHub license API, not the README badge).

---

*Star counts, licenses and push dates: GitHub REST API, 2026-10-20. Demo URLs: HTTP 200 on the same
date except `flowbite-admin-dashboard.vercel.app` (429 — unverified). Component paths quoted above
are from the default branches at that date and may move; search by filename if the tree changes.*

# dashboard-next

The rebuilt Rebecca dashboard: React 19 + TypeScript + Vite, Tailwind CSS v4, and
shadcn/ui components that live in this repository as source.

This directory is a parallel app. `../dashboard` (the current Chakra/Emotion
dashboard) is untouched and can be served at the same time, so pages can be
migrated one at a time behind the same API.

## Run it

```bash
npm install
npm run dev          # http://127.0.0.1:3100
```

In development the app never talks to the panel cross-origin: `/api/*` is proxied
to the target in `VITE_API_TARGET` (default `https://roverloom.com`). The proxy
rewrites the `Origin` header to the target's origin, which is what the Go
backend's same-origin guard on `POST /api/auth/*` expects. Session cookies stay
first-party, so sign-in works exactly as it does in production.

```bash
VITE_API_TARGET=https://roverloom.com npm run dev   # default
npm run mock                                        # ui-only, no backend needed
npm run build                                       # typecheck + production bundle
npm run test                                        # vitest
```

### Mock mode

`npm run mock` starts Vite with `VITE_MOCK_API=1`. A fetch interceptor
(`src/dev/mock-api.ts`) answers `/api/*` from fixtures — 137 users, admins,
nodes, hosts, services and system stats — so the interface can be developed and
reviewed without credentials. It is dead code in a production build.

Two query flags help design review: `?lang=fa` pins the language, `?theme=light`
pins the palette.

## What is already migrated

| Screen | Route | State |
|---|---|---|
| Sign in (+2FA/disabled states) | `/login` | done |
| Dashboard (live stats, CPU/memory/network sparklines, status mix) | `/` | done |
| Users (server paging/sort, faceted filters + chips, bulk actions, CSV export, column visibility) | `/users` | done |
| Admins (paging, role/status filters, budgets) | `/admins` | done |
| Hosts (grouped by inbound, client-side filter) | `/hosts` | done |
| Nodes (fleet health, CPU/memory pressure) | `/nodes` | done |
| Services (paging, usage, broken-host detection) | `/services` | done |
| Core settings | `/settings/core` | next phase |
| Integrations | `/settings/integrations` | next phase |
| Panel settings | `/settings` | next phase |

The two big screens — `CoreSettingsPage` (6,232 lines) and
`IntegrationSettingsPage` (4,055 lines) — are intentionally last. They render
links back to what exists instead of pretending to save settings.

## Architecture

```
src/
  components/         shared shell + data-table primitives (shadcn/ui in components/ui)
  features/<domain>/  one folder per screen: api.ts (queries), columns.tsx, page.tsx
  i18n/               i18next wiring; translations are the panel's existing JSON files
  lib/                api client, formatters, hooks
  types/api.ts        wire types transcribed from the Go structs
  dev/mock-api.ts     development fixtures
```

Conventions worth keeping:

- **Server state only through TanStack Query.** Query keys are per feature
  (`usersKeys.list(query)`), mutations invalidate the feature root.
- **Offset pagination, not page numbers.** The API speaks `offset`/`limit`; the
  URL carries the page index so a filtered table is a shareable link.
- **`sort` is the API's own dialect**: `field` ascending, `-field` descending,
  and only the fields each endpoint allows (`username`, `used_traffic`,
  `data_limit`, `expire`, `created_at` for users).
- **Numbers are isolated for RTL.** Use `<Num>` for anything that mixes Latin
  units with digits (`23.5 GB`), otherwise Persian renders `GB 23.5`.
- **Dates and digits are locale-driven** through `useFormat()`; Farsi gets Jalali
  dates and Persian digits from `Intl` with no extra dependency.
- **No hardcoded colours.** Everything resolves to the semantic tokens declared
  in `src/index.css`.

## Shell (ported from shadcn-admin)

The application shell follows [satnaing/shadcn-admin](https://github.com/satnaing/shadcn-admin)
(MIT) rather than a hand-rolled layout:

- `config/nav.ts` — declarative nav tree; parents with `items` render as
  collapsible groups and as flyout menus when the sidebar is an icon rail
  (`components/layout/nav-group.tsx`).
- `components/layout/app-title.tsx` / `nav-user.tsx` — brand block and the
  operator menu (theme, sidebar variant, sign out).
- `context/layout-provider.tsx` — sidebar `collapsible`/`variant`, persisted in a
  cookie, so `inset` / `classic` / `floating` survive a reload.
- `context/search-provider.tsx` + `components/command-menu.tsx` — ⌘K / Ctrl+K
  palette over nav, theme and language.
- `components/data-table/column-header.tsx` / `view-options.tsx` — the sort
  dropdown and column visibility menu from the same project.
- `components/layout/app-header.tsx` — sticky header that only gains its blur
  and hairline after scroll.

The previous hand-built shell is preserved for reference on the tag
`ui-custom-v1` (branch `feat/dashboard-next`).

## UI references

`docs/ui-references.md` is a verified shortlist of open-source admin dashboards we
borrow patterns from, with licenses and the exact widgets to copy. The shortlist
of record: [satnaing/shadcn-admin](https://github.com/satnaing/shadcn-admin) (MIT,
same stack and the only one with a working RTL implementation),
[shadcnstore dashboard](https://github.com/shadcnstore/shadcn-dashboard-landing-template)
(MIT, richest widget cards), [Kiranism's starter](https://github.com/Kiranism/next-shadcn-dashboard-starter)
(MIT, best filter architecture), [TailAdmin React](https://github.com/TailAdmin/free-react-tailwind-admin-dashboard)
(MIT, gauges and chart tabs), [FarsiUI](https://github.com/MiladJoodi/FarsiUI) (MIT, Persian primitives).
Marzban (AGPL-3.0) and 3x-ui (GPL-3.0) are reference-only: never copy their code.

## API contract

`docs/api-contract.md` documents every endpoint this dashboard consumes, read
directly from the Go handlers: query parameters, response envelopes, field
types, cookie transport, error shapes, and the compatibility traps (mixed
`online_at` formats, `limit` having no default, `/api/v2/services` being the only
services route, sudo-only `/api/nodes`). It is the reference for the remaining
screens — read it before adding a call.

# Rebecca HTTP API contract (for dashboard-next)

Read directly from the Go source. Nothing here is inferred from the old dashboard unless stated.
Base prefix: `/api`. Production: same origin as the panel. Dev: Vite proxies `/api` (see [Frontend implications](#frontend-implications)).

**Path legend:** a bare path like `users.go:589` means `internal/app/api/users.go`; `user/dto.go:86` means `internal/app/user/dto.go`; `nodecontroller/dto.go:199` means `internal/app/nodecontroller/dto.go`.

## 0. Conventions (apply everywhere)

| Topic | Rule | Source |
|---|---|---|
| Error body | Always `{"detail": "<string>"}` (JSON). No error code field, no nested errors. | `server.go:817` |
| Success content type | `application/json` for every endpoint in this document. `writeJSON` also encodes a trailing `\n`. | `server.go:811` |
| 401 | `{"detail":"Could not validate credentials"}` + header `WWW-Authenticate: Bearer`, for **every** auth failure (missing cookie, expired, revoked, pending-2FA session used on a protected route). | `middleware.go:178`, `admin/session.go:180` |
| 403 variants | `"You're not allowed"` (role/permission), `"Invalid request origin"` (same-origin guard), `"Viewing user traffic is disabled."`, `"Forbidden"` (self-permission checks). | `middleware.go:34`, `users.go:43` |
| 404 | `"not found"` (lowercase) from handlers that path-check, `"Not Found"` from the generic fallback, `"User not found"` from user reads. | `home.go:7`, `users.go:907` |
| 405 | `"method not allowed"`. | e.g. `users.go:30` |
| Unknown `/api/*` path | Falls through to the subscription handler → 404 `{"detail":"Not Found"}` (GET) / 405 (non-GET). | `home.go:7`, `subscriptions.go:22` |
| Request body limit | 8 MiB default; `/api/settings/backup/import` unlimited. | `routes.go:12-31` |
| Bytes | All traffic/size numbers are **bytes** (`int64`), never humanized. | `user/dto.go:90` etc. |
| Unix times | `expire` and `on_hold_expire_duration` are **unix seconds** (`int64`), not ms; history samples use `timestamp` in unix seconds. | `user/dto.go:127,137`, `system/types.go:14` |
| String timestamps | `created_at` etc. are **RFC3339Nano UTC strings** (e.g. `2026-10-20T12:34:56.123456789Z`). See §2.5 for the one mixed field. | `user/users_list.go:841` |
| Nullability | Go `*T` (nullable) fields serialize as JSON `null` unless the tag has `omitempty`; `omitempty` fields are **absent**. Both cases are called out per field. | struct tags |

CSRF/same-origin guard: every non-GET request authenticated by **cookie** requires `Origin` (or `Referer`) whose host matches the request `Host`/`X-Forwarded-Host`; otherwise 403 `"Invalid request origin"`. GET/HEAD/OPTIONS are exempt. Bearer/API-key calls are exempt. Auth routes (`/auth/login`, `/auth/logout`, `/auth/2fa*`) enforce it before auth. (`middleware.go:95-133`)

---

## 1. Auth & session

Routes: `routes.go:102-110`. Handlers: `admin_session.go`.

| Endpoint | Auth | Success | Body |
|---|---|---|---|
| `POST /api/auth/login` | none (+same-origin) | 200 | `AuthSession` (below) + `Set-Cookie` |
| `GET /api/auth/session` | cookie (any live state) | 200 | `AuthSession` |
| `POST /api/auth/logout` | cookie (optional) | **204, empty body** | — (revokes session, clears cookie) |
| `POST /api/auth/2fa/verify` | cookie in `pending_2fa` | 200 | `AuthSession` (state `active`) |
| `POST /api/auth/2fa/setup` | cookie in `active` or `setup_required` | 200 | `{"secret": string, "uri": string}` |
| `POST /api/auth/2fa/confirm` | cookie with a pending TOTP secret | 200 | `AuthSession` (state `active`) |
| `DELETE /api/auth/2fa` | cookie, `active` session | 200 | `AuthSession` |
| `GET /api/auth/sessions` | cookie, `active` session | 200 | `{"sessions": AdminSession[]}` |
| `DELETE /api/auth/sessions/{id}` | cookie, `active` session | **204** | — |
| `POST /api/admin/token` (aliases `/api/admin/token`, `/admin/token`) | none | 200 | JWT `{"access_token": string, "token_type": "bearer"}` (legacy path; not needed by the SPA) |

### 1.1 `POST /api/auth/login`

Body (`admin_auth.go:15,193`): accepts JSON **or** form-urlencoded **or** multipart.

| Field | Type | Notes |
|---|---|---|
| `username` | string | required, trimmed; lookup is **case-insensitive** and excludes `status = deleted` (`admin/repository.go:43-49`); empty → 401 |
| `password` | string | required |

Login state machine (`admin_session.go:69-78`, `admin_auth.go:168-177`):

| Condition | HTTP | Result |
|---|---|---|
| bad username / bad password / status `deleted` / admin expired / admin traffic limit exhausted | 401 | `{"detail":"Incorrect username or password"}`, `WWW-Authenticate: Bearer`. **All indistinguishable on purpose.** |
| rate-limited (5 failures per 5 min per IP+username) | 429 | `{"detail":"too many login attempts; try again later"}` + `Retry-After: 300` (window seconds) (`login_rate_limit.go:12-13,98-101`) |
| admin `status == disabled`, password OK | **200** | session created with `state:"disabled"`, `Set-Cookie` issued. Every protected call then 401s; only `state` reveals why. |
| `totp_enabled == true` | 200 | `state:"pending_2fa"`, cookie lifetime **5 minutes** |
| `require_2fa == true`, TOTP not enabled | 200 | `state:"setup_required"`, cookie lifetime 90 days |
| otherwise | 200 | `state:"active"`, cookie lifetime 90 days |

### 1.2 Session transport (exact)

| Property | Value |
|---|---|
| Cookie name | `rebecca_session` (`admin_session.go:20`) |
| Value | opaque 32-byte token, base64url; server stores only its SHA-256 |
| Path | `/` |
| HttpOnly | `true` — **not readable from JS** |
| Secure | `true` only when the request is TLS or `X-Forwarded-Proto: https` (`admin_session.go:611`) |
| SameSite | `Lax` |
| Expiry | `Expires` = session expiry, `MaxAge` = seconds remaining (min 1) |
| Lifetimes | active/setup_required/disabled = 90 days; pending_2fa = 5 minutes (`admin_session.go:21-22`) |
| Bearer alternative | `Authorization: Bearer <admin JWT or API key>`, or `?token=` query param (`middleware.go:158`) — the SPA does not need this |

There is **no** CSRF token and no token in the login response body. The frontend must rely on the cookie: use `credentials: "include"` (or same-origin fetch), and derive auth state only from `/api/auth/session` + status codes.

### 1.3 `AuthSession` response object

`admin_session.go:563` (map, not a struct — tags are the map keys):

| Field | Type | Notes |
|---|---|---|
| `state` | `"active" \| "pending_2fa" \| "setup_required" \| "disabled"` | forced to `disabled` when the admin record is disabled (`:566`) |
| `admin` | Admin object | see §3.1 (same shape as `/api/admin`) |
| `permissions_version` | string | 16 lowercase hex chars = first 8 bytes of SHA-256 over `{"role":…,"permissions":…}`; changes when role/permissions change → use it as a permissions cache key |
| `totp_enabled` | boolean | |
| `require_2fa` | boolean | panel requires 2FA for this admin |

`GET /api/auth/session` returns the same object for **any** live session state, including `pending_2fa`, `setup_required`, `disabled`. It 401s + clears the cookie when the session is expired/revoked or the admin is deleted (`admin_session.go:99-115`). A temporarily failing DB yields 503 `{"detail":"session check is temporarily unavailable"}`.

Gate: every data route documented in this file is wrapped in `requireAdmin` (or `requireSudo`) → `AuthenticateSession` → requires `state == "active"` and passing `ValidateAuthAllowed`; anything else is 401 (`admin/session.go:180-192`).

### 1.4 2FA endpoints

| Endpoint | Body | Errors |
|---|---|---|
| `POST /api/auth/2fa/verify` | `{"code": string}` | 401 `"Could not validate credentials"` if the session isn't `pending_2fa`/disabled; 401 `"Invalid authentication code"`; 401 `"Authentication code was already used"` (TOTP replay); 429 `"Too many invalid codes"` after 5 failures (session revoked, cookie cleared) (`admin_session.go:117-178`) |
| `POST /api/auth/2fa/setup` | — (empty) | 409 `"Two-factor authentication is already enabled"`; 401 if state is `pending_2fa`; 403 `"Forbidden"` if an `active` session lacks self-permission `self_2fa`. Response `{"secret","uri"}` (uri is an `otpauth://` URL) (`:383-407`) |
| `POST /api/auth/2fa/confirm` | `{"code": string}` | 400 `"Start two-factor setup first"`; 401 `"Invalid authentication code"`. On success all other sessions are revoked and this session becomes `active` (`:409-457`) |
| `DELETE /api/auth/2fa` | `{"password": string, "code": string}` | 404/401 style auth errors first; 403 `"Forbidden"` if the session lacks self-permission `self_2fa`; 401 `"Incorrect password"`; 400 `"Two-factor authentication is not enabled"`; 401 `"Invalid authentication code"`. Returns `AuthSession`; state becomes `setup_required` when the panel still requires 2FA (`:459-512`) |

`AdminSession` JSON (`admin/session.go:23-35`): `id:number`, `admin_id:number`, `state:string`, `created_at:string` (RFC3339), `last_seen_at:string`, `expires_at:string`, `ip_address:string`, `user_agent:string`, `current?:boolean`.

`DELETE /api/auth/sessions/{id}`: deleting a session other than the current one from a device younger than 24 h → 403 (`"A new device must wait 24 hours after login before changing the password or logging out other devices"`, `:514-524`); unknown id → 404 `"Session not found"`.

### 1.5 What the frontend must do

1. `POST /auth/login` with `{username,password}`; branch on `state`: `active` → app, `pending_2fa` → code screen (cookie only lasts 5 min), `setup_required` → TOTP enrollment (`setup` → `confirm`), `disabled` → "account disabled" screen.
2. Never store a token; send cookies. On any 401 from a protected call, call `GET /auth/session`: 200 → resume per `state`; 401 → login screen.
3. After `permissions_version` changes, refetch/refresh the cached permission set (menu visibility etc.).
4. `POST /auth/logout` returns 204 with no JSON — do not try to parse a body.

---

## 2. Users

Routes `routes.go:210-219`. Handlers `users.go`; DTOs `user/dto.go`, `user/mutation_dto.go`.

### 2.1 `GET /api/users`

All params are optional and read from `r.URL.Query()` (`users.go:589-642`). Repeated params are accepted; most may also be comma-separated because the handler splits on commas (`users.go:791-802`).

| Param | Type | Default | Meaning / exact behavior |
|---|---|---|---|
| `offset` | int ≥ 0 | none | SQL `OFFSET`. Invalid/negative → 400 `"invalid offset"`. With `offset` but no `limit`, server uses `LIMIT 9223372036854775807` (`user/users_list.go:365-375`). |
| `limit` | int ≥ 0 | none | SQL `LIMIT`. **No server-side default** — omitting it returns *all* matching users. Invalid/negative → 400 `"invalid limit"`. `limit=0` returns 0 rows. |
| `username` | string[] | none | Exact username IN (...). Repeatable/comma-separated. |
| `search` | string | none | Broad search over username, subscription_token, note, credential_key, telegram_id, contact_number, numeric `#id`, subscription link/UUID/password fragments (`user/users_list.go:582-657`). |
| `match_case` | bool | false | `1/true/yes/on` vs `0/false/no/off`; other value → 400 `"invalid match_case"` (`users.go:734-747`). |
| `match_whole_word` | bool | false | Same parsing; → 400 `"invalid match_whole_word"`. |
| `admin` | string[] | none | Owner filter by admin **username**, repeatable/comma-separated. **Ignored for non-global (standard/reseller) admins**, who always see only their own users (`users.go:621-624`, `user/users_list.go:212-216`). NB: the bundled OpenAPI file documents `owner` — the handler does **not** read `owner`. |
| `status` | string | none | Exact status match: `active`, `disabled`, `limited`, `expired`, `on_hold`. Not validated: unknown value → empty result. `deleted` is always excluded globally (`user/users_list.go:199-208`). |
| `service_id` | int | none | Filter by service id. Invalid → 400 `"invalid service_id"`. |
| `sort` | string[] | none | Repeatable and/or comma-separated; `-` prefix = desc. **Whitelist is only** `username`, `used_traffic`, `data_limit`, `expire`, `created_at` (`users.go:749-781`); anything else → 400 `"\"<x>\" is not a valid sort option"`. `used_traffic` requires traffic visibility → 403 `"Viewing user traffic is disabled."`. No `sort` → `ORDER BY u.created_at DESC, u.id DESC` (`user/users_list.go:22,480-515`). |
| `filter` / `filters` | string[] | none | Advanced filters, see §2.2. `filter` wins if both present. |
| `links` | bool | false | `true` adds generated config links (`links[]`, expensive). `subscription_url`/`subscription_urls` are computed **regardless**. Invalid → 400 `"invalid links"`. |

### 2.2 Advanced filter values (`filter=`)

`user/users_list.go:534-580`, plus `top_speed` handled in `user_speed.go:148`. Unknown values are silently ignored. Match is case-insensitive.

| Value | Effect |
|---|---|
| `online` | user currently online (xray IPs, VPN sessions or presence within 20 s) |
| `offline` | negation of the above |
| `finished` | status IN (`limited`,`expired`) |
| `limit` | `data_limit IS NOT NULL AND data_limit > 0` |
| `unlimited` | `data_limit IS NULL OR data_limit = 0` |
| `expired` / `limited` / `disabled` / `on_hold` | adds that status to an `IN (...)` |
| `sub_not_updated` | last subscription fetch is NULL or older than 24 h |
| `sub_never_updated` | never fetched a subscription |
| `top_speed` | special: restricted to the **single fastest currently-online user** (or none). `count`/`total` therefore is 0 or 1. |

### 2.3 `GET /api/users` response envelope

`user/dto.go:107-116`, built at `user/users_list.go:124-194`, then sanitized at `users.go:842-855`.

```json
{
  "users": [ /* UserListItem[] */ ],
  "link_templates": {},
  "total": 42,
  "active_total": 7,
  "users_limit": 100,
  "status_breakdown": { "active": 10, "limited": 2 },
  "usage_total": 123456789,
  "online_total": 3
}
```

| Field | Type | Notes |
|---|---|---|
| `users` | UserListItem[] | see §2.4 |
| `link_templates` | `Record<string,string[]>` | **always `{}`** (deprecated; `user/users_list.go:188`) |
| `total` | number | count of all rows matching the filters (ignores limit/offset) |
| `active_total` | number, **omitted** | only for non-global admins; count of `status == active` owned by them (`user/users_list.go:517-532`, only when `admin.id` is set) |
| `users_limit` | number, **omitted** | only for non-global admins that have a users limit (`users.go:69-71`) |
| `status_breakdown` | `Record<string,number>` | keys are statuses actually present; `deleted` never appears |
| `usage_total` | number, **omitted** | sum of used + historically reset traffic; omitted when the admin may not see traffic |
| `online_total` | number | count of currently-online matching users (always present) |

### 2.4 `UserListItem` (element of `users[]`)

`user/dto.go:86-105` + row scan `user/users_list.go:334-441`.

| Field | Type | Nullable | Notes |
|---|---|---|---|
| `id` | number | no | DB user id |
| `username` | string | no | |
| `status` | string | no | `active \| disabled \| limited \| expired \| on_hold` (`user/mutation_dto.go:7-14`); `deleted` rows are filtered out |
| `used_traffic` | number | no | bytes since last reset; zeroed when the admin may not see traffic |
| `lifetime_used_traffic` | number | no | bytes including pre-reset history; zeroed likewise |
| `created_at` | string | no | RFC3339Nano UTC |
| `expire` | number\|null | yes | unix seconds; `null` = never expires |
| `data_limit` | number\|null | yes | bytes; `null`/0 = unlimited |
| `data_limit_reset_strategy` | string, **absent** if empty | omitempty | `no_reset \| day \| week \| month \| year` |
| `online_at` | string\|null | yes | **mixed format, see §2.5** |
| `is_online` | boolean | no | authoritative online flag |
| `service_id` | number\|null | yes | |
| `service_name` | string\|null | yes | |
| `admin_id` | number\|null | yes | owner admin id |
| `admin_username` | string\|null | yes | |
| `links` | string[] | no | `[]` unless `links=true` |
| `subscription_url` | string | no | primary subscription URL, built from the request origin (`X-Forwarded-*` aware) |
| `subscription_urls` | `Record<string,string>` | no | all non-primary URLs, keyed by client type (`key`, `clash`, `v2ray`, …); order-preserving on the wire, not guaranteed after JSON parse |

### 2.5 Timestamp formats — exact

| Field | On SQLite (the default DB) | On MySQL |
|---|---|---|
| `created_at` (list & detail) | RFC3339Nano (`time.Time` → `dbTimeString`) | RFC3339Nano |
| `sub_updated_at` | RFC3339Nano (scalar subquery on a DATETIME column) | RFC3339Nano |
| `online_at` **when online** | **`"YYYY-MM-DD HH:MM:SS"`** (the query returns `CURRENT_TIMESTAMP`; SQLite reports that expression as TEXT, so it is passed through verbatim) | likely RFC3339Nano, **unverified** |
| `online_at` **when offline** | RFC3339Nano (subquery yields `time.Time`) | RFC3339Nano |

Evidence: `user/users_list.go:354-355,386-423,841-854`; column types `internal/app/migrations/000002_users_proxies_hosts_schema.go:32`; drivers `internal/platform/db/db.go:14,134-151`. The SQLite branch was verified empirically (same query against modernc.org/sqlite v1.54.0: `CASE` → `string`, subquery → `time.Time`). **Parse `online_at` defensively** (accept both formats); use `is_online` for logic and the timestamp only for display.

### 2.6 `GET /api/user/{username}` — user detail

`users.go:199-223` → `user/user_get.go:12-135`, struct `user/dto.go:118-157`.

Warning: `UserDetail.ID` is tagged `json:"-"` — **the detail response has no `id` field** (only mutations fall back to an object with `id`).

| Field | Type | Nullable | Notes |
|---|---|---|---|
| `username` | string | no | |
| `credential_key` | string, **absent** if empty | omitempty | |
| `key_subscription_url` | string, **absent** if empty | omitempty | set only when a credential key exists |
| `status` | string | no | |
| `used_traffic`, `lifetime_used_traffic` | number | no | bytes; zeroed when traffic is hidden |
| `created_at` | string | no | RFC3339Nano |
| `expire` | number\|null | yes | unix seconds |
| `data_limit` | number\|null | yes | bytes |
| `data_limit_reset_strategy` | string, absent if empty | omitempty | enum as above |
| `flow` | string\|null | yes | legacy per-user flow; service flow is authoritative |
| `note` | string\|null | yes | max 500 chars |
| `telegram_id` | string\|null | yes | **string**, not number |
| `contact_number` | string\|null | yes | |
| `sub_updated_at` | string\|null | yes | RFC3339Nano |
| `sub_last_user_agent` | string\|null | yes | |
| `online_at` | string\|null | yes | mixed format, §2.5 |
| `on_hold_expire_duration` | number\|null | yes | seconds |
| `on_hold_timeout` | string\|null | yes | RFC3339Nano |
| `ip_limit` | number | no | 0 = unlimited |
| `speed_limit_kbps` | number | no | kbit/s, 0 = unlimited |
| `auto_delete_in_days` | number\|null | yes | |
| `subadress` | string, absent if empty | omitempty | custom subscription path fragment |
| `service_id` | number\|null | yes | |
| `service_name` | string\|null | yes | |
| `admin_id` | number\|null | yes | |
| `admin_username` | string\|null | yes | |
| `proxies` | `Record<string, Record<string, any>>` | no | protocol → settings (`vmess`, `vless`, `trojan`, `shadowsocks`) |
| `excluded_inbounds` | `Record<string, string[]>` | no | always `{}` in current code (`user/user_get.go:27`) |
| `inbounds` | `Record<string, string[]>` | no | always `{}` in current code (`user/user_get.go:37`) — inbound selection moved to services |
| `next_plans` | NextPlan[] | no | `[]` when none |
| `links` | string[] | no | generated config links |
| `subscription_url` | string | no | |
| `subscription_urls` | `Record<string,string>` | no | |
| `service_host_orders` | `Record<string, number>` | no | host-id → order map, `{}` when no service |
| `credentials` | — | **absent** | declared but never populated → always omitted (`user/dto.go:155`) |
| `link_data` | — | **absent** | declared but never populated → always omitted (`user/dto.go:156`) |

`NextPlan` (`user/dto.go:241-252`): `id:number`, `user_id:number`, `position:number`, `data_limit:number` (bytes, 0 = unlimited), `expire:number|null` (unix), `add_remaining_traffic:boolean`, `fire_on_either:boolean`, `increase_data_limit:boolean`, `start_on_first_connect:boolean`, `trigger_on:string`.

Not-found handling (`user/user_get.go:208-217`): exact username first, then case-insensitive; both miss → 404 `"User not found"`. Access check by owner → 403 `"You're not allowed"` (`users.go:907-918`).

### 2.7 `POST /api/user` (create; `POST /api/v2/users` is the same handler)

`users.go:336-360` → `user/service.go:137-183`; payload `user/mutation_dto.go:87-91`.

| Field | Type | Required | Notes |
|---|---|---|---|
| `username` | string | **yes** | 3–32 chars, `^[a-zA-Z0-9._@-]+$`, else 400 `"Username only can be 3 to 32 characters and contain a-z, 0-9, underscores, hyphens, dots, or @."` (`user/validation.go:10,312-317`) |
| `service_id` | number | **effectively yes** | either sent explicitly, or auto-detected from `inbounds` (`service.go:164-179`). Missing/unresolvable → 400 `"service_id is required. Users must be assigned to a service."` |
| `status` | `"active" \| "on_hold"` | no (default `active`) | only these two accepted at create (`user/mutation_dto.go:16-21`) |
| `expire` | number\|null | no | unix seconds |
| `data_limit` | number\|null | no | bytes, ≥ 0 |
| `data_limit_reset_strategy` | string | no (default `no_reset`) | `no_reset\|day\|week\|month\|year`; invalid → 400 |
| `on_hold_expire_duration` | number | no | only meaningful for `on_hold` |
| `on_hold_timeout` | string | no | |
| `ip_limit` | number | no | |
| `speed_limit_kbps` | number | no | requires speed-limit permission |
| `auto_delete_in_days` | number | no | |
| `note` | string | no | ≤ 500 chars |
| `telegram_id` | string | no | |
| `contact_number` | string | no | |
| `credential_key` | string | no | normalized; may be derived from legacy `proxies` |
| `flow` | string | no | accepted for compatibility but **ignored/forced null** (`service.go:158-159`) |
| `proxies` | `Record<string, Record<string, any>>` | no | key material per protocol |
| `inbounds` | `Record<string, string[]>` | no | manual inbound selection is **rejected** (`ManualInboundSelectionRemovedMessage`); auto-service detection still reads it |
| `next_plan` (singular) | — | — | rejected with 400 (`NextPlanRemovedMessage`, `service.go:160-162`); use `next_plans` |
| `next_plans` | NextPlanPayload[] | no | |

Success: **201**, body = full UserDetail (§2.6). Common errors: 400 validation text, 403 permission/traffic limits, 404 `"Service not found"` / `"User not found"`, 409 `"User username already exists"`, 502 upstream/DB text.

### 2.8 `PUT /api/user/{username}` (also `PUT /api/v2/users/{username}`)

`users.go:370-398` → `user/service.go:185-225`; payload `UserModify` (`user/mutation_dto.go:111-115`): all `UserPayloadBase` fields of §2.7 plus:

| Field | Type | Notes |
|---|---|---|
| `status` | `"active" \| "disabled" \| "on_hold"` | modify enum; other values rejected |
| `service_id` | number | moving service; explicit `null` → 400 `"service_id is required. Users must be assigned to a service."` |

Semantics: only fields present in the raw JSON are applied (patch semantics via `fields` map). `flow` ignored. Success: **200**, body = UserDetail. Unknown user → 404 `"User not found"`.

### 2.9 `DELETE /api/user/{username}`

`users.go:400-427`: soft delete (`status = deleted`), returns **200** `{"username": string, "status": "deleted"}`. Requires `users.delete` permission; forbidden → 403.

### 2.10 User action endpoints

`handleUserMutationAction` (`users.go:429-477`): `POST /api/user/{username}/{suffix}`.

| Suffix | Effect | Success body |
|---|---|---|
| `reset` | zeros `used_traffic`, logs history row, `limited` → `active` | **200** UserDetail |
| `revoke_sub` | rotates subscription token | **200** UserDetail |
| `active-next` | applies next plan | **200** UserDetail; 404 `"User doesn't have next plan"` |

Order matters: `usage` and `ips` are handled as GET (`users.go:131-146`); every other suffix is POST-only → 405 otherwise.

If the post-mutation detail load fails, the endpoint still answers 200 with `{"id":number,"username":string,"status":string,"detail":"User mutation completed, but the full user detail response could not be generated."}` (`users.go:565-587`) — so a successful mutation response may be *either* a UserDetail or this fallback object. Discriminate by presence of `detail` / absence of `created_at`.

### 2.11 `GET /api/user/{username}/usage`

`users.go:225-265`.

| Query | Type | Default | Meaning |
|---|---|---|---|
| `start` | time string | now−30 d | RFC3339(Nano) or `"YYYY-MM-DD HH:MM:SS"`; bad → 400 `"invalid date range or format"` |
| `end` | time string | now | same; start after end → 400 `"start date must be before end date"` |

Response: `{"username": string, "usages": [{ "node_id": number|null, "node_name": string, "used_traffic": number }]}` — one row per node, bytes. 403 `"Viewing user traffic is disabled."` when traffic is hidden. (`usage/dto.go:14`)

### 2.12 `POST /api/users/actions` (bulk)

`users.go:479-540`, payload `BulkUsersActionRequest` (`user/mutation_dto.go:117-132`), validation `user/validation.go:102-225`.

| Field | Type | Notes |
|---|---|---|
| `action` | string | **required**, one of the 9 below |
| `days` | number | required > 0 for `extend_expire`/`reduce_expire`/`cleanup_status` (`"days must be a positive integer"`) |
| `gigabytes` | number | required > 0 for `increase_traffic`/`decrease_traffic` (float, GiB → bytes via `round(gb * 1073741824)`) |
| `statuses` | string[] | `cleanup_status` only; values `expired`,`limited` (default = both) |
| `scope` | string[] | statuses the action applies to; `deleted` is dropped and duplicates removed; if the list becomes empty (e.g. only `deleted`) → 400 `"scope cannot be empty or include deleted"`. `[]` behaves like omitted. |
| `admin_username` | string | target admin (global callers); non-global may only target themselves → 403 |
| `service_id` | number | restrict to a service (>0) |
| `target_service_id` | number | `change_service` destination, required there |
| `service_id_is_null` | boolean | select service-less users; mutual exclusion with `service_id` |
| `usernames` | string[] | explicit target list, ≤ 500, deduped, validated |
| `last_online_days` | number | > 0; time-based target (delete) |
| `status_age_days` | number | > 0; requires `scope` |
| `created_before_days` | number | > 0; time-based target (delete) |
| `dry_run` | boolean | **delete_users only**; returns count without deleting |

Allowed `action` values (`user/mutation_dto.go:41-53`):
`extend_expire`, `reduce_expire`, `increase_traffic`, `decrease_traffic`, `cleanup_status`, `activate_users`, `disable_users`, `change_service`, `delete_users`.
Any other value → 400 `"unsupported bulk action"` (or 400 `"Unsupported action"` from the repo).

Response: **200** `{"detail": string, "count": number}` (`user/mutation_dto.go:134-138`; `UserIDs` is `json:"-"`). Detail strings are action-specific, e.g. `"Users deleted"`, `"Users activated"`, `"Users disabled"`, `"Expiration dates extended"`, `"Data limits increased for users"`. Delete > 500 matches → 400.

Notable 4xx: 403 `"Standard admins can only target their own users"`, 403 `"Service transfer is disabled for created-traffic and per-service traffic admins."`, 403 `"Select one admin before changing service assignments."`, 400 `"target_service_id is required. Users must be assigned to a service."`, 400 `"Users limit reached. Maximum active users: N"`, 400 `"The selected conditions match more than 500 users. Narrow the conditions and try again."`, 403 `"Admin traffic limit reached…"`.

### 2.13 Sibling endpoints in the same family

| Endpoint | Response | Notes |
|---|---|---|
| `GET /api/users/onlines?usernames=a,b&details=true` | `string[]` by default; with `details=true`: `{"users": string[], "speeds": Record<string,{upload_speed:number, download_speed:number}>}` | bytes/second; usernames CSV capped at 500; traffic-hidden services are removed from `speeds` (`users.go:75-122`, `user_speed.go:11`) |
| `GET /api/users/usage?start&end&admin=` | `{"usages":[{node_id,node_name,used_traffic}]}` | Despite the name, rows are **per node** (aggregated over the selected admins), not per admin. `admin` (repeatable) ignored for non-global admins. 403 when traffic cannot be viewed (`users.go:297-334`, `usage/repository.go:121`) |
| `GET /api/user/{username}/ips` | `{"username":string,"ips":[{...}]}` | online IP records enriched with geo/node info (`users.go:267-295`) |

---

## 3. Admins

Route: `GET /api/admins` (`routes.go:117`), handler `admin_usage.go:35-129`. Requires `role == full_access` **or** `permissions.admin_management.can_view`; else 403 `"You're not allowed to view admins."`.

| Query | Type | Default | Meaning |
|---|---|---|---|
| `offset` | int ≥ 0 | 0 | SQL OFFSET; invalid/negative silently becomes 0 (`admin_usage.go:312-318`) |
| `limit` | int ≥ 0 | 0 = no limit | `LIMIT` only when > 0; invalid silently ignored |
| `username` | string | none | fuzzy search over username (`searchmatch`), not exact |
| `match_case` | bool | false | invalid → 400 `"invalid match_case"` |
| `match_whole_word` | bool | false | invalid → 400 `"invalid match_whole_word"` |
| `role` | `standard\|reseller\|sudo\|full_access` | none | anything else → 400 `"invalid role or status"` |
| `status` | `active\|disabled\|expired\|limited` | none | `active` = status active AND not time-expired AND not traffic-limited; anything else → 400 `"invalid role or status"` (`admin_usage.go:326-357`) |
| `sort` | string | `username ASC` | **single value only** (`Query().Get`); `-` prefix = desc. Fields: `id`, `role`, `status`, `users_usage`, `data_limit`, `created_traffic`, `data_usage`, `remaining_traffic`, `expire`, `users_count`, `services`, `online`; unknown field silently falls back to `username` (`admin_usage.go:359-388`) |

Response: **200** `{"admins": Admin[], "total": number}` (bare `total` before limit/offset).

### 3.1 Admin object

Struct `admin/types.go:140-171`; serialized form is the **map** built in `admin_auth.go:258-307` (map keys win over struct tags), enriched by `admin_usage.go:390-433` for list responses.

| Field | Type | Notes |
|---|---|---|
| `id` | number | |
| `username` | string | |
| `created_by` | string | |
| `role` | `"standard" \| "reseller" \| "sudo" \| "full_access"` | `types.go:9-16` |
| `permissions` | AdminPermissions | §3.2 |
| `services` | number[] | assigned service ids; `[]` when none |
| `status` | `"active" \| "disabled" \| "deleted"` | |
| `disabled_reason` | string\|null | `admin_time_limit_exhausted`, `admin_data_limit_exhausted`, … |
| `telegram_id` | number\|null | |
| `subscription_domain` | string\|null | |
| `subscription_settings` | object | `{}` when unset |
| `users_usage` | number | bytes |
| `lifetime_usage` | number | bytes |
| `created_traffic` | number | bytes |
| `deleted_users_usage` | number | bytes |
| `data_limit` | number\|null | bytes |
| `traffic_limit_mode` | `"used_traffic" \| "created_traffic"` | |
| `use_service_traffic_limits` | boolean | |
| `show_user_traffic` | boolean | |
| `delete_user_usage_limit_enabled` | boolean | |
| `delete_user_usage_limit` | number\|null | |
| `expire` | number\|null | unix seconds |
| `users_limit` | number\|null | |
| `service_limits` | AdminServiceLimit[] | `[]` when none |
| `require_2fa` | boolean | |
| `totp_enabled` | boolean | |
| `users_count`, `active_users`, `online_users`, `limited_users`, `expired_users`, `on_hold_users`, `disabled_users` | number **in `/api/admins`**, `null` in `/api/admin` and `/auth/*` | filled by `admin_usage.go:390-433` |
| `data_limit_allocated`, `unlimited_users_usage`, `reset_bytes` | always `null` | placeholders emitted by `adminResponse` (`admin_auth.go:293-295`) |

`AdminServiceLimit` (`admin/types.go:126-138`): `service_id:number`, `traffic_limit_mode:string`, `data_limit:number|null`, `created_traffic:number`, `used_traffic:number`, `lifetime_used_traffic:number`, `show_user_traffic:boolean`, `users_limit:number|null`, `delete_user_usage_limit_enabled:boolean`, `delete_user_usage_limit:number|null`, `deleted_users_usage:number`.

Related: `GET /api/admins/speeds` → `Record<admin_id,{upload_speed:number,download_speed:number}>` (bytes/s, live), gated the same way (`admin_usage.go:18-33`).
`GET /api/admin` (self) returns the same object **plus** `user_speed_limit_enabled: boolean` (`admin_auth.go:100-113`). That extra key is not present in `/auth/*` or `/api/admins`.

### 3.2 Permission model (`permissions`)

`admin/types.go:69-124`. All permission keys are exactly these JSON names; every leaf is `boolean` unless marked otherwise.

| Object | Keys |
|---|---|
| `users` | `create`, `delete`, `reset_usage`, `periodic_usage_reset`, `revoke`, `create_on_hold`, `allow_unlimited_data`, `allow_unlimited_expire`, `allow_next_plan`, `advanced_actions`, `set_flow`, `allow_custom_key`, `manage_speed_limit`, `manage_ip_limit` (all boolean); `max_data_limit_per_user`, `max_speed_limit_per_user`, `max_ip_limit_per_user` (**number \| null**) |
| `admin_management` | `can_view`, `can_edit`, `can_manage_sudo`, `manage_sessions`, `manage_2fa` |
| `sections` | `usage`, `admins`, `services`, `hosts`, `nodes`, `integrations`, `xray` |
| `self_permissions` | `Record<string, boolean>`; known keys `self_myaccount`, `self_change_password`, `self_api_keys`, `self_sessions`, `self_2fa`, `self_placeholders` (defaults all `true` except `self_placeholders`; sudo/full_access get `self_placeholders: true`) (`admin/permissions.go:105-114`) |
| `sudo` | `nodes`, `xray`, `settings`, `subscriptions`, `backups`, `maintenance`, `phpmyadmin`, `notes` |

Role defaults live in `admin/permissions.go:8-68`: standard/reseller get `sections.hosts = true` only, sudo/full_access get everything; only full_access defaults `users.delete`/`users.reset_usage` to true. Do **not** re-derive defaults client-side — always read `permissions` from the session payload.

Bulk standard-permission toggle (`POST /api/admin/permissions/standard/bulk`, `admin.go:888-961`):
body `{"permissions": string[], "mode": "disable" | "restore"}` (mode defaults to `disable`; other value → 400 `"Unsupported bulk permission mode"`). Accepted permission keys are the 12 booleans under `users`: `create`, `delete`, `reset_usage`, `periodic_usage_reset`, `revoke`, `create_on_hold`, `allow_unlimited_data`, `allow_unlimited_expire`, `allow_next_plan`, `advanced_actions`, `set_flow`, `allow_custom_key` (others are ignored). Applies to **all** `role == standard` admins. Response `{"updated": number, "mode": string}`. Requires admin edit permission.

---

## 4. Nodes and hosts

### 4.1 `GET /api/nodes`

`server.go:228-249`; route is **sudo-only** (`routes.go:249`) — requires `role == sudo` *and* `permissions.sudo.nodes`, or `full_access`.

* No query parameters (`nodecontroller.Request{}` is empty; listing has no filter/pagination/sort).
* Response is a **bare JSON array**, not an envelope.
* Each element = `flattenNodeItem` (`node_responses.go:5-58`), a flattening of `NodeListItem` (`nodecontroller/dto.go:199-240`):

| Field | Type | Notes |
|---|---|---|
| `id` | number | |
| `name` | string | |
| `note` | string\|null | |
| `address` | string | |
| `port` | number | main/control port |
| `control_port` | number | duplicate of `port` (compat) |
| `api_port` | number | |
| `usage_coefficient` | number | float |
| `data_limit` | number\|null | bytes |
| `proxy_enabled` | boolean | |
| `proxy_type` | string\|null | |
| `proxy_host` | string\|null | |
| `proxy_port` | number\|null | |
| `proxy_username` | string\|null | |
| `proxy_password` | string\|null | exposed to the client |
| `status` | string | node status |
| `agent_status` | string | |
| `xray_status` | string | |
| `desired_revision` | number | uint64 |
| `applied_revision` | number | uint64 |
| `capabilities` | string[], **absent** if empty | |
| `protocol_statuses` | ProtocolStatus[], **absent** if empty | `{protocol:string, state:string, detail?:string, inbounds:number, version?:string}` (`nodecontroller/dto.go:242`) |
| `message` | string\|null | |
| `xray_version` | string\|null | |
| `node_service_version` | string\|null | |
| `node_install_mode` | string\|null | |
| `node_binary_tag` | **always `null`** | placeholder |
| `node_update_channel` | string\|null | |
| `cpu_cores` | number | int32 |
| `cpu_frequency_hz` | number | Hz (float) |
| `cpu_usage_percent` | number | 0–100 |
| `memory_used` | number | bytes (uint64) |
| `memory_total` | number | bytes |
| `memory_usage_percent` | number | 0–100 |
| `uptime_seconds` | number | uint64 |
| `xray_pid` | number | int32 |
| `xray_cpu_usage_percent` | number | |
| `xray_memory_used` | number | bytes |
| `xray_uptime_seconds` | number | |
| `upload_speed` | number | bytes/s (uint64) |
| `download_speed` | number | bytes/s |
| `geo_mode` | string | |
| `xray_config_mode` | string | |
| `uplink` | number | bytes |
| `downlink` | number | bytes |
| `has_custom_certificate` | boolean | |
| `uses_default_certificate` | boolean | |
| `certificate_public_key` | string\|null | |
| `node_certificate` | string\|null | PEM |
| `node_certificate_key` | string\|null | PEM private key — **sensitive** |

### 4.2 `GET /api/hosts`

`hosts.go:182-216`; also reachable at `/hosts` (no `/api`). Requires `role == sudo`/`full_access` **or** `permissions.sections.hosts`; else 403 `"You're not allowed"`.

* No query parameters.
* Response is an object **grouped by inbound tag**: `Record<inboundTag, Host[]>` (`listHostsGrouped`, `hosts.go:298-318`). With no hosts it is `{}`.
* Element `hostResponse` (`hosts.go:77-110`):

| Field | Type | Notes |
|---|---|---|
| `id` | number | |
| `remark` | string | |
| `address` | string | |
| `address_options` | string[] | |
| `address_selection_mode` | string | |
| `address_ttl_seconds` | number\|null | |
| `port` | number\|null | |
| `sni` | string\|null | |
| `sni_options` | string[] | |
| `sni_selection_mode` | string | |
| `sni_ttl_seconds` | number\|null | |
| `host` | string\|null | |
| `host_options` | string[] | |
| `host_selection_mode` | string | |
| `host_ttl_seconds` | number\|null | |
| `path` | string\|null | |
| `security` | string | e.g. `tls`, `none`, `reality` |
| `alpn` | string | |
| `fingerprint` | string | |
| `verify_peer_cert_by_name` | string | |
| `pinned_peer_cert_sha256` | string | |
| `allowinsecure` | boolean\|null | note the tag has no underscore |
| `is_disabled` | boolean | |
| `mux_enable` | boolean\|null | |
| `fragment_setting` | string\|null | |
| `noise_setting` | string\|null | |
| `finalmask` | object | `Record<string, any>` |
| `client_settings` | object | |
| `random_user_agent` | boolean\|null | |
| `use_sni_as_host` | boolean\|null | |
| `dns_primary` | string | |
| `dns_secondary` | string | |

Writes use `PUT /api/hosts` with `Record<inboundTag, hostPayload[]>` and `PUT /api/hosts/{id}/status` with `{"is_disabled": boolean}` (`hosts.go:199-215,242-269`). Note the user-facing `Host` type embedded in user detail has more fields (`service_ids`, non-pointer `mux_enable`) — don't reuse one type for both.

---

## 5. `GET /api/system`

`system.go:13-31` → `systemapp.SystemStats` (`system/types.go:48-97`). Auth: any logged-in admin (`requireAdmin`). No query params. Not a websocket; poll it.

| Field | Type | Unit / meaning |
|---|---|---|
| `version` | string | panel version (`"1.8.0"` default) |
| `channel` | string | release channel |
| `os` | string, **absent** if empty | `omitempty` |
| `cpu_cores` | number | physical cores |
| `cpu_threads` | number | `runtime.NumCPU()` |
| `cpu_frequency_hz` | number | Hz (float) |
| `cpu_usage` | number | percent 0–100 |
| `total_user` | number | users |
| `online_users` | number | users |
| `online_users_usage` | number | bytes (traffic of online users) |
| `online_users_upload_speed` | number | **bytes/s** (uint64) |
| `online_users_download_speed` | number | bytes/s |
| `users_active`, `users_on_hold`, `users_disabled`, `users_expired`, `users_limited` | number | user counts |
| `incoming_bandwidth`, `outgoing_bandwidth` | number | cumulative bytes |
| `panel_total_bandwidth` | number | cumulative bytes |
| `incoming_bandwidth_speed`, `outgoing_bandwidth_speed` | number | bytes/s (interface) |
| `total_incoming_bandwidth_speed`, `total_outgoing_bandwidth_speed` | number | bytes/s across all nodes; **stays 0 for non-global admins** (`system.go:96-103`) |
| `memory` | UsageStats | `{"current":bytes,"total":bytes,"percent":0-100}` |
| `swap` | UsageStats | same units |
| `disk` | UsageStats | same units (root filesystem) |
| `load_avg` | number[] | `[1m,5m,15m]`, `[]` if unavailable |
| `uptime_seconds` | number | host uptime |
| `panel_uptime_seconds` | number | panel process uptime |
| `xray_uptime_seconds` | number | always `0` in current code (`system/service.go:116`) |
| `xray_running` | boolean | |
| `xray_version` | string\|null | |
| `app_memory` | number | bytes (RSS) |
| `app_threads` | number | |
| `panel_cpu_percent` | number | percent 0–100 |
| `panel_memory_percent` | number | percent 0–100 |
| `cpu_history`, `memory_history`, `swap_history`, `disk_history` | `{timestamp:number, value:number}[]` | timestamp unix sec; value percent |
| `panel_cpu_history`, `panel_memory_history` | same | |
| `network_history` | `{timestamp:number, incoming:number, outgoing:number}[]` | bytes/s |
| `personal_usage` | object | `total_users:number`, `consumed_bytes:number`, `built_bytes:number`, `reset_bytes:number`, `traffic_basis:string` (`dashboard/dto.go:16-22`) |
| `admin_overview` | object | `total_admins:number`, `sudo_admins:number`, `full_access_admins:number`, `standard_admins:number`, `top_admin_username:string|null`, `top_admin_usage:number` (`dashboard/dto.go:24-31`) |
| `last_xray_error`, `last_telegram_error` | string\|null | |

`UsageStats` = `{"current":number,"total":number,"percent":number}` (`system/types.go:7-11`). Sources/units: `system/service.go:336-417` (gopsutil; `Current/Total` are bytes, `percent` 0–100).

Sibling: `GET /api/system/diagnostics` (sudo) returns a bare array of `ConfigIssue` (`target_id`, `resource_type`, `resource`, `message`, `severity`).

---

## 6. Services and live metrics

### 6.1 There is **no** `/api/services`

Only `/api/v2/services` exists (`routes.go:205-208`; confirmed absent from `internal/app/api/openapi/openapi.json`). `GET /api/services` falls through to the SPA/subscription fallback → 404 JSON.

### 6.2 `GET /api/v2/services`

`services.go:99-112` → `handleServicesList` (`:218-236`), SQL `servicesList` (`:958-1019`). Auth: any admin; non-global admins only see services assigned to them.

| Query | Type | Default | Meaning |
|---|---|---|---|
| `offset` | int ≥ 0 | 0 | SQL OFFSET; invalid/negative → 400 `"invalid offset"` |
| `limit` | int ≥ 1, or `null`/`none` | **20** | page size; `null`/`none` = no LIMIT; invalid (`<1`) → 400 `"invalid limit"` (`services.go:1487-1508`) |
| `name` | string | none | case-insensitive substring match on name |

Response: **200** `{"services": Service[], "total": number}`; fixed order `created_at DESC, id DESC` (no sort param).

`Service` (`serviceBaseResponse`, `services.go:52-63`):

| Field | Type | Notes |
|---|---|---|
| `id` | number | |
| `name` | string | |
| `description` | string\|null | |
| `usage_coefficient` | number | float, default 1 |
| `used_traffic` | number | bytes |
| `lifetime_used_traffic` | number | bytes |
| `host_count` | number | enabled hosts |
| `user_count` | number | users with that service, excluding deleted |
| `has_hosts` | boolean | `host_count > 0` |
| `broken` | boolean | `host_count == 0` |

`GET /api/v2/services/{id}` adds `admins: serviceAdminResponse[]`, `hosts: serviceHostResponse[]`, `admin_ids: number[]`, `host_ids: number[]` (`services.go:65-97`). `POST /api/v2/services/{id}/users/actions` is a bulk user action scoped to a service (`routes.go:206`, `users.go:491-502`).

### 6.3 `GET /api/system/metrics` — live stats websocket

Route `routes.go:170` (`requireAdmin`), handler `live_metrics.go:60-85`. Upgrade is a plain `GET` (cookie sent by browser automatically). Query `interval` = seconds, default **3**, clamped to **1–30** (`live_metrics.go:197-214`).

Server pushes one JSON text frame per tick (`systemMetricsMessage`, `live_metrics.go:27-31`):

```json
{ "type": "system.metrics", "stats": { /* SystemStats, §5 */ } }
{ "type": "system.metrics", "error": "…" }
```

* `stats` is the same object as `GET /api/system`, **except** all `*_history` arrays are `null` (`live_metrics.go:184-190`) — merge with the REST payload, don't replace history blindly.
* On a snapshot error the frame carries `error` and **no** `stats`; the stream keeps sending.
* On auth failure the HTTP upgrade itself is rejected with 401 JSON (no websocket). Reconnect should re-check `/api/auth/session`.

Sibling `GET /api/nodes/metrics` (`live_metrics.go:33-58,87-172`, sudo): frames `{"type":"nodes.metrics","nodes":[ flattenNodeItem... ]}`; the first frame carries all nodes (`flattenNodeStaticItem`, **without** status/metrics), then one frame per node with live fields (`flattenNodeLiveItem`); errors use the same array `[]` + `error` form. Interval semantics identical.

---

## 7. Frontend implications

### 7.1 Pagination model

* **Offset-based, not page-based.** `offset` + `limit` (rows), plus `total` for the total match count. There is no `page`/`per_page` and no cursor anywhere in these families.
* **Users:** `limit` has *no* default — always send it. `total` is the count of all matching rows (so `Math.ceil(total/limit)` gives page count). `limit=0` returns no rows. When `offset>0` without `limit`, the server queries everything from `offset` (avoid).
* **Admins:** `limit` absent/0 = all rows; `offset`/`limit` parse failures are silently ignored (no 400), so clamp client-side.
* **Services:** default `limit=20`; pass `limit=null`/`none` to fetch everything.
* **Nodes, hosts:** no pagination at all — full list every time.
* Traffic totals (`usage_total`, `status_breakdown`, `online_total`) are computed over the *filtered* set, not the page, so they are safe for header/summary widgets.

### 7.2 Sorting

* `GET /api/users` and `GET /api/admins` accept `sort`; **nodes/services/hosts do not** (fixed order).
* Format: `sort=field` (asc) or `sort=-field` (desc). Multiple `sort` params (and comma-separated values) are honored for users, in order; admins use only the first value.
* Users whitelist (only 5): `username`, `used_traffic`, `data_limit`, `expire`, `created_at`. Anything else is a **400**, so keep a local allowlist mirroring this. Default when omitted: `created_at DESC, id DESC`.
* Admins accepted sort fields: `id`, `role`, `status`, `users_usage`, `data_limit`, `created_traffic`, `data_usage`, `remaining_traffic`, `expire`, `users_count`, `services`, `online` (unknown silently → username asc). Default: `username ASC`.
* Sorting users by `used_traffic` needs traffic visibility → 403 `"Viewing user traffic is disabled."`; handle it by disabling that column rather than surfacing a toast error.

### 7.3 How errors come back

* **Everything is `{"detail": string}`.** The string is user-presentable English (sometimes ending with a period). There is no `code`, no field-level error map, and 422 is rarely used (a few admin writes).
* Status codes to branch on: `400` validation/parse, `401` not authenticated (always the same detail string), `403` permission/origin/traffic-hidden, `404` not found, `405` wrong method, `409` conflict (duplicate username, TOTP already enabled), `413` body too large, `429` login rate limit (has `Retry-After`), `500` server bug, `502` DB/upstream failure (detail leaks the Go/SQL error — render generically), `503` session check unavailable, `504` users list timeout (`"Users list query timed out"`).
* Success responses that still contain a `detail` key: bulk actions (`{detail, count}`) and the user-mutation fallback object. Don't treat a top-level `detail` as an error unconditionally.
* 204 responses (`logout`, session revoke) have no body — do not JSON-parse them.
* Unknown paths do **not** return JSON errors: they fall through to the SPA/subscription fallback. A typo'd endpoint can return 404 JSON or an HTML page; feature detection must rely on `content-type: application/json`.

### 7.4 Must-replicate compatibility details

1. **Cookies only.** `credentials: "include"` on every request (or same-origin). The session cookie is `HttpOnly`, `SameSite=Lax`, `Secure` only over HTTPS, 90 days active / 5 minutes pending-2FA. No auth header is needed or stored.
2. **Dev proxy must satisfy the same-origin guard.** All non-GET calls with cookie auth require `Origin`/`Referer` host == `Host`/`X-Forwarded-Host`; otherwise 403 `"Invalid request origin"`. A proxy that rewrites `Host` (e.g. `changeOrigin: true`) must also rewrite `Origin` to the target origin — the current `dashboard-next/vite.config.ts:27-34` does exactly that (`headers: { Origin: targetOrigin }`). Websocket proxying (`/api/system/metrics`) additionally needs the proxy's ws support; if it fails in dev, that is a proxy config issue, not an API contract issue.
3. **Bootstrap sequence:** `GET /api/auth/session` → if 401, `POST /api/auth/login` → branch on `state`; only `state === "active"` may load data (all other states 401 everywhere).
4. **`permissions_version`** is the only supported permission-cache invalidation signal; refresh on change.
5. **`status_breakdown`, `total`, `online_total`, `usage_total`** are computed server-side — do not recompute from the current page.
6. **Nullability:** treat `expire`, `data_limit`, `service_id`, `admin_id`, `*_reason`, `telegram_id` (admin: number, user: string) and `online_at` as nullable; `data_limit_reset_strategy` and some booleans can be *absent* rather than null (omitempty). Generate TS as optional/nullable where the doc says "absent".
7. **Timestamp parsing:** `created_at`/`sub_updated_at`/`on_hold_timeout` are RFC3339Nano; **`online_at` is sometimes `"YYYY-MM-DD HH:MM:SS"`** (SQLite, when online) and sometimes RFC3339. Use a parser that accepts both; trust `is_online` for state.
8. **Live stats:** prefer the `/api/system/metrics` websocket (default interval 3 s, `?interval=`) and merge its `stats` over the `GET /api/system` snapshot; its history arrays are `null`.
9. **Traffic visibility is a server-side policy**, not a UI toggle: traffic fields silently become `0`, `usage_total`/`speeds` entries disappear, and traffic sorts/usage endpoints 403. Render "hidden" rather than "0 bytes" when `usage_total` is absent.
10. **User detail has no `id`.** Keep the username as the route key; only list items and the mutation fallback expose `id`.
11. **Create requires a service**: `service_id` (or inbounds the server can map to one). Manual inbound selection and the singular `next_plan` are rejected — send `next_plans`.
12. **Bulk actions**: send `days`/`gigabytes`/`target_service_id` as required per action; the response is `{detail, count}` (no per-user results), and `dry_run` is only valid for `delete_users`.
13. **Optional header** `X-Rebecca-Action-Batch` (≤64 chars, `[A-Za-z0-9_-]`) is accepted and attached to the request context for recent-action batching; harmless if omitted (`middleware.go:39-58`).

### 7.5 Not confirmed / ambiguous

| Item | Status |
|---|---|
| `online_at` format on MySQL | MySQL is supported (`internal/platform/db/db.go:113-158`, `ParseTime: true`), but the MySQL branch of the `CASE` expression was not executed here. Assume RFC3339Nano and still parse both. |
| `/api/services` | Does not exist; not aliased anywhere. |
| `GET /api/system` per-node bandwidth for non-global admins | `total_*_bandwidth_speed` is only populated for global roles; it serializes as `0`, not absent. |
| `UserDetail.credentials` / `link_data` | Declared in the DTO but never assigned by any handler → always absent. |
| `xray_uptime_seconds` | Hard-coded `0` in the service layer, despite the field name. |
| OpenAPI file accuracy | `internal/app/api/openapi/openapi.json` documents `owner` for `/api/users` (handler reads `admin`) and omits `/api/auth/*`, `/api/system/metrics`, `/api/nodes/metrics`. Treat the Go source (this doc) as authoritative. |
| `/api/admin/{username}` GET | No single-admin `GET` route (GET falls through to 404 `"not found"`, `admin.go:248-312`); use `GET /api/admins` and filter, or `GET /api/admin` for self. |

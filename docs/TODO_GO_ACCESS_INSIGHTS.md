# Access Insights Go Rebuild

## Implemented Online View

The Go API now restores Live Access Insights as a bounded online-session view.
It reads the existing `user_online_ips` snapshots for Xray and active session
records for OpenVPN, WireGuard, L2TP/IPsec, IKEv2, and Cisco AnyConnect. Page
refreshes do not dial nodes or call the Xray stats API; those snapshots continue
to arrive through the normal 30-second accounting collection.

The view is capped at 500 users and 5,000 records, applies admin ownership in
SQL, hides duplicate Xray pool IPs created by routed tunnel traffic, and keeps
automatic refresh optional. ISP ranges are loaded from `ISPbyrange.json` with a
short network timeout, a response-size cap, and a 24-hour in-memory cache. The
same resolver enriches the Users page Get IPs dialog.

The destination/platform analysis described below remains a separate future
phase. Direct-egress tunnel protocols do not expose destination traffic to Xray,
so source IP, protocol, node, and operator are the common reliable live data.

Access Insights is temporarily disabled in the Python backend. The frontend page
has been restored using the Go online-session API. Raw access-log parsing,
destination geo lookup, and raw log streaming remain future work.

## Current Feature Intent

Access Insights was designed to show live recent Xray access-log activity across
the panel and connected nodes. It grouped connection events by user/email/source
IP and enriched destinations with platform labels such as YouTube, Instagram,
Telegram, Google, Cloudflare, GitHub, Steam, OpenAI, adult traffic, crypto
services, and generic hosting/CDN buckets.

It also enriched source IPs with operator/ISP names so operators such as MCI,
Irancell, Rightel, and TCI could be shown in the UI.

The old Python implementation is removed because it was tightly coupled to
Python-side node log fetching, local Xray config helpers, and local geo asset
loading. The Go rewrite should make the feature node-first and avoid any local
Xray runtime dependency on Master.

## Old Inputs

The Python implementation used these inputs:

- Panel setting: `panel_settings.access_insights_enabled`.
- Master log path resolved from:
  - `xray_config.data.log.access`
  - `XRAY_LOG_DIR`
  - conventional fallbacks such as `/var/log/xray/access.log`
- Node logs fetched through the Go Master API endpoint:
  - `GET /api/node/{id}/logs`
- Geo assets from local Xray assets and JSON templates:
  - `geosite.dat`
  - `geoip.dat`
  - `geosite.json`
  - `geoip.json`
  - `ISPbyrange.json`
- JSON geo template URLs previously mirrored from:
  - `https://raw.githubusercontent.com/ppouria/geo-templates/main/geosite.json`
  - sibling `geoip.json` and `ISPbyrange.json`

The Go rewrite should not reintroduce local Master Xray dependencies. Master no
longer owns an Xray runtime, so node access logs should come from node gRPC log
streaming or a Go node-log API owned by the new node runtime.

## Old API Surface

The removed Python API surface was:

- `GET /api/core/access/insights`
- `GET /api/core/access/insights/multi-node`
- `GET /api/core/access/logs/raw`
- `POST /api/core/access/operators`
- `WS /api/core/access/logs/ws`

The online-session rebuild restores the insights, multi-node, and operator HTTP
routes. Raw-log HTTP streaming and websocket routes remain disabled until the
destination-analysis phase is implemented with bounded node gRPC streaming.

## Old Query/Runtime Parameters

The previous runtime accepted:

- `limit`: max client rows returned.
- `lookback`: lines inspected per source.
- `window_seconds`: recent time window.
- `search`: destination/user/node/IP filter.
- `node_ids`: comma-separated node IDs.
- `mode`:
  - `full`: Python aggregated everything.
  - `raw` or `frontend`: backend streamed NDJSON and frontend aggregated.

The Go rewrite can keep these names for UI compatibility, but should prefer
bounded pagination/cursors and explicit source selection.

## Old Access Log Parser

The old parser accepted Xray access-log rows shaped like:

```text
2026/05/18 21:08:42.667254 from 83.121.41.4:0 accepted udp:202.179.123.225:443 [cdn -> tag] email: 16432.e_198
```

It extracted:

- timestamp
- source IP
- source port
- action: `accepted` or `rejected`
- network: `tcp`, `udp`, etc.
- destination host/IP
- destination port
- route text inside `[...]`
- email/user label after `email:`

Only `accepted` rows were used for insight aggregation. Localhost/private
noise was skipped where possible.

## Old Geo Classification

The previous classification stack had three layers:

1. Built-in domain/IP heuristics for common platforms and CDNs.
2. JSON geo template maps for custom labels.
3. Protobuf `geosite.dat` and `geoip.dat` indexes.

The old in-memory geo structures were:

- `GeoSiteIndex`
  - full domain map
  - suffix domain map
  - plain string rules
  - regex rules
- `GeoIPIndex`
  - IPv4 network ranges
  - IPv6 network ranges
- `GeoAssets`
  - geosite index
  - geoip index
  - asset source/status metadata

The Go rewrite should parse and cache these assets in a bounded way. If parsing
`geosite.dat`/`geoip.dat` is too costly, begin with JSON templates and explicit
TODOs for protobuf asset parity.

## Old Platform Heuristics

The Python and frontend code recognized domains and IP prefixes for labels such
as:

- youtube
- instagram
- tiktok
- whatsapp
- facebook
- telegram
- snapchat
- netflix
- twitter/x
- google/google_ads
- cloudflare/cloudflare-dns
- apple/icloud
- github
- steam
- microsoft
- samsung
- openai
- yahoo
- opera
- xiaomi
- huawei
- linkedin
- discord
- divar
- eitaa
- splus
- neshan
- yektanet
- truecaller
- launchdarkly
- porn/adult
- crypto/binance/wallet
- hosting
- local
- iran

The Go rebuild should make this a data-driven registry so new rules can be added
without recompiling the whole feature where possible.

## Old ISP/Operator Classification

The old operator resolver read source IPs and returned:

```json
{
  "ip": "1.2.3.4",
  "short_name": "MCI",
  "owner": "Hamrah Aval"
}
```

It used IP ranges from `ISPbyrange.json`. The frontend grouped unique IP counts
by `short_name || owner || "Unknown"`.

The Go implementation should keep operator lookup separate from platform lookup
so it can be cached, tested, and rate-limited independently.

## Old Aggregation Model

Per source line, the old aggregator computed:

- `user_key`
  - lowercased email if access log had `email:`
  - otherwise source IP
- `user_label`
  - original email or source IP
- `source_nodes`
  - mapping of source IP to node names
- `platforms`
  - platform name
  - connection count
  - unique destinations
- `operators`
  - per source IP operator metadata
- `operator_counts`
  - per operator unique IP counts
- `last_seen`
- `route`
- `connections`

It also produced top-level:

- `sources`
- `source_statuses`
- `items`
- `platform_counts`
- `platforms`
- `matched_entries`
- `generated_at`
- `lookback_lines`
- `window_seconds`
- `unmatched`
- `geo_assets`
- `geo_assets_path`
- `log_path`
- `mode`

The frontend currently expects this response shape. A Go rewrite should either
preserve it or update the frontend and types in the same migration.

## Old Source Discovery

The previous source list mixed:

- a Master source if a local access log existed
- connected nodes from `/api/nodes`
- per-node log fetches from `/api/node/{id}/logs`

For Go, source discovery should be:

1. Query DB for enabled/connected nodes.
2. Ask each node over gRPC for bounded access log lines or stream chunks.
3. Return per-source status:
   - connected
   - ok
   - total lines
   - matched lines
   - error

Master should not be treated as an Xray source unless a local node is explicitly
installed and registered as a normal node.

## Old Raw Streaming

`GET /core/access/logs/raw` returned NDJSON chunks:

- metadata
- logs
- source_status
- error
- complete

The frontend could aggregate these chunks locally to reduce backend CPU.

The Go rewrite should prefer either:

- HTTP NDJSON streaming from Go Gateway/Master API, or
- websocket from Gateway to Go Master API, backed by node gRPC streaming.

Backpressure, client disconnects, and max line budgets must be explicit.

## Security And Permission Requirements

The feature should use Go Admin/Auth and require the same permission used by the
old UI:

- `sections.xray`

Recommended future permissions:

- view access insights
- stream raw node logs
- view source IP/operator metadata

The raw log stream exposes user labels, source IPs, and destination hosts. Treat
it as sensitive operational data.

## Performance Requirements For Go Rewrite

The old implementation was memory-heavy when many nodes were selected. The Go
version should:

- use bounded per-source line budgets
- avoid loading entire logs into memory
- stream lines where possible
- cap users/clients, unmatched entries, and destinations per platform
- cache geo assets with invalidation
- expose source-level errors rather than failing the full response
- avoid regex-heavy hot paths unless compiled once
- support cancellation via request context

## Frontend Requirements

The page is enabled as the bounded online-session view described above.

When rebuilt:

- long node lists must wrap and not overflow the page
- badges containing log paths, node names, and geo paths must be bounded
- the page must stay usable with dozens or hundreds of nodes
- disabled/down nodes should appear as source status, not page-level failure

## Remaining Destination-Analysis Checklist

1. Add a bounded node gRPC access-log stream.
2. Add Go destination parsing and geo classification.
3. Restore the optional raw NDJSON/websocket routes with backpressure.
4. Add parser, node-down, and large-log load tests.

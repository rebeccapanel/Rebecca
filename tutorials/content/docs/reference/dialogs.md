---
title: "User dialog guide"
weight: 1
---

<span id="dialog-guide"></span>

## Basics & status {#dialog-dialog-basics}

Top of the form: identity, status, time and quota.

### Username

3–32 chars; keep it simple and readable.

- Use trial/guest suffix for tests so they stand out.

### Status

active for normal use, on hold to start after first connect, limited/expired/disabled to pause or cap access.

- On hold holds expiry and quota until the first successful connection.

### Expire

End date; leave empty for no expiry.

- Quick add buttons (+30 days, etc.) sit above the table.

### Data limit (GB)

Quota in GB; leave empty for unlimited.

- For trials, 10–50 GB is usually enough.

### IP limit

Simultaneous IPs allowed; set to 1–2 to reduce sharing.

## Service & inbounds {#dialog-dialog-service}

Pick how links are generated and which inbound/protocol to use.

### Service

If you use predefined plans, select one so settings auto-fill.

### Inbounds / protocols

Choose an inbound per protocol (vless/vmess/trojan/ss) so the user link is built.

- If the list is empty, add an inbound first under Hosts/Nodes.
- If you use setservice-* inbound, select it alone; it auto-selects the linked service.
- When service is selected manually, inbound selections are ignored.

### Flow / TLS

Optional flow (e.g., xtls-rprx-vision) or custom credential; leave blank if unsure.

## Access keys & links {#dialog-dialog-access}

Subscription link and optional manual credential key.

### Manual credential key

Tick Manual to paste a custom 32-char key.

### Subscription link / QR

After saving, copy a fresh link or QR from the users table.

## Auto Renew {#dialog-dialog-auto-renew}

Keep accounts alive without manual edits.

### Data limit

Quota to apply when the cap is reached.

- Use add remaining to carry leftover traffic into the next cycle.

### Time limit (days)

Days to add to expiry; zero means no time cap.

### Fire on either

If enabled, renews when either time or quota hits first.

## Notes & contact {#dialog-dialog-other}

Support details so you remember who’s who.

### Note

Short context about the user or deal; helps searching later.

### Telegram ID / Contact number

Contact info for support follow-up.

---
title: "Status guide"
weight: 2
---

<span id="statuses"></span>

## On Hold (waiting for first connect) {#status-on_hold}

`on_hold`

Account exists but hasn’t connected yet. First successful connection flips it to active and starts timers.

### What to do

- Use it for trials or brand new customers.
- If the on-hold timer runs out, either extend the timer or clean it up.
- Keep the IP limit low to avoid link sharing.

## Active (in use) {#status-active}

`active`

Normal state. Usage, expiry, and logs are tracked.

### What to do

- Add quota or extend expiry whenever needed, or reset usage to start fresh.
- If you want to pause without deleting, switch to disabled.

## Limited (quota reached) {#status-limited}

`limited`

Data cap is hit and the connection is restricted.

### What to do

- Add more quota, reset usage, or flip back to active after you charge them.
- Enable Auto Renew with "add remaining" if you don’t want leftover traffic to vanish.

## Expired (date passed) {#status-expired}

`expired`

Expiry is in the past and the user can’t connect.

### What to do

- Move the expiry forward or reset usage and reactivate.
- If it’s been dormant for a while, revoke the subscription and send a fresh link.

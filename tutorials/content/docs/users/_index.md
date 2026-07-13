---
title: "Users"
weight: 2
description: "Create, find, renew, and troubleshoot users from one place."
---

The Users page is the daily workspace for creating accounts, checking access, and sharing subscription links. Each row shows the user's current status, expiry, traffic, and available actions.

<p class="rb-panel-actions"><a class="rb-panel-button" href="#" data-panel-route="/users">Open users</a><a class="rb-panel-button" data-primary="true" href="#" data-panel-route="/users" data-session-key="openCreateUser" data-session-value="true">Create user</a></p>

## Choose a task

- [Create a user](create-user/) — set the account limits, service, inbounds, and delivery link.
- [Search users by links or IDs](search-users/) — find an account from a subscription URL, token, key, UUID, or config link.
- [Get a single config](single-config/) — copy one inbound config instead of the full subscription.
- [Renew a user](renew-user/) — add time or traffic while keeping the existing account and link.
- [Prepare an on-hold user](on-hold/) — create the account now and start its timer on first connection.

## A reliable daily flow

1. Search before creating to avoid duplicate accounts.
2. Open the user row and confirm status, expiry, data limit, service, and inbounds.
3. Save the change, then copy a fresh subscription link or QR code.
4. If access still fails, check the status guide and the selected inbound before changing the link again.

{{< callout type="info" >}}
Use a short internal note for plan type, owner, or support context. It makes later searches and renewals much easier.
{{< /callout >}}

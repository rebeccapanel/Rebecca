---
title: "Administration"
weight: 5
description: "Manage nodes, admins, roles, service automation, and scheduled backups."
adminOnly: true
---

Administration contains system-wide tasks. It is shown only to `sudo` and `full_access` administrators because these actions can change infrastructure, permissions, or shared services.

## Guides

- [Service inbound auto-assign](service-auto-inbound/) — select a service automatically from inbound tags.
- [Telegram backup activation](telegram-backup/) — connect the bot and schedule panel backups.
- [Nodes](nodes/) — create the node in the panel first, copy its install bundle, and connect the node host.
- [Admins](admins/) — create administrators and apply limits.
- [Admin roles](roles/) — understand the access level behind each role.

{{< callout type="warning" >}}
Confirm the target and keep a current backup before changing nodes, roles, or shared integration settings.
{{< /callout >}}

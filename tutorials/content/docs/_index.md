---
title: "Panel overview"
weight: 1
description: "Rebecca panel to create, manage, and troubleshoot users, admins, and nodes. Main areas: Dashboard, Users, Admins, Services, Hosts, Nodes, Integrations, My Account."
cascade:
  params:
    noindex: true
---

This page is a quick walk-through so you can ship accounts fast without touching the backend.

Rebecca panel to create, manage, and troubleshoot users, admins, and nodes. Main areas: Dashboard, Users, Admins, Services, Hosts, Nodes, Integrations, My Account.

- Create/renew users, statuses (active/on hold/limited/expired), links/QR, Auto Renew.
- Admins with roles and permissions, data limit and user limit.
- Nodes with a dedicated certificate bundle; monitor connectivity and metrics from Node settings.
- Settings for runtime behavior, backups, Telegram, subscriptions, and templates.
- My Account: API keys, password change, daily and per-node usage charts.
- Open source—if it helps you, please star the GitHub repo.

- [GitHub](https://github.com/rebeccapanel/rebecca)
- [Telegram](https://t.me/rebeccapanel)

## Start with a task

- [Manage users](users/) — create, search, renew, or troubleshoot an account.
- [Review account settings](account/) — manage your password, API keys, and usage.
- [Configure the panel](settings/) — understand each settings tab before changing shared behavior.

<p class="rb-admin-only"><a href="admin/">Open administration guides</a> — nodes, admins, roles, and automation for privileged administrators.</p>

## Quick tips

- When you create a fresh user, set the status to on hold so it only starts counting after the first connection.
- Always leave a short note (monthly, test, VIP) so future-you remembers what this account is for.
- If someone says the link is broken, copy the subscription URL or QR from the table to generate a clean link.
- Before deleting an account, revoke the subscription so old links stop working.
- Pro tip: the Users search box accepts subscription links, tokens, keys, UUIDs, and full config links.

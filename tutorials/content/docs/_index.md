---
title: "Panel overview"
weight: 1
description: "Rebecca panel is a VPN service management panel. After evaluating various options, the Vento team stopped the development of its proprietary panel due to the comprehensive structure and features of this panel, and chose Rebecca as the main platform. This panel is used to create and manage customer accounts."
cascade:
  params:
    noindex: true
---

This page is the operational guide for the panel. Reading it before getting started is recommended.

Rebecca panel is a VPN service management panel. After evaluating various options, the Vento team stopped the development of its proprietary panel due to the comprehensive structure and features of this panel, and chose Rebecca as the main platform. This panel is used to create and manage customer accounts.

- Create and renew users with active / on hold / limited / expired statuses, links and QR codes, and Auto Renew.
- Quick search for users by username, link, or subscription code.
- My Account: API keys, password change, daily and per-node usage reports.
- Open source—if it helps you, please star the GitHub repo.

- [Rebecca Panel GitHub](https://github.com/rebeccapanel/rebecca)
- [Vento Team Support](https://t.me/V2raySam)

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

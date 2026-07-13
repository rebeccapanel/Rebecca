---
title: "Admins"
weight: 4
description: "Three parts: admin overview, how to manage, and admin roles (each role its own box)."
adminOnly: true
---

<span id="section-admins-page"></span>

Three parts: admin overview, how to manage, and admin roles (each role its own box).

<p class="rb-panel-actions"><a class="rb-panel-button" href="#" data-panel-route="/admins">Go to Admins</a><a class="rb-panel-button" data-primary="true" href="#" data-panel-route="/admins" data-session-key="openCreateAdmin" data-session-value="true">Create admin</a></p>

## Overview {#section-admins-page-intro}

Table shows role, status, data/user caps, and quick stats; filter to find faster.

## How to manage {#section-admins-page-guide}

1. Click Add admin, set username/password, and pick a role (Full Access / Sudo / Reseller / Standard).
2. Set data_limit and users_limit so their scope is bounded.
3. Use enable/disable to pause or resume the admin and their users.
4. Delete is a soft delete for the admin and their users; use the shortcut to open create-admin quickly.

{{< callout type="info" >}}
**Good to know**

- After raising limits or resetting usage, re-enable if still paused.
- Keep Full Access rare; prefer Sudo/Standard for support teams.
{{< /callout >}}

## Full Access {#section-admins-page-role-full-access}

Owner-level control over all sections and sensitive settings (Users, Admins, Services, Hosts, Nodes, Integrations, settings).

1. Create/edit roles, services, nodes, and integrations without restriction.
2. Set limits and permissions for other admins and users.
3. Reserve for the primary owner; keep the count low.

{{< callout type="info" >}}
**Good to know**

- Review permissions before handing this role to someone else.
- Use strong passwords and 2FA for this role.
{{< /callout >}}

## Sudo {#section-admins-page-role-sudo}

High operational access without full ownership; ideal for senior support/ops.

1. Create/edit users, services, and nodes (except owner-only settings).
2. Can handle most daily operations but limited on ownership changes.
3. Keep the number small to reduce risk.

{{< callout type="info" >}}
**Good to know**

- If they don’t need to manage Full Access, Sudo is enough.
- Review limits and logs regularly.
{{< /callout >}}

## Reseller {#section-admins-page-role-reseller}

Seller/agent with defined data/user caps; manages only their own users.

1. Create/manage their own users within users_limit and data_limit.
2. No access to sensitive system sections beyond what selling requires.
3. Use for partners with scoped access.

{{< callout type="info" >}}
**Good to know**

- On-hold users do not count toward users_limit; active ones do.
- Set caps to match the contract scope.
{{< /callout >}}

## Standard {#section-admins-page-role-standard}

Most limited; sees/edits only the sections you enable.

1. Good for trainees or constrained support.
2. Each section (Users, Admins, Services, ...) must be enabled explicitly.
3. Self permissions decide which My Account cards show.

{{< callout type="info" >}}
**Good to know**

- For view-only, enable can_view and leave can_edit off.
- Add permissions gradually if you plan to upgrade them.
{{< /callout >}}

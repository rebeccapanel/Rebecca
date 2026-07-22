---
title: "Settings"
weight: 4
adminOnly: true
description: "Understand the Panel, Backup, Telegram, Subscriptions, and Template Creator tabs before changing shared behavior."
---

Settings controls shared panel behavior and integrations. Available tabs and actions depend on your administrator permissions and installation mode.

<p class="rb-panel-actions"><a class="rb-panel-button" data-primary="true" href="#" data-panel-route="/settings#panel">Open settings</a></p>

## Before you change anything

- Settings are shared. A change can affect other admins, generated subscriptions, usage history, or node operations.
- Each tab saves separately. Wait for the success message before leaving the tab.
- Take a current backup before importing data, changing templates, or running maintenance actions.
- Options marked as binary-only are unavailable on Docker installations.

## Panel tab {#panel-tab}

<p class="rb-panel-actions"><a class="rb-panel-button" href="#" data-panel-route="/settings#panel">Open Panel tab</a></p>

### Default subscription link format

This chooses the link shown by default in the dashboard. It does not invalidate the other supported formats.

| Format | When to use it |
| --- | --- |
| `username/key` | A readable path that identifies the user and includes the key. |
| `key only` | A shorter path that does not expose the username. |
| `token` | A token-based link for integrations or existing client workflows. |

### Runtime settings

| Option | What it changes | Trade-off |
| --- | --- | --- |
| **Dashboard path** | Changes the path served by the Rebecca binary, such as `/dashboard/`. | Update the reverse proxy and bookmarks at the same time or the dashboard may appear unavailable. |
| **Subscription read-only mode** | Serves subscriptions without updating their last-used metadata. | Useful behind external caches, monitors, or probes; last-use information will no longer reflect every fetch. |
| **Record node usage** | Stores node traffic history used by the Usage page. | Enables historical node reports and adds database writes and storage. |
| **Record user usage samples** | Stores per-user, admin, and service usage samples. | Enables more detailed history and adds more frequent database writes. |
| **Enable API docs** | Serves the embedded OpenAPI/Swagger interface at `/docs`. | Enable it when admins or integrations need to inspect the API. API authentication and permissions still apply. |

{{< callout type="info" >}}
Leave both usage-recording options enabled when you need historical charts. If database write volume matters more than history, disable only the samples you do not use.
{{< /callout >}}

### phpMyAdmin

The phpMyAdmin section is available for MySQL and MariaDB installations. It can install or enable phpMyAdmin, open it inside the panel, choose its route, and use either Rebecca's database account or custom credentials. Keep the route private and do not expose database credentials to other admins.

### Maintenance

Maintenance shows the current panel version and update channel. Binary installations can update, soft reload, or restart from the panel. Docker installations show these actions as unavailable because host-level lifecycle operations must be run outside the dashboard.

- **Latest** follows stable releases.
- **Dev build** may contain unfinished changes or migrations; use it only when you accept that risk.
- **Soft Reload** reloads panel configuration without intentionally interrupting connections.
- **Restart** briefly makes the dashboard and API unavailable.

## Backup tab {#backup-tab}

<p class="rb-panel-actions"><a class="rb-panel-button" href="#" data-panel-route="/settings#backup">Open Backup tab</a></p>

Rebecca exports a portable `.rbbackup` file that can be restored across SQLite, MySQL, and MariaDB installations.

| Scope | Included data |
| --- | --- |
| **Database only** | Rebecca database records. Server files are left untouched during restore. |
| **Database + Rebecca files** | Database plus Rebecca configuration and data directories, including `/etc/rebecca` and `/var/lib/rebecca`. |

Import replaces the selected current data. Verify the scope and file before confirming, and keep a separate known-good backup. Export and import are host-level operations and are available only in binary mode.

## Telegram tab {#telegram-tab}

<p class="rb-panel-actions"><a class="rb-panel-button" href="#" data-panel-route="/settings#telegram">Open Telegram tab</a></p>

1. Create a bot and paste its **Bot API Token**. Treat the token as a password.
2. Add numeric **Admin Chat IDs**. Use **Logs Chat ID** when logs should go to a different chat or channel.
3. If the destination is a forum, enable the matching forum option and map topic IDs.
4. Configure a proxy only when the panel host cannot reach Telegram directly.
5. Send a test message before enabling notifications or scheduled backups.

### Periodic backup

Scheduled Telegram backup is available only on binary installations. Choose database-only or full scope, select the interval, and optionally set a dedicated backup chat. **Send backup now** is the quickest way to verify permissions and file delivery.

### Notifications

Notification groups cover user, admin, node, login, and error events. Enable only events that require action; sending every event to one chat makes operational alerts harder to notice.

## Subscriptions tab {#subscriptions-tab}

<p class="rb-panel-actions"><a class="rb-panel-button" href="#" data-panel-route="/settings#subscriptions">Open Subscriptions tab</a></p>

Global subscription settings apply to every admin unless that admin has an override.

- **Subscription URL prefix** sets the public base domain for generated links. Leave it empty for relative URLs.
- **Custom templates directory** changes where Jinja templates are loaded from.
- **Subscription profile title**, **Support URL**, and **Profile update interval** are sent to compatible clients and shown on subscription pages.
- Client template fields choose the files used for the subscription page, home page, Clash, V2Ray, Happ, Incy, Sing-box, and Mux outputs.
- **Subscription alias URLs** adds compatible route aliases, one per line.
- **Subscription ports** adds extra ports to generated subscription URLs.
- Client JSON switches choose whether Rebecca uses custom JSON behavior for supported clients.

Admin overrides should be the exception. Keep common values global, override only the admin that needs a different domain or template, and use **Reset overrides** to return it to global defaults.

## Template Creator tab {#template-creator-tab}

<p class="rb-panel-actions"><a class="rb-panel-button" href="#" data-panel-route="/settings#template-creator">Open Template Creator</a></p>

Template Creator builds a subscription page visually with drag-and-drop widgets. Preview the result at desktop and mobile widths before saving. The panel currently marks this tab as under active development, so keep a copy of the working template and avoid making an untested draft the production default.

## Suggested order for a new panel

1. Set the dashboard and default subscription behavior in **Panel**.
2. Export a baseline backup from **Backup**.
3. Configure and test Telegram before enabling event notifications.
4. Set global subscription values, then add only necessary admin overrides.
5. Treat Template Creator output as a draft until it has been checked on real client links.

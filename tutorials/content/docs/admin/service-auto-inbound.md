---
title: "Service inbound auto-assign"
weight: 1
description: "Use service inbound tags to auto-select a service while creating or editing users."
adminOnly: true
---

<span id="section-service-auto-inbound"></span>

Use service inbound tags to auto-select a service while creating or editing users.

## Steps

1. Go to Services, open a service, and create its "Service inbound". The tag format is setservice-<service_id>.
2. In Create/Edit user, if no service is selected, choose only that service inbound tag in inbounds.
3. The panel automatically assigns the linked service and applies service-specific inbounds/hosts.
4. If you manually select a service, inbound selections are ignored and service settings are applied.

{{< callout type="info" >}}
**Good to know**

- Service inbound must be selected alone. Do not combine it with any other inbound tag.
- If you need manual inbound control, do not use the setservice-* inbound.
- Use the service tutorial from Nodes/Services page for troubleshooting and exact setup.
{{< /callout >}}

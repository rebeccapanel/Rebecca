---
title: "Nodes"
weight: 3
description: "Create the node in Rebecca first, then install the node host with its dedicated certificate bundle."
adminOnly: true
---

<span id="section-nodes-admin"></span>

Every node has its own panel record and mTLS certificate bundle. Create the record in Rebecca first; the panel generates the bundle that the node installer needs.

<p class="rb-panel-actions"><a class="rb-panel-button" data-primary="true" href="#" data-panel-route="/node-settings">Open Node settings</a><a class="rb-panel-button" href="https://github.com/rebeccapanel/Rebecca#rebecca-node" target="_blank" rel="noopener noreferrer">View node documentation</a></p>

## Before you start {#section-nodes-admin-intro}

- Choose the node address and two different ports. Rebecca defaults are service port `62050` and Xray API port `62051`.
- Make sure the main panel can reach the node address and service port. Restrict firewall access to the panel server whenever possible.
- Keep the node clock synchronized with NTP; certificate validation and usage timestamps depend on correct time.
- Decide whether traffic should count normally. A usage coefficient of `1` keeps real usage; `2` counts the node's user traffic twice.

## 1. Create the node in the panel {#section-nodes-admin-guide}

1. Open **Node settings** and select **Add node**.
2. Enter a clear internal name and the IP address or hostname that the main panel can reach.
3. Set **Node port** and **API port** to the same values you will use during installation. The ports must be different.
4. Leave **Usage coefficient** at `1` unless you intentionally bill or account for this node at a multiplier.
5. Set an optional **Data limit** for the node. An empty value means unlimited.
6. Add an internal note, or enable the master-to-node proxy only when your network requires it.
7. Select **Add node**. Rebecca now creates the node record and generates a dedicated certificate plus private key.

{{< callout type="warning" >}}
Copy or download the complete **Node install bundle** immediately. It contains both the certificate and its private key. Do not share it, paste only part of it, or reuse it for another node.
{{< /callout >}}

## 2. Install Rebecca Node on the node server

Run the binary installer on the node host:

```bash
curl -sL https://raw.githubusercontent.com/rebeccapanel/Rebecca/master/scripts/rebecca/rebecca-node-binary.sh | sudo bash -s -- install
```

1. When the installer asks for the **Node install bundle**, paste the full block copied from the panel. The installer separates the certificate and private key automatically.
2. Enter the same service and Xray API ports used in the panel record.
3. Finish the installer and let it start the `rebecca-node` service.
4. Do not install the same bundle on a second server. Create another panel node for every additional host.

## 3. Verify the connection

Return to **Node settings** and wait for the status to become **Connected**. Open the node to check its address, ports, certificate state, Xray version, CPU, RAM, bandwidth, and recent traffic.

If it stays on Connecting or Error, check these in order:

| Check | What to verify |
| --- | --- |
| Address and ports | The panel record matches the node installer values and the ports are not swapped. |
| Firewall and routing | The main panel can reach the node service port; DNS resolves to the correct host. |
| Certificate bundle | The full certificate and private key belong to this node. |
| Service | `rebecca-node` is running; inspect its service logs for the first connection error. |
| Time | Both servers have correct system time and NTP is active. |

## Reinstalling or replacing a node

Use the existing node record when the host identity should stay the same. Generate a private certificate only when you are ready to reinstall the node with the new bundle; the old certificate will no longer match the panel. Create a separate node record when adding another server.

{{< callout type="info" >}}
The node overview is also the quickest place to distinguish a connectivity problem from an Xray or resource problem: connection status and its error message appear before the runtime metrics.
{{< /callout >}}

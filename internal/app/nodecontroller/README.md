# Node Controller

This package orchestrates operational communication with nodes.

It uses node database records and the gRPC node client to fetch status and
metrics, sync Xray config, restart/reconnect runtime, update geo/runtime/service
assets, collect usage, and read logs.

Use this package for runtime node actions. Use `node` only for node CRUD and
certificate mutation.

## How state reaches nodes

The database is the source of truth. `node_operations` rows are only a durable
"this node has work" marker written in the same transaction as the change, so a
crash never loses an update. Delivery does not go through a polling queue.

`Coordinator` (`coordinator.go`) owns delivery:

- Every successful mutating API request and every producer calls `Kick()`.
  Kicks coalesce into one wake-up. A 5 second safety tick covers producers that
  do not kick (usage lifecycle, expiry workers).
- A wake-up lists the connected nodes that have open rows and starts one worker
  per node. A node is never processed twice at once, a kick that arrives while a
  node is being processed marks it dirty and triggers one more pass, and a slow
  or dead node only delays itself (at most 16 nodes are processed in parallel).
- A pass is `ProcessQueue(NodeID)`: config syncs first, then user changes
  batched per node, only the latest change per user. A full sync supersedes every
  open row of that node.
- A failing node backs off 1s, 2s, 4s ... up to 30s. The third consecutive
  failure queues one full sync for that node, and the sixth ends the attempt until
  the next safety tick.
- Maintenance (every 10s): stale `running` rows are recovered, rows of nodes that
  are not connected are dropped (a connect, restart, update or recovery always
  runs a full sync that rebuilds everything from the database), a node with more
  than 200 open user rows is collapsed into one full sync, nodes whose applied
  revision lags get a full sync, and finished rows are deleted at once so the
  table stays small.
- A node that comes back after a failure, or reports that xray is not started,
  gets a full sync (xray not started at most every 5 minutes per node).

A full sync loads every user for the protocols the node serves. With 100000
users and all seven protocols that is about 730 MB and 2.3 s of database time
(`BenchmarkRuntimeUsers100k`); builds are serialized, so this is the peak for one
master.

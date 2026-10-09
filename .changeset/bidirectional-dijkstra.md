---
"@osmix/router": minor
---

`bidirectional` is now bidirectional Dijkstra: it searches backward over incoming edges, returns an optimal path and respects one-way edges. It was a breadth-first search that could return a longer path. Routing algorithms take an optional `RoutingAlgorithmContext` (`reverseGraph`, `maxSpeedMps`), which `Router` supplies; `RoutingGraph` adds `getIncomingEdges` and `maxSpeedMps`, and A*'s time heuristic uses the graph's maximum speed.

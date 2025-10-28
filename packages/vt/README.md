# @osmix/vt

`@osmix/vt` converts Osmix binary overlays (typed-array node and way payloads) into Mapbox Vector Tiles. It also ships a lightweight tile index with LRU caching so workers or web apps can request tiles on demand without re-projecting data for every request.

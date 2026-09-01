---
"@osmix/cli": patch
---

Add an OpenTUI Three.js WebGPU vector backend, with terminal-pixel output through Kitty Graphics or
Sixel when supported, while retaining quadrant and raster compatibility fallbacks. The
`OSMIX_CLI_RENDERER` environment variable selects or requires a backend.

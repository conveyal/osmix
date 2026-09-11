---
"@osmix/change": patch
"osmix": patch
---

Preserve shared junctions during intersection creation by updating every incident way and affected restriction via-node together. Existing bridge and tunnel entrances stay connected, while unsafe shared-junction substitutions leave the original references unchanged and new grade-separated interior crossings remain disconnected. Detached restriction errors identify the via node and participating from/to ways to make source-data corrections easier.

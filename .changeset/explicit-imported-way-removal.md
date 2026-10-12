---
"@osmix/change": patch
"osmix": patch
---

Add default-off, explicitly reviewed removal of equivalent imported ways, independently of copying tags and connecting the network. Require a supported retained base counterpart, compatible routing meaning, and verified branch connections; automatic connections alone cannot authorize removal. Block unsafe topology, relation involvement, and unsupported segmentation, and clean only untagged imported points newly orphaned by the selected removal.

Removal is a `remove-way` proposal in the merge plan (`allowWayRemoval`), blocked until the connections it needs are included; automation levels and bulk choices never include it. The matching outcome lists each applied removal with its source and base IDs, attributes, branch connections and cleanup. Tag-copying and connection-only merges keep their imported geometry.

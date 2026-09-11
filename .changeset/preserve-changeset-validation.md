---
"@osmix/change": patch
"osmix": patch
---

Add a supported changeset JSON round trip that preserves integrity validation using verified base and patch input context. Recompute inherited issues from matching original input snapshots instead of trusting serialized issue exemptions. Keep safe legacy changes-only snapshots usable, and explain when missing source context requires restoring a newer snapshot or regenerating the changeset.

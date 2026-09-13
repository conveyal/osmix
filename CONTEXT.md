# Osmix merge language

Osmix combines existing OpenStreetMap data with imported additions and updates. These terms distinguish attribute changes from changes to geometry and connectivity.

## Language

**Base OSM**:
The authoritative existing dataset against which imported features are compared.
_Avoid_: Original file, destination file

**Patch OSM**:
The dataset of imported additions and updates to combine with the base.
_Avoid_: Second file, source file

**OSM node**:
A point with latitude and longitude that can represent a feature, such as a crossing, or form part of a way's geometry.

**OSM way**:
An ordered sequence of node references representing a line or an area boundary, such as a sidewalk or building outline.

**Direct merge**:
The combination of patch-only additions, same-ID patch updates, and unchanged base-only entities.

**Exact reconciliation**:
The representation of different IDs by one base entity when their coordinates or ordered geometry and routing context agree.

**Imported-data matching**:
The comparison of nearby patch and base features to propose correspondences despite differences in their coordinates or geometry.
_Avoid_: Proximity deduplication

**Candidate**:
A proposed correspondence between an imported feature and a base feature, with evidence and separate eligibility for copying tags and connecting networks. A candidate does not by itself select either action.
_Avoid_: Confirmed match

**Match evidence**:
The locations, measured differences, attributes, and connection context used to assess a proposed correspondence. Proximity is evidence of a possible match, not proof that either matching action is safe.

**Candidate distance**:
The measured separation between a proposed pair: point-to-point distance for nodes, or the maximum sampled separation between way geometries. An unavailable measurement differs from finding no eligible target in the search area.

**Alternative targets**:
Possible base counterparts proposed for the same imported feature. They are reviewed together because that feature can have matching actions scheduled for at most one target.

**Selected target**:
The base counterpart for which at least one matching action is scheduled. Choosing a target selects its eligible configured actions; Copy tags and Connect network can then be adjusted independently. Scheduling an action for another counterpart replaces the prior target. Turning both off leaves no selected target.

**Leave unmatched**:
An explicit choice to schedule no matching actions for any alternative target of an imported feature. Ordinary imported additions still follow the direct/exact merge rules. This choice can be made even when discovery found possible targets.
_Avoid_: Discard imported feature

**OSM tags**:
Key-value feature attributes, such as `surface=asphalt` or `kerb=lowered`.
_Avoid_: Labels, annotations

**Copy tags**:
An attribute-only update that copies selected imported tag values onto a matched base feature while preserving the geometry and shared-node connections produced by the ordinary direct/exact merge. Missing imported values leave base values unchanged. Reviewed routing tags can still change which journeys are permitted.
_Avoid_: Replace feature, remove duplicate geometry

**Property transfer**:
The API term for copying tags; it has the same attribute-only meaning.

**Connect network**:
A connectivity change that connects imported ways to preserved base nodes through accepted reference changes.
_Avoid_: Copy tags, property transfer

**Network attachment**:
The API term for connecting the imported network to the base network. Selecting this action is independent of selecting Copy tags.

**Shared junction**:
A node referenced by multiple ways that already connects those ways, including a bridge or tunnel entrance where the connected ways can have different grade tags.
_Avoid_: Nearby endpoints

**Intersection creation**:
The addition of a shared node at a compatible crossing, with existing junction connections preserved. Crossing geometry alone does not establish a connection between ways at different grades.

**Geometry removal**:
The removal of imported entities deemed redundant, with consequences for any connected ways or relations; it is distinct from copying their tags.

**Scheduled action**:
An eligible matching action that the current automatic rules or saved choices select for inclusion in the next matching preview. Eligibility alone does not mean an action is scheduled. Applying the preview is a separate step.

**Automatic action**:
A matching action scheduled by the configured rules without an individual selection. A saved choice can turn it off, and skipping the match schedules neither action. Automatic does not mean already applied.
_Avoid_: Applied automatically, completed match

**Applied action**:
A matching action that changed the result when matching was applied, before intersection creation. Copying one or more tag values counts as one tag-copy action for an imported feature; changing one or more imported way references for a matched node counts as one network-connection action. An eligible, scheduled, or already-satisfied action is not an applied change. Later intersection work can further connect or remap junctions.

**Unresolved imported feature**:
An imported feature with work still needing attention at the end of matching, such as an ambiguous target, a blocked action, or no available target. Alternative candidates for the same feature count once. A feature can have an applied action and unresolved work; deliberate whole-feature skips are counted separately. A later intersection connection does not retroactively count as a matching action.
_Avoid_: Failed import

**Retained imported feature**:
An imported feature that remains after the reported merge stage under the ordinary direct/exact merge rules, whether matching actions were applied, skipped, or unresolved. Retention does not mean that its attributes were copied to a base target or that its network was connected.

**Skip match**:
A decision to schedule neither Copy tags nor Connect network for a proposed correspondence while retaining the imported feature under the ordinary direct/exact merge rules.
_Avoid_: Delete imported feature

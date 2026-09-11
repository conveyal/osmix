# Osmix merge language

Osmix combines existing OpenStreetMap data with imported additions and updates. These terms distinguish attribute changes from changes to geometry and connectivity.

## Language

**Base OSM**:
The authoritative existing dataset against which imported features are compared.
_Avoid_: Original file, destination file

**Patch OSM**:
The dataset of imported additions and updates to combine with the base.
_Avoid_: Second file, source file

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

**Skip match**:
A decision to schedule neither Copy tags nor Connect network for a proposed correspondence while retaining the imported feature under the ordinary direct/exact merge rules.
_Avoid_: Delete imported feature

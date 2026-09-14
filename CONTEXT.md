# Osmix merge language

Osmix combines existing OpenStreetMap data with imported additions and updates. These terms distinguish attribute changes from changes to geometry and connectivity. The [merge-process guide](docs/merge-process.md) defines the behavioral rules and workflow.

## Language

**Base OSM**:
The existing dataset that supplies reference identities and geometry for comparison with an import.
_Avoid_: Original file, destination file

**Patch OSM**:
The dataset of imported additions and updates to combine with the base.
_Avoid_: Second file, source file

**OSM node**:
A point with latitude and longitude that can represent a feature, such as a crossing, or form part of a way's geometry.

**OSM way**:
An ordered sequence of node references representing a line or an area boundary, such as a sidewalk or building outline.

**OSM relation**:
An ordered collection of typed entity references and roles representing a relationship such as a route, boundary, or turn restriction.

**Direct merge**:
The combination of patch-only additions, same-ID patch updates, and unchanged base-only entities.

**Exact reconciliation**:
The representation of different entity IDs by one base entity when their coordinates or ordered geometry and context agree.

**Imported-data matching**:
The comparison of nearby patch and base features to propose correspondences despite differences in their coordinates or geometry.
_Avoid_: Proximity deduplication

**Candidate**:
A proposed correspondence between an imported feature and a base feature, with evidence and separate action assessments.
_Avoid_: Confirmed match

**Match evidence**:
The locations, measured differences, attributes, and connection context used to assess a proposed correspondence.

**Feature classification**:
An explicit attribute describing what a feature represents, such as a school or cafe.

**Feature type conflict**:
Contradictory explicit classifications on a proposed pair, such as a base cafe and an imported school.

**Candidate distance**:
The measured separation between a proposed pair: point-to-point distance for nodes, or maximum sampled separation between way geometries.

**Alternative targets**:
Possible base counterparts proposed for the same imported feature.

**Selected target**:
The base counterpart for which at least one matching action is scheduled.

**Leave unmatched**:
An explicit choice to schedule no matching actions for any alternative target of an imported feature.
_Avoid_: Discard imported feature

**OSM tags**:
Key-value feature attributes, such as `surface=asphalt` or `kerb=lowered`.
_Avoid_: Labels, annotations

**Copy tags**:
An attribute-only update that copies selected imported tag values onto a matched base feature.
_Avoid_: Replace feature, remove duplicate geometry

**Property transfer**:
The API term for copying tags; it has the same attribute-only meaning.

**Connect network**:
A connectivity change that connects imported ways to preserved base nodes through accepted reference changes.
_Avoid_: Copy tags, property transfer

**Network attachment**:
The API term for connecting the imported network to the base network.

**Shared junction**:
A node referenced by multiple ways that already connects those ways, including a bridge or tunnel entrance where the connected ways can have different grade tags.
_Avoid_: Nearby endpoints

**Intersection creation**:
The addition of a shared node reference at a compatible crossing.

**Geometry removal**:
The explicit removal of a redundant imported way with an equivalent retained base counterpart.

**Remove imported way**:
The user-facing choice to schedule geometry removal for one reviewed imported way.

**Orphan-node cleanup**:
The removal of untagged imported points left without references by an explicitly removed way.

**Scheduled action**:
An eligible matching action selected by the current automatic rules or saved choices for the next preview.

**Automatic action**:
A copying or connection action scheduled by configured rules without an individual selection.
_Avoid_: Applied automatically, completed match

**Applied action**:
A matching action that changed the result when matching was applied, before intersection creation.

**Unresolved imported feature**:
An imported feature with work still needing attention at the end of matching, such as an ambiguous target, a blocked action, or no available target.
_Avoid_: Failed import

**Retained imported feature**:
An imported feature that remains after the reported merge stage.

**Skip match**:
A decision to schedule no matching action for a proposed correspondence while retaining the imported feature under the ordinary direct/exact merge rules.
_Avoid_: Delete imported feature

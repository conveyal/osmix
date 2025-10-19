# @osmix/test-utils

`@osmix/test-utils` centralizes shared Vitest utilities, fixture helpers, and common metadata used across the Osmix workspace. The package is private and intended for internal consumption.

## Highlights

- Resolve fixture paths via `getFixturePath` so tests can share gzipped extracts in `fixtures/`.
- Read or stream fixture PBF files with caching helpers (`getFixtureFile`, `getFixtureFileReadStream`, `getFixtureFileWriteStream`).
- Reuse curated fixture metadata (`PBFs`) when asserting entity counts in integration tests.

## Usage

```ts
import { getFixtureFile, PBFs } from "@osmix/test-utils/fixtures"

const buffer = await getFixtureFile(PBFs.monaco.url)
```

Helpers target modern Node runtimes (the package assumes global `fetch` is available).

## Known limitations

- Several entries in `PBFs` point at large Geofabrik downloads; only `monaco` is included by default so CI stays fast. Extend the exported subset deliberately when adding new tests.
- Fixture metadata (`way0`, `relation0`, etc.) contains placeholder values for some remote extracts. Audit these before depending on them in assertions.
- `getFixtureFileWriteStream` writes to the shared `fixtures/` directory; clean up temporary files after tests to avoid polluting the repository.

// Recommended and maximum header and blob sizes as defined by the OSM PBF specification
// Header: 32 KiB and 64 KiB
export const RECOMMENDED_HEADER_SIZE_BYTES = 32 * 1024
export const MAX_HEADER_SIZE_BYTES = 64 * 1024
// Blob: 16 MiB and 32 MiB
export const RECOMMENDED_BLOB_SIZE_BYTES = 16 * 1024 * 1024
export const MAX_BLOB_SIZE_BYTES = 32 * 1024 * 1024

// Recommended maximum number of entities per block
export const MAX_ENTITIES_PER_BLOCK = 8_000

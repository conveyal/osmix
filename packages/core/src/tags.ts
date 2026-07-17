/**
 * Tag storage and lookup.
 *
 * Stores key=value pairs using string table indices. Supports:
 * 1. **Entity → Tags**: Retrieve tags for a given entity.
 * 2. **Key → Entities**: Find entities with a specific tag key.
 *
 * @module
 */

import type { ContentHasher } from "@osmix/shared/content-hasher";
import type { OsmTags } from "@osmix/types";

import StringTable from "./stringtable.ts";
import { BufferConstructor, type BufferType, ResizeableTypedArray as RTA } from "./typed-arrays.ts";

const TAG_RANK_BLOCK_SIZE = 256;
const TAG_BITS_PER_WORD = 32;

/**
 * Serializable state for worker transfer.
 */
export interface TagsTransferables<T extends BufferType = BufferType> {
  /** Exact number of entities represented by this tag index. */
  tagEntityCount: number;
  /** One presence bit per entity. */
  taggedEntityBits: T;
  /** Tagged-entity prefix count at each 256-entity boundary. */
  tagRankCheckpoints: T;
  /** Tag offsets for tagged entities, including a final sentinel. */
  tagOffsets: T;
  /** Flattened tag key indices. */
  tagKeys: T;
  /** Flattened tag value indices. */
  tagVals: T;

  /** Flattened entity indices for reverse key lookup. */
  keyEntities: T;
  /** Maps key index → start position in keyEntities. */
  keyIndexStart: T;
  /** Maps key index → count of entities with that key. */
  keyIndexCount: T;
}

/**
 * Bidirectional tag storage.
 *
 * Note: String indices reference a shared `StringTable`.
 */
export class Tags {
  /** Reference to the shared string table for key/value storage */
  private stringTable: StringTable = new StringTable();

  // ─── Entity → Tag Lookup ───────────────────────────────────────────────────
  /** Exact number of entities represented by this tag index. */
  private entityCount = 0;
  /** One presence bit per entity. */
  private taggedEntityBits: Uint32Array;
  /** Tagged-entity prefix count at each 256-entity boundary. */
  private tagRankCheckpoints: Uint32Array;
  /** Tag offsets for tagged entities, including a final sentinel. */
  private tagOffsets: RTA<Uint32Array>;
  /** All tag key string indices, concatenated */
  private tagKeys: RTA<Uint32Array>;
  /** All tag value string indices, concatenated (parallel to tagKeys) */
  private tagVals: RTA<Uint32Array>;

  // ─── Key → Entity Reverse Lookup ───────────────────────────────────────────
  /**
   * Flattened array of entity indices that have each tag key.
   * Indexed via keyIndexStart and keyIndexCount.
   */
  private keyEntities: RTA<Uint32Array>;

  /** Maps key string index → start position in keyEntities */
  private keyIndexStart: RTA<Uint32Array>;
  /** Maps key string index → count of entities with that key */
  private keyIndexCount: RTA<Uint32Array>;

  /**
   * Temporary map used during ingestion to collect entity indices per key.
   * Converted to flat arrays during buildIndex() and then cleared.
   */
  private keyEntityIndexBuilder = new Map<number, number[]>();

  /** Tagged entity indexes collected during ingestion and released on finalization. */
  private taggedEntityIndexBuilder: RTA<Uint32Array> | null;

  /** Whether buildIndex() has been called */
  private indexBuilt = false;

  /**
   * Create a new Tags index.
   */
  constructor(stringTable: StringTable, transferables?: TagsTransferables) {
    this.stringTable = stringTable;
    if (transferables) {
      this.entityCount = transferables.tagEntityCount;
      this.taggedEntityBits = new Uint32Array(transferables.taggedEntityBits);
      this.tagRankCheckpoints = new Uint32Array(transferables.tagRankCheckpoints);
      this.tagOffsets = RTA.from(Uint32Array, transferables.tagOffsets);
      this.tagKeys = RTA.from(Uint32Array, transferables.tagKeys);
      this.tagVals = RTA.from(Uint32Array, transferables.tagVals);
      this.keyEntities = RTA.from(Uint32Array, transferables.keyEntities);
      this.keyIndexStart = RTA.from(Uint32Array, transferables.keyIndexStart);
      this.keyIndexCount = RTA.from(Uint32Array, transferables.keyIndexCount);
      this.taggedEntityIndexBuilder = null;
      this.indexBuilt = true;
    } else {
      this.taggedEntityBits = new Uint32Array(new BufferConstructor(0));
      this.tagRankCheckpoints = new Uint32Array(new BufferConstructor(0));
      this.tagOffsets = new RTA(Uint32Array);
      this.tagKeys = new RTA(Uint32Array);
      this.tagVals = new RTA(Uint32Array);
      this.keyEntities = new RTA(Uint32Array);
      this.keyIndexStart = new RTA(Uint32Array);
      this.keyIndexCount = new RTA(Uint32Array);
      this.taggedEntityIndexBuilder = new RTA(Uint32Array);
    }
  }

  /**
   * Add tags to an entity.
   */
  addTags(index: number, tags?: OsmTags): [number[], number[]] {
    const tagKeys: number[] = [];
    const tagValues: number[] = [];

    if (tags) {
      for (const [key, value] of Object.entries(tags)) {
        tagKeys.push(this.stringTable.add(key));
        tagValues.push(this.stringTable.add(String(value)));
      }
    }

    this.addTagKeysAndValues(index, tagKeys, tagValues);

    return [tagKeys, tagValues];
  }

  /**
   * Add tags to an entity using key and value indexes.
   */
  addTagKeysAndValues(index: number, keys: number[], values: number[]) {
    if (this.indexBuilt) throw Error("Tag index already built.");
    if (keys.length !== values.length) throw Error("Tag keys and values must have equal length.");
    if (index < 0) throw Error(`Invalid entity index: ${index}`);
    this.entityCount = Math.max(this.entityCount, index + 1);
    if (keys.length === 0) return;

    this.taggedEntityIndexBuilder?.push(index);
    this.tagOffsets.push(this.tagKeys.length);
    this.tagKeys.pushMany(keys);
    this.tagVals.pushMany(values);

    keys.forEach((key) => {
      const keyEntities = this.keyEntityIndexBuilder.get(key);
      if (keyEntities) {
        keyEntities.push(index);
      } else {
        this.keyEntityIndexBuilder.set(key, [index]);
      }
    });
  }

  /**
   * Finalize the tag index.
   *
   * Compacts arrays and builds the reverse key→entity index.
   * Must be called before `hasKey()`.
   */
  buildIndex() {
    if (this.indexBuilt) return;

    const taggedEntityIndexes = this.taggedEntityIndexBuilder;
    if (!taggedEntityIndexes) throw Error("Tagged entity builder is unavailable.");
    const bitWordCount = Math.ceil(this.entityCount / TAG_BITS_PER_WORD);
    this.taggedEntityBits = new Uint32Array(
      new BufferConstructor(bitWordCount * Uint32Array.BYTES_PER_ELEMENT),
    );
    for (let i = 0; i < taggedEntityIndexes.length; i++) {
      const entityIndex = taggedEntityIndexes.at(i);
      const wordIndex = entityIndex >>> 5;
      this.taggedEntityBits[wordIndex] =
        (this.taggedEntityBits[wordIndex] ?? 0) | (1 << (entityIndex & 31));
    }

    const checkpointCount = Math.ceil(this.entityCount / TAG_RANK_BLOCK_SIZE) + 1;
    this.tagRankCheckpoints = new Uint32Array(
      new BufferConstructor(checkpointCount * Uint32Array.BYTES_PER_ELEMENT),
    );
    let taggedIndex = 0;
    for (let checkpoint = 0; checkpoint < checkpointCount; checkpoint++) {
      const entityBoundary = checkpoint * TAG_RANK_BLOCK_SIZE;
      while (
        taggedIndex < taggedEntityIndexes.length &&
        taggedEntityIndexes.at(taggedIndex) < entityBoundary
      ) {
        taggedIndex++;
      }
      this.tagRankCheckpoints[checkpoint] = taggedIndex;
    }

    this.tagOffsets.push(this.tagKeys.length);
    this.tagOffsets.compact();
    this.tagKeys.compact();
    this.tagVals.compact();

    // Convert the builder map to flat arrays for the reverse index
    for (const [keyIndex, entityIndexes] of this.keyEntityIndexBuilder) {
      this.keyIndexStart.set(keyIndex, this.keyEntities.length);
      this.keyIndexCount.set(keyIndex, entityIndexes.length);
      this.keyEntities.pushMany(entityIndexes);
    }

    this.keyEntities.compact();
    this.keyIndexStart.compact();
    this.keyIndexCount.compact();
    this.keyEntityIndexBuilder.clear();
    this.taggedEntityIndexBuilder = null;

    this.indexBuilt = true;
  }

  /**
   * Check if the index is built and ready for use.
   */
  isReady() {
    return this.indexBuilt;
  }

  /**
   * Get the number of tags for an entity.
   */
  cardinality(index: number): number {
    const taggedIndex = this.getTaggedEntityIndex(index);
    if (taggedIndex === -1) return 0;
    return this.tagOffsets.at(taggedIndex + 1) - this.tagOffsets.at(taggedIndex);
  }

  /** Number of entities that have at least one tag. */
  get taggedEntityCount(): number {
    return this.indexBuilt
      ? Math.max(0, this.tagOffsets.length - 1)
      : (this.taggedEntityIndexBuilder?.length ?? 0);
  }

  /** Iterate tagged entity indexes without allocating an intermediate array. */
  *taggedEntityIndexes(): Generator<number> {
    if (!this.indexBuilt) throw Error("Tag index not built.");
    for (let wordIndex = 0; wordIndex < this.taggedEntityBits.length; wordIndex++) {
      let word = this.taggedEntityBits[wordIndex] ?? 0;
      while (word !== 0) {
        const lowestBit = word & -word;
        const bit = 31 - Math.clz32(lowestBit);
        const entityIndex = wordIndex * TAG_BITS_PER_WORD + bit;
        if (entityIndex < this.entityCount) yield entityIndex;
        word = (word & (word - 1)) >>> 0;
      }
    }
  }

  /**
   * Get the tags for an entity.
   */
  getTags(index: number): OsmTags | undefined {
    const taggedIndex = this.getTaggedEntityIndex(index);
    if (taggedIndex === -1) return;
    const tagStart = this.tagOffsets.at(taggedIndex);
    const tagCount = this.tagOffsets.at(taggedIndex + 1) - tagStart;
    const tagKeyIndexes = this.tagKeys.array.slice(tagStart, tagStart + tagCount);
    const tagValIndexes = this.tagVals.array.slice(tagStart, tagStart + tagCount);
    const tags: OsmTags = {};
    for (let i = 0; i < tagCount; i++) {
      const keyIndex = tagKeyIndexes[i];
      const valIndex = tagValIndexes[i];
      if (keyIndex === undefined || valIndex === undefined)
        throw Error("Tag key or value not found");
      tags[this.stringTable.get(keyIndex)] = this.stringTable.get(valIndex);
    }
    return tags;
  }

  /**
   * Get tags from key and value indexes.
   */
  getTagsFromIndices(keys: number[], values: number[]): OsmTags {
    const tags: OsmTags = {};
    for (let i = 0; i < keys.length; i++) {
      const keyIndex = keys[i];
      const valIndex = values[i];
      if (keyIndex === undefined || valIndex === undefined)
        throw Error("Tag key or value not found");
      tags[this.stringTable.get(keyIndex)] = this.stringTable.get(valIndex);
    }
    return tags;
  }

  /**
   * Find the index of a tag key.
   */
  find(key: string): number {
    return this.stringTable.find(key);
  }

  /**
   * Get all entity indexes that have a specific tag key.
   */
  hasKey(keyIndex: number): number[] {
    if (
      keyIndex < 0 ||
      keyIndex >= this.keyIndexStart.length ||
      keyIndex >= this.keyIndexCount.length
    )
      return [];
    const start = this.keyIndexStart.at(keyIndex) ?? 0;
    const count = this.keyIndexCount.at(keyIndex) ?? 0;
    return Array.from(this.keyEntities.array.subarray(start, start + count));
  }

  /**
   * Create a unique composite index for a key=value pair.
   * Uses row-major indexing: `key * width + val`.
   */
  kvToIndex(key: number, val: number) {
    const width = this.stringTable.length;
    return key * width + val;
  }

  /**
   * Get transferable objects for passing to another thread.
   */
  transferables(): TagsTransferables {
    return {
      tagEntityCount: this.entityCount,
      taggedEntityBits: this.taggedEntityBits.buffer,
      tagRankCheckpoints: this.tagRankCheckpoints.buffer,
      tagOffsets: this.tagOffsets.array.buffer,
      tagKeys: this.tagKeys.array.buffer,
      tagVals: this.tagVals.array.buffer,
      keyEntities: this.keyEntities.array.buffer,
      keyIndexStart: this.keyIndexStart.array.buffer,
      keyIndexCount: this.keyIndexCount.array.buffer,
    };
  }

  /**
   * Get the approximate memory requirements for a given number of tags in bytes.
   */
  static getBytesRequired(entityCount: number, taggedEntityCount = entityCount) {
    return (
      Math.ceil(entityCount / TAG_BITS_PER_WORD) * Uint32Array.BYTES_PER_ELEMENT +
      (Math.ceil(entityCount / TAG_RANK_BLOCK_SIZE) + 1) * Uint32Array.BYTES_PER_ELEMENT +
      (taggedEntityCount + 1) * Uint32Array.BYTES_PER_ELEMENT
    );
  }

  /**
   * Reconstruct a Tags index from transferable objects.
   */
  static fromTransferables(stringTable: StringTable, transferables: TagsTransferables) {
    const tagIndex = new Tags(stringTable, transferables);
    tagIndex.indexBuilt = true;
    return tagIndex;
  }

  /**
   * Update a ContentHasher with the tags data.
   * Hashes tag keys and values for each entity.
   */
  updateHash(hasher: ContentHasher): ContentHasher {
    return hasher
      .updateNumber(this.entityCount)
      .update(this.taggedEntityBits)
      .update(this.tagOffsets.array)
      .update(this.tagKeys.array)
      .update(this.tagVals.array);
  }

  /** Return the compact tagged-entity ordinal, or -1 when the entity has no tags. */
  private getTaggedEntityIndex(index: number): number {
    if (index < 0 || index >= this.entityCount) return -1;
    const wordIndex = index >>> 5;
    const word = this.taggedEntityBits[wordIndex] ?? 0;
    const bit = index & 31;
    if ((word & (1 << bit)) === 0) return -1;

    const checkpoint = index >>> 8;
    let rank = this.tagRankCheckpoints[checkpoint] ?? 0;
    const checkpointWord = checkpoint * (TAG_RANK_BLOCK_SIZE / TAG_BITS_PER_WORD);
    for (let i = checkpointWord; i < wordIndex; i++) {
      rank += popcount(this.taggedEntityBits[i] ?? 0);
    }
    const lowerBitMask = bit === 0 ? 0 : 0xffffffff >>> (TAG_BITS_PER_WORD - bit);
    return rank + popcount(word & lowerBitMask);
  }
}

/** Count set bits in an unsigned 32-bit integer. */
function popcount(value: number): number {
  const pairs = value - ((value >>> 1) & 0x55555555);
  const nibbles = (pairs & 0x33333333) + ((pairs >>> 2) & 0x33333333);
  return (((nibbles + (nibbles >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

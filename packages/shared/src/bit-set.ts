/**
 * Fixed-size set of non-negative integers backed by one bit per slot.
 *
 * Intended for per-entity flags keyed by dense entity index, where a JS `Set` would exceed its
 * maximum size (~2^24 entries) on planet-scale data.
 *
 * The bits can live in a caller's buffer, such as a `SharedArrayBuffer` that other workers read,
 * and `buffer` returns it for transfer. `count` is tracked per instance: bits that another thread
 * sets in a shared buffer are not counted.
 */
export class BitSet {
  /** Number of addressable slots, `0..size - 1`. */
  readonly size: number;
  private readonly bits: Uint8Array;
  /** Number of set bits, or null until counted (a wrapped buffer starts uncounted). */
  private setCount: number | null;

  /** Bytes needed to hold `size` bits. */
  static byteLength(size: number): number {
    return Math.ceil(size / 8);
  }

  /**
   * Create an empty set of `size` slots, or wrap `buffer`, which must hold at least
   * `BitSet.byteLength(size)` bytes. A wrapped buffer keeps its bits and is not copied.
   */
  constructor(size: number, buffer?: ArrayBufferLike) {
    if (!Number.isInteger(size) || size < 0) throw Error(`Invalid BitSet size ${size}`);
    this.size = size;
    const byteLength = BitSet.byteLength(size);
    if (buffer === undefined) {
      this.bits = new Uint8Array(byteLength);
      this.setCount = 0;
      return;
    }
    if (buffer.byteLength < byteLength) {
      throw Error(`BitSet buffer has ${buffer.byteLength} bytes; ${size} slots need ${byteLength}`);
    }
    this.bits = new Uint8Array(buffer, 0, byteLength);
    this.setCount = null;
  }

  /** The buffer that holds the bits, for transfer to another thread. */
  get buffer(): ArrayBufferLike {
    return this.bits.buffer;
  }

  /** Create a copy with the same size and set bits, in a new unshared buffer. */
  clone(): BitSet {
    const copy = new BitSet(this.size);
    copy.bits.set(this.bits);
    copy.setCount = this.setCount;
    return copy;
  }

  /** Number of set bits. A wrapped buffer is counted on first access. */
  get count(): number {
    if (this.setCount === null) {
      let count = 0;
      for (const byte of this.bits) {
        let rest = byte;
        while (rest !== 0) {
          rest &= rest - 1;
          count++;
        }
      }
      this.setCount = count;
    }
    return this.setCount;
  }

  has(index: number): boolean {
    this.assertIndex(index);
    return this.hasUnchecked(index);
  }

  add(index: number): void {
    this.assertIndex(index);
    this.addUnchecked(index);
  }

  delete(index: number): void {
    if (!this.has(index)) return;
    this.bits[index >>> 3]! &= ~(1 << (index & 7));
    if (this.setCount !== null) this.setCount--;
  }

  /**
   * `has` without the range check, for hot loops whose indexes are known to be in range. An
   * out-of-range index reads past the set: false, or a bit of the final byte's padding.
   */
  hasUnchecked(index: number): boolean {
    return (this.bits[index >>> 3]! & (1 << (index & 7))) !== 0;
  }

  /** `add` without the range check. An out-of-range index is a caller bug and is not caught. */
  addUnchecked(index: number): void {
    const byteIndex = index >>> 3;
    const mask = 1 << (index & 7);
    const byte = this.bits[byteIndex]!;
    if ((byte & mask) !== 0) return;
    this.bits[byteIndex] = byte | mask;
    if (this.setCount !== null) this.setCount++;
  }

  /** Call `callback` for each set index in ascending order, skipping empty bytes. */
  forEach(callback: (index: number) => void): void {
    const bits = this.bits;
    for (let byteIndex = 0; byteIndex < bits.length; byteIndex++) {
      const byte = bits[byteIndex]!;
      if (byte === 0) continue;
      for (let bit = 0; bit < 8; bit++) {
        if ((byte & (1 << bit)) !== 0) callback(byteIndex * 8 + bit);
      }
    }
  }

  private assertIndex(index: number) {
    if (!Number.isInteger(index) || index < 0 || index >= this.size) {
      throw Error(`BitSet index ${index} out of range [0, ${this.size})`);
    }
  }
}

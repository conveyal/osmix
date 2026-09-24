/**
 * Fixed-size set of non-negative integers backed by one bit per slot.
 *
 * Intended for per-entity flags keyed by dense entity index, where a JS `Set` would exceed its
 * maximum size (~2^24 entries) on planet-scale data.
 */
export class BitSet {
  /** Number of addressable slots, `0..size - 1`. */
  readonly size: number;
  private readonly bits: Uint8Array;
  private setCount = 0;

  constructor(size: number) {
    if (!Number.isInteger(size) || size < 0) throw Error(`Invalid BitSet size ${size}`);
    this.size = size;
    this.bits = new Uint8Array(Math.ceil(size / 8));
  }

  /** Create a copy with the same size and set bits. */
  clone(): BitSet {
    const copy = new BitSet(this.size);
    copy.bits.set(this.bits);
    copy.setCount = this.setCount;
    return copy;
  }

  /** Number of set bits. */
  get count(): number {
    return this.setCount;
  }

  has(index: number): boolean {
    this.assertIndex(index);
    return (this.bits[index >>> 3]! & (1 << (index & 7))) !== 0;
  }

  add(index: number): void {
    if (this.has(index)) return;
    this.bits[index >>> 3]! |= 1 << (index & 7);
    this.setCount++;
  }

  delete(index: number): void {
    if (!this.has(index)) return;
    this.bits[index >>> 3]! &= ~(1 << (index & 7));
    this.setCount--;
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

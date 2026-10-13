/**
 * Low-level protocol buffers reader and writer.
 *
 * A typed port of the parts of `pbf` 5.1.2 (BSD-3-Clause, Mapbox) that Osmix
 * uses to read and write OSM PBF and vector tile messages; see
 * `THIRD_PARTY_NOTICES.md`. Method names and behavior match `pbf`.
 *
 * @module
 */

// Threshold chosen based on both benchmarking and knowledge about browser string
// data structures (which currently switch structure types at 12 bytes or more)
const TEXT_DECODER_MIN_LENGTH = 12;
const utf8TextDecoder = new TextDecoder("utf-8");

const PBF_VARINT = 0; // varint: int32, int64, uint32, uint64, sint32, sint64, bool, enum
const PBF_FIXED64 = 1; // 64-bit: double, fixed64, sfixed64
const PBF_BYTES = 2; // length-delimited: string, bytes, embedded messages, packed repeated fields
const PBF_FIXED32 = 5; // 32-bit: float, fixed32, sfixed32

/** Reads protocol buffer fields from a byte buffer. */
export class PbfReader {
  buf: Uint8Array;
  pos = 0;
  /** Wire type of the current field. */
  type = 0;
  length: number;
  private valueStart = -1;

  constructor(buf: Uint8Array | ArrayBuffer) {
    this.buf = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    this.length = this.buf.length;
  }

  /** Read fields until `end`, calling `readField` with each field number. */
  readFields<T>(
    readField: (tag: number, result: T, pbf: PbfReader) => void,
    result: T,
    end = this.length,
  ): T {
    let field: number;
    while ((field = this.nextField(end))) {
      readField(field, result, this);
    }
    return result;
  }

  readVarint(isSigned?: boolean): number {
    const buf = this.buf;
    const b0 = buf[this.pos++]!;
    if (b0 < 0x80) return b0;

    let val = b0 & 0x7f;
    let b = buf[this.pos++]!;
    val |= (b & 0x7f) << 7;
    if (b < 0x80) return val;
    b = buf[this.pos++]!;
    val |= (b & 0x7f) << 14;
    if (b < 0x80) return val;
    b = buf[this.pos++]!;
    val |= (b & 0x7f) << 21;
    if (b < 0x80) return val;
    b = buf[this.pos]!;
    val |= (b & 0x0f) << 28;

    return readVarintRemainder(val, isSigned, this);
  }

  readSVarint(): number {
    const num = this.readVarint();
    return num % 2 === 1 ? (num + 1) / -2 : num / 2; // zigzag encoding
  }

  readBoolean(): boolean {
    return Boolean(this.readVarint());
  }

  readString(): string {
    const end = this.readVarint() + this.pos;
    const pos = this.pos;
    this.pos = end;

    if (end - pos >= TEXT_DECODER_MIN_LENGTH) {
      // longer strings are fast with the built-in TextDecoder API
      return utf8TextDecoder.decode(this.buf.subarray(pos, end));
    }
    // short strings are fast with our custom implementation
    return readUtf8(this.buf, pos, end);
  }

  readBytes(): Uint8Array {
    const end = this.readVarint() + this.pos;
    const buffer = this.buf.subarray(this.pos, end);
    this.pos = end;
    return buffer;
  }

  readPackedVarint(arr: number[] = [], isSigned?: boolean): number[] {
    const end = this.readPackedEnd();
    while (this.pos < end) arr.push(this.readVarint(isSigned));
    return arr;
  }

  readPackedSVarint(arr: number[] = []): number[] {
    const end = this.readPackedEnd();
    while (this.pos < end) arr.push(this.readSVarint());
    return arr;
  }

  readPackedBoolean(arr: boolean[] = []): boolean[] {
    const end = this.readPackedEnd();
    while (this.pos < end) arr.push(this.readBoolean());
    return arr;
  }

  private readPackedEnd(): number {
    return this.type === PBF_BYTES ? this.readVarint() + this.pos : this.pos + 1;
  }

  /**
   * Advance to the next field, skipping the current field's value if it was
   * not read. Returns the field number, or 0 at the end of the message.
   */
  nextField(end = this.length): number {
    if (this.pos === this.valueStart) this.skip(this.type);
    if (this.pos >= end) return 0;
    const tag = this.readVarint();
    this.type = tag & 0x7;
    this.valueStart = this.pos;
    return tag >>> 3;
  }

  /** Skip a value of the given wire type. */
  skip(val: number): void {
    const type = val & 0x7;
    if (type === PBF_VARINT) while (this.buf[this.pos++]! > 0x7f) {}
    else if (type === PBF_BYTES) this.pos = this.readVarint() + this.pos;
    else if (type === PBF_FIXED32) this.pos += 4;
    else if (type === PBF_FIXED64) this.pos += 8;
    else throw new Error(`Unimplemented type: ${type}`);
  }
}

/** Writes protocol buffer fields to a growing byte buffer. */
export class PbfWriter {
  buf: Uint8Array;
  pos = 0;
  length: number;
  private dataView: DataView;

  constructor(buf: Uint8Array | ArrayBuffer = new Uint8Array(16)) {
    this.buf = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    this.dataView = new DataView(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength);
    this.length = this.buf.length;
  }

  writeTag(tag: number, type: number): void {
    this.writeVarint((tag << 3) | type);
  }

  /** Grow the buffer so `min` more bytes fit after `pos`. */
  realloc(min: number): void {
    let length = this.length || 16;

    while (length < this.pos + min) length *= 2;

    if (length !== this.length) {
      const buf = new Uint8Array(length);
      buf.set(this.buf);
      this.buf = buf;
      this.dataView = new DataView(buf.buffer);
      this.length = length;
    }
  }

  /** Return the written bytes, a view of the internal buffer. */
  finish(): Uint8Array {
    this.length = this.pos;
    this.pos = 0;
    return this.buf.subarray(0, this.length);
  }

  writeVarint(val: number): void {
    let v = +val || 0;

    if (v >= 0 && v < 0x80) {
      if (this.pos >= this.length) this.realloc(1);
      this.buf[this.pos++] = v;
      return;
    }

    if (v > 0xfffffff || v < 0) {
      writeBigVarint(v, this);
      return;
    }

    this.realloc(4);

    this.buf[this.pos++] = (v & 0x7f) | (v > 0x7f ? 0x80 : 0);
    if (v <= 0x7f) return;
    this.buf[this.pos++] = ((v >>>= 7) & 0x7f) | (v > 0x7f ? 0x80 : 0);
    if (v <= 0x7f) return;
    this.buf[this.pos++] = ((v >>>= 7) & 0x7f) | (v > 0x7f ? 0x80 : 0);
    if (v <= 0x7f) return;
    this.buf[this.pos++] = (v >>> 7) & 0x7f;
  }

  writeSVarint(val: number): void {
    this.writeVarint(val < 0 ? -val * 2 - 1 : val * 2);
  }

  writeBoolean(val: boolean): void {
    this.writeVarint(+val);
  }

  writeString(str: string): void {
    const s = String(str);
    this.realloc(s.length * 4);

    this.pos++; // reserve 1 byte for short string length

    const startPos = this.pos;
    // write the string directly to the buffer and see how much was written
    this.pos = writeUtf8(this.buf, s, this.pos);
    const len = this.pos - startPos;

    if (len >= 0x80) makeRoomForExtraLength(startPos, len, this);

    // finally, write the message length in the reserved place and restore the position
    this.pos = startPos - 1;
    this.writeVarint(len);
    this.pos += len;
  }

  writeDouble(val: number): void {
    this.realloc(8);
    this.dataView.setFloat64(this.pos, val, true);
    this.pos += 8;
  }

  writeBytes(buffer: Uint8Array): void {
    const len = buffer.length;
    this.writeVarint(len);
    this.realloc(len);
    this.buf.set(buffer, this.pos);
    this.pos += len;
  }

  /** Write a length-prefixed message whose body `fn` writes. */
  writeRawMessage<T>(fn: (obj: T, pbf: PbfWriter) => void, obj: T): void {
    this.pos++; // reserve 1 byte for short message length

    // write the message directly to the buffer and see how much was written
    const startPos = this.pos;
    fn(obj, this);
    const len = this.pos - startPos;

    if (len >= 0x80) makeRoomForExtraLength(startPos, len, this);

    // finally, write the message length in the reserved place and restore the position
    this.pos = startPos - 1;
    this.writeVarint(len);
    this.pos += len;
  }

  writeMessage<T>(tag: number, fn: (obj: T, pbf: PbfWriter) => void, obj: T): void {
    this.writeTag(tag, PBF_BYTES);
    this.writeRawMessage(fn, obj);
  }

  writePackedVarint(tag: number, arr: number[]): void {
    if (arr.length) this.writeMessage(tag, writePackedVarint, arr);
  }

  writePackedSVarint(tag: number, arr: number[]): void {
    if (arr.length) this.writeMessage(tag, writePackedSVarint, arr);
  }

  writePackedBoolean(tag: number, arr: boolean[]): void {
    if (arr.length) this.writeMessage(tag, writePackedBoolean, arr);
  }

  writeBytesField(tag: number, buffer: Uint8Array): void {
    this.writeTag(tag, PBF_BYTES);
    this.writeBytes(buffer);
  }

  writeVarintField(tag: number, val: number): void {
    this.writeTag(tag, PBF_VARINT);
    this.writeVarint(val);
  }

  writeSVarintField(tag: number, val: number): void {
    this.writeTag(tag, PBF_VARINT);
    this.writeSVarint(val);
  }

  writeStringField(tag: number, str: string): void {
    this.writeTag(tag, PBF_BYTES);
    this.writeString(str);
  }

  writeDoubleField(tag: number, val: number): void {
    this.writeTag(tag, PBF_FIXED64);
    this.writeDouble(val);
  }

  writeBooleanField(tag: number, val: boolean): void {
    this.writeVarintField(tag, +val);
  }
}

function readVarintRemainder(l: number, s: boolean | undefined, p: PbfReader): number {
  const buf = p.buf;
  let b = buf[p.pos++]!;
  let h = (b & 0x70) >> 4;
  if (b < 0x80) return toNum(l, h, s);
  b = buf[p.pos++]!;
  h |= (b & 0x7f) << 3;
  if (b < 0x80) return toNum(l, h, s);
  b = buf[p.pos++]!;
  h |= (b & 0x7f) << 10;
  if (b < 0x80) return toNum(l, h, s);
  b = buf[p.pos++]!;
  h |= (b & 0x7f) << 17;
  if (b < 0x80) return toNum(l, h, s);
  b = buf[p.pos++]!;
  h |= (b & 0x7f) << 24;
  if (b < 0x80) return toNum(l, h, s);
  b = buf[p.pos++]!;
  h |= (b & 0x01) << 31;
  if (b < 0x80) return toNum(l, h, s);

  throw new Error("Expected varint not more than 10 bytes");
}

function toNum(low: number, high: number, isSigned?: boolean): number {
  return isSigned ? high * 0x100000000 + (low >>> 0) : (high >>> 0) * 0x100000000 + (low >>> 0);
}

function writeBigVarint(val: number, pbf: PbfWriter): void {
  let low: number;
  let high: number;

  if (val >= 0) {
    low = (val % 0x100000000) | 0;
    high = (val / 0x100000000) | 0;
  } else {
    low = ~(-val % 0x100000000);
    high = ~(-val / 0x100000000);

    if (low ^ 0xffffffff) {
      low = (low + 1) | 0;
    } else {
      low = 0;
      high = (high + 1) | 0;
    }
  }

  if (val >= 2 ** 64 || val < -(2 ** 64)) {
    throw new Error("Given varint doesn't fit into 10 bytes");
  }

  pbf.realloc(10);

  writeBigVarintLow(low, pbf);
  writeBigVarintHigh(high, pbf);
}

function writeBigVarintLow(low: number, pbf: PbfWriter): void {
  let l = low;
  pbf.buf[pbf.pos++] = (l & 0x7f) | 0x80;
  l >>>= 7;
  pbf.buf[pbf.pos++] = (l & 0x7f) | 0x80;
  l >>>= 7;
  pbf.buf[pbf.pos++] = (l & 0x7f) | 0x80;
  l >>>= 7;
  pbf.buf[pbf.pos++] = (l & 0x7f) | 0x80;
  l >>>= 7;
  pbf.buf[pbf.pos] = l & 0x7f;
}

function writeBigVarintHigh(high: number, pbf: PbfWriter): void {
  const lsb = (high & 0x07) << 4;
  let h = high >>> 3;
  pbf.buf[pbf.pos++]! |= lsb | (h ? 0x80 : 0);
  // Each remaining byte holds the next 7 bits, with the high bit set while more follow.
  while (h) {
    const bits = h & 0x7f;
    h >>>= 7;
    pbf.buf[pbf.pos++] = bits | (h ? 0x80 : 0);
  }
}

function makeRoomForExtraLength(startPos: number, len: number, pbf: PbfWriter): void {
  const extraLen =
    len <= 0x3fff
      ? 1
      : len <= 0x1fffff
        ? 2
        : len <= 0xfffffff
          ? 3
          : Math.floor(Math.log(len) / (Math.LN2 * 7));

  // if 1 byte isn't enough for encoding message length, shift the data to the right
  pbf.realloc(extraLen);
  pbf.buf.copyWithin(startPos + extraLen, startPos, pbf.pos);
}

/**
 * Packed varints often dominate encode time, so write the bytes inline
 * through a local buffer pointer rather than calling writeVarint per element.
 * Anything but a non-negative safe integer (negatives, NaN, Infinity, values
 * of 2^53 and up) falls back to writeVarint, which handles or rejects it, as
 * does any value near the buffer's end. Unlike pbf, which loops forever on
 * Infinity and overruns its buffer at 2^64 and up.
 */
function writePackedVarint(arr: number[], pbf: PbfWriter): void {
  const n = arr.length;
  let buf = pbf.buf;
  let pos = pbf.pos;
  let limit = pbf.length;
  for (let i = 0; i < n; i++) {
    let val = arr[i]!;
    if (!(val >= 0 && val <= Number.MAX_SAFE_INTEGER) || pos + 10 > limit) {
      // slow path: grows the buffer, handles 10-byte values and rejects ones that do not fit
      pbf.pos = pos;
      pbf.writeVarint(val);
      buf = pbf.buf;
      pos = pbf.pos;
      limit = pbf.length;
      continue;
    }
    while (val > 0x7f) {
      buf[pos++] = (val % 0x80) | 0x80;
      val = Math.floor(val / 0x80);
    }
    buf[pos++] = val;
  }
  pbf.pos = pos;
}

function writePackedSVarint(arr: number[], pbf: PbfWriter): void {
  for (let i = 0; i < arr.length; i++) pbf.writeSVarint(arr[i]!);
}

function writePackedBoolean(arr: boolean[], pbf: PbfWriter): void {
  for (let i = 0; i < arr.length; i++) pbf.writeBoolean(arr[i]!);
}

// Buffer code below from https://github.com/feross/buffer, MIT-licensed

function readUtf8(buf: Uint8Array, pos: number, end: number): string {
  let str = "";
  let i = pos;

  while (i < end) {
    const b0 = buf[i]!;
    let c: number | null = null; // codepoint
    let bytesPerSequence = b0 > 0xef ? 4 : b0 > 0xdf ? 3 : b0 > 0xbf ? 2 : 1;

    if (i + bytesPerSequence > end) break;

    if (bytesPerSequence === 1) {
      if (b0 < 0x80) {
        c = b0;
      }
    } else if (bytesPerSequence === 2) {
      const b1 = buf[i + 1]!;
      if ((b1 & 0xc0) === 0x80) {
        c = ((b0 & 0x1f) << 0x6) | (b1 & 0x3f);
        if (c <= 0x7f) {
          c = null;
        }
      }
    } else if (bytesPerSequence === 3) {
      const b1 = buf[i + 1]!;
      const b2 = buf[i + 2]!;
      if ((b1 & 0xc0) === 0x80 && (b2 & 0xc0) === 0x80) {
        c = ((b0 & 0xf) << 0xc) | ((b1 & 0x3f) << 0x6) | (b2 & 0x3f);
        if (c <= 0x7ff || (c >= 0xd800 && c <= 0xdfff)) {
          c = null;
        }
      }
    } else if (bytesPerSequence === 4) {
      const b1 = buf[i + 1]!;
      const b2 = buf[i + 2]!;
      const b3 = buf[i + 3]!;
      if ((b1 & 0xc0) === 0x80 && (b2 & 0xc0) === 0x80 && (b3 & 0xc0) === 0x80) {
        c = ((b0 & 0xf) << 0x12) | ((b1 & 0x3f) << 0xc) | ((b2 & 0x3f) << 0x6) | (b3 & 0x3f);
        if (c <= 0xffff || c >= 0x110000) {
          c = null;
        }
      }
    }

    if (c === null) {
      c = 0xfffd;
      bytesPerSequence = 1;
    } else if (c > 0xffff) {
      c -= 0x10000;
      str += String.fromCharCode(((c >>> 10) & 0x3ff) | 0xd800);
      c = 0xdc00 | (c & 0x3ff);
    }

    str += String.fromCharCode(c);
    i += bytesPerSequence;
  }

  return str;
}

function writeUtf8(buf: Uint8Array, str: string, start: number): number {
  let pos = start;
  let lead: number | null = null;
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i); // code point

    if (c > 0xd7ff && c < 0xe000) {
      if (lead) {
        if (c < 0xdc00) {
          buf[pos++] = 0xef;
          buf[pos++] = 0xbf;
          buf[pos++] = 0xbd;
          lead = c;
          continue;
        } else {
          c = ((lead - 0xd800) << 10) | (c - 0xdc00) | 0x10000;
          lead = null;
        }
      } else {
        if (c > 0xdbff || i + 1 === str.length) {
          buf[pos++] = 0xef;
          buf[pos++] = 0xbf;
          buf[pos++] = 0xbd;
        } else {
          lead = c;
        }
        continue;
      }
    } else if (lead) {
      buf[pos++] = 0xef;
      buf[pos++] = 0xbf;
      buf[pos++] = 0xbd;
      lead = null;
    }

    if (c < 0x80) {
      buf[pos++] = c;
    } else {
      if (c < 0x800) {
        buf[pos++] = (c >> 0x6) | 0xc0;
      } else {
        if (c < 0x10000) {
          buf[pos++] = (c >> 0xc) | 0xe0;
        } else {
          buf[pos++] = (c >> 0x12) | 0xf0;
          buf[pos++] = ((c >> 0xc) & 0x3f) | 0x80;
        }
        buf[pos++] = ((c >> 0x6) & 0x3f) | 0x80;
      }
      buf[pos++] = (c & 0x3f) | 0x80;
    }
  }
  return pos;
}

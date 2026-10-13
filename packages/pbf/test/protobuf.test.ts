import * as upstream from "pbf";
import { describe, expect, test } from "vitest";

import { PbfReader, PbfWriter } from "../src/protobuf";

const varints = [
  0,
  1,
  127,
  128,
  300,
  0xfffffff,
  0x10000000,
  2 ** 32,
  2 ** 53 - 1,
  -1,
  -300,
  -(2 ** 40),
];
const strings = [
  "",
  "a",
  "short",
  "a string of more than twelve bytes",
  "ü€𝄞",
  "\ud800x",
  "x\udc00",
  "é".repeat(200),
];

type Writer = PbfWriter | upstream.PbfWriter;

function writeMessage(pbf: Writer) {
  for (const v of varints) pbf.writeVarintField(1, v);
  for (const v of varints) pbf.writeSVarintField(2, v);
  for (const s of strings) pbf.writeStringField(3, s);
  pbf.writeDoubleField(4, Math.PI);
  pbf.writeBooleanField(5, true);
  pbf.writeBooleanField(5, false);
  pbf.writeBytesField(
    6,
    Uint8Array.from({ length: 300 }, (_, i) => i % 256),
  );
  pbf.writePackedVarint(
    7,
    varints.filter((v) => v >= 0),
  );
  pbf.writePackedSVarint(8, varints);
  pbf.writePackedBoolean(9, [true, false, true]);
  pbf.writeMessage(
    10,
    (n: number, inner: Writer) => {
      for (let i = 0; i < n; i++) inner.writeVarintField(1, i);
    },
    200,
  );
}

describe("PbfWriter", () => {
  test("writes the same bytes as pbf", () => {
    const ours = new PbfWriter();
    const theirs = new upstream.PbfWriter();
    writeMessage(ours);
    writeMessage(theirs);
    expect(ours.finish()).toEqual(theirs.finish());
  });
});

describe("PbfReader", () => {
  test("reads every field the writer wrote", () => {
    const writer = new PbfWriter();
    writeMessage(writer);
    const result = {
      varints: [] as number[],
      svarints: [] as number[],
      strings: [] as string[],
      booleans: [] as boolean[],
      packed: [] as number[],
      packedSigned: [] as number[],
      packedBooleans: [] as boolean[],
      bytesLength: 0,
      nested: 0,
    };
    new PbfReader(writer.finish()).readFields((tag, r, pbf) => {
      if (tag === 1) r.varints.push(pbf.readVarint(true));
      else if (tag === 2) r.svarints.push(pbf.readSVarint());
      else if (tag === 3) r.strings.push(pbf.readString());
      else if (tag === 5) r.booleans.push(pbf.readBoolean());
      else if (tag === 6) r.bytesLength = pbf.readBytes().length;
      else if (tag === 7) pbf.readPackedVarint(r.packed);
      else if (tag === 8) pbf.readPackedSVarint(r.packedSigned);
      else if (tag === 9) pbf.readPackedBoolean(r.packedBooleans);
      else if (tag === 10) {
        const nested = pbf.readFields(
          (t, n: { count: number }) => {
            if (t === 1) n.count++;
          },
          { count: 0 },
          pbf.readVarint() + pbf.pos,
        );
        r.nested = nested.count;
      }
      // Tag 4 (double) is left unread so nextField has to skip it.
    }, result);

    expect(result.varints).toEqual(varints);
    expect(result.svarints).toEqual(varints);
    expect(result.strings).toEqual(
      strings.map((s) => new TextDecoder().decode(new TextEncoder().encode(s))),
    );
    expect(result.booleans).toEqual([true, false]);
    expect(result.bytesLength).toBe(300);
    expect(result.packed).toEqual(varints.filter((v) => v >= 0));
    expect(result.packedSigned).toEqual(varints);
    expect(result.packedBooleans).toEqual([true, false, true]);
    expect(result.nested).toBe(200);
  });

  test("throws on a varint longer than 10 bytes", () => {
    const bytes = new Uint8Array(11).fill(0xff);
    expect(() => new PbfReader(bytes).readVarint()).toThrow(
      "Expected varint not more than 10 bytes",
    );
  });
});

import { createMockBaseOsm } from "@osmix/core/mocks";
import { describe, expect, it } from "vitest";

import { OsmChangeset } from "../src/changeset";
import { generateOscChanges } from "../src/osc";
import { escapeXmlAttribute, osmTagsToOscTags } from "../src/utils";

describe("OSC XML attribute escaping", () => {
  it.each([
    ["ampersand", "&", "&amp;"],
    ["less-than", "<", "&lt;"],
    ["greater-than", ">", "&gt;"],
    ["double-quote", '"', "&quot;"],
    ["apostrophe", "'", "&apos;"],
    ["combined and Unicode", `&<>'" café ☃`, "&amp;&lt;&gt;&apos;&quot; café ☃"],
    ["literal entity text", "&amp;", "&amp;amp;"],
  ])("escapes %s", (_name, input, expected) => {
    expect(escapeXmlAttribute(input)).toBe(expected);
  });

  it("keeps plain tag output stable", () => {
    expect(osmTagsToOscTags({ highway: "primary" })).toBe('<tag k="highway" v="primary" />');
  });

  it("escapes hostile tag keys, values, and relation roles in every document section", () => {
    const base = createMockBaseOsm();
    const changeset = new OsmChangeset(base);
    const key = `key&<>'"☃`;
    const value = `value&<>'" café`;
    const role = `role&<>'"東京`;
    const escapedKey = escapeXmlAttribute(key);
    const escapedValue = escapeXmlAttribute(value);
    const escapedRole = escapeXmlAttribute(role);

    changeset.create({ id: 10, lat: 0, lon: 0, tags: { [key]: value } }, "patch");
    changeset.create({ id: 11, refs: [0, 1], tags: { [key]: value } }, "patch");
    changeset.create(
      {
        id: 12,
        members: [{ type: "way", ref: 11, role }],
        tags: { [key]: value },
      },
      "patch",
    );
    changeset.modify("node", 0, (node) => ({ ...node, tags: { [key]: value } }));
    changeset.modify("way", 1, (way) => ({ ...way, tags: { [key]: value } }));
    changeset.delete({
      id: 13,
      members: [{ type: "way", ref: 11, role }],
      tags: { [key]: value },
    });

    const osc = generateOscChanges(changeset, { augmented: true });

    expect(osc).toContain(`<tag k="${escapedKey}" v="${escapedValue}" />`);
    expect(osc).toContain(`<member type="way" ref="11" role="${escapedRole}" />`);
    expect(osc).toContain("<create>");
    expect(osc).toContain("<modify>");
    expect(osc).toContain("<delete>");
    expect(osc).not.toContain(`<tag k="${key}" v="${value}" />`);
    expect(osc).not.toContain(`<member type="way" ref="11" role="${role}" />`);
  });
});

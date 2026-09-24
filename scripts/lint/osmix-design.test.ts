import { describe, it } from "node:test";

import { RuleTester } from "oxlint/plugins-dev";

import { rules } from "./osmix-design.ts";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: { sourceType: "module", parserOptions: { lang: "tsx" } },
});

tester.run("no-raw-color", rules["no-raw-color"], {
  valid: [
    'const paint = { "line-color": colors.base };',
    'const label = "Issue #12 is fixed";',
    '<div className="bg-card text-info" />',
    'const id = "#root";',
  ],
  invalid: [
    { code: 'const paint = { "line-color": "#0088FF" };', errors: [{ messageId: "raw" }] },
    { code: 'const paint = { "fill-color": "red" };', errors: [{ messageId: "raw" }] },
    { code: 'const c = "rgba(0, 0, 0, 0.2)";', errors: [{ messageId: "raw" }] },
    { code: 'const c = "oklch(0.6 0.2 40)";', errors: [{ messageId: "raw" }] },
    { code: 'const c = ["rgba", 255, 0, 0, 1];', errors: [{ messageId: "raw" }] },
    { code: "const c = `0 0 0 2px #000`;", errors: [{ messageId: "raw" }] },
  ],
});

tester.run("no-native-radio", rules["no-native-radio"], {
  valid: ['<input type="checkbox" />', '<Radio name="strategy" />', '<input type="text" />'],
  invalid: [{ code: '<input type="radio" name="x" />', errors: [{ messageId: "radio" }] }],
});

tester.run("no-ascii-ellipsis", rules["no-ascii-ellipsis"], {
  valid: [
    "<LoadingState>Loading…</LoadingState>",
    "<Foo {...props} />",
    'const log = "Loading...";',
  ],
  invalid: [
    { code: "<LoadingState>Please wait...</LoadingState>", errors: [{ messageId: "ellipsis" }] },
    { code: '<Input placeholder="Search..." />', errors: [{ messageId: "ellipsis" }] },
    { code: '<p>{"Searching..."}</p>', errors: [{ messageId: "ellipsis" }] },
  ],
});

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

tester.run("no-icon-size-button", rules["no-icon-size-button"], {
  valid: [
    '<Button size="sm">Save</Button>',
    '<IconButton label="Zoom in" icon={<PlusIcon />} />',
    "<Button>Open</Button>",
  ],
  invalid: [
    {
      code: '<Button size="icon-sm" aria-label="Close"><XIcon /></Button>',
      errors: [{ messageId: "iconButton" }],
    },
    { code: '<Button size={"icon"}><XIcon /></Button>', errors: [{ messageId: "iconButton" }] },
  ],
});

tester.run("no-breakpoint-variant", rules["no-breakpoint-variant"], {
  valid: [
    '<div className="flex gap-2 xl:gap-4" />',
    '<div className="max-w-sm w-md max-h-3/5" />',
    '<div className="small-window-only data-[side=right]:w-md" />',
    'const size = { sm: "h-7", lg: "h-12" };',
    'const url = "https://example.com";',
  ],
  invalid: [
    { code: '<div className="hidden sm:flex" />', errors: [{ messageId: "breakpoint" }] },
    { code: '<span className="hidden md:inline" />', errors: [{ messageId: "breakpoint" }] },
    { code: 'cn("flex-col", "lg:flex-row")', errors: [{ messageId: "breakpoint" }] },
    { code: '<div className="max-md:hidden" />', errors: [{ messageId: "breakpoint" }] },
    {
      code: '<div className="data-[side=left]:sm:max-w-sm" />',
      errors: [{ messageId: "breakpoint" }],
    },
    { code: '<div className="min-[900px]:flex" />', errors: [{ messageId: "breakpoint" }] },
    { code: "const c = `gap-2 md:gap-4`;", errors: [{ messageId: "breakpoint" }] },
  ],
});

/**
 * Osmix design-system lint rules that oxlint's built-in rules and `oxlint-tailwindcss` cannot
 * express. Loaded through `jsPlugins` in `.oxlintrc.json`; see packages/ui/DESIGN.md for the
 * rules each one enforces.
 */

type Node = { type: string; [key: string]: unknown };
type Context = { report: (descriptor: { node: Node; messageId: string }) => void };
type Rule = {
  meta: {
    type: "problem" | "suggestion";
    docs: { description: string };
    messages: Record<string, string>;
  };
  create: (context: Context) => Record<string, (node: Node) => void>;
};

const HEX_COLOR = /(?:^|[\s(,:])#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\b/i;
const COLOR_FUNCTION = /^\s*(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(/i;
const NAMED_COLORS = new Set([
  "black",
  "blue",
  "gray",
  "green",
  "grey",
  "orange",
  "pink",
  "purple",
  "red",
  "white",
  "yellow",
]);
const MAPLIBRE_COLOR_EXPRESSIONS = new Set(["rgb", "rgba", "hsl", "hsla"]);

function isRawColor(value: string): boolean {
  return HEX_COLOR.test(value) || COLOR_FUNCTION.test(value) || NAMED_COLORS.has(value.trim());
}

/** No literal colors in code: map paint uses `useMapColors()`, DOM uses theme classes. */
const noRawColor: Rule = {
  meta: {
    type: "problem",
    docs: { description: "Disallow hex, rgb()/oklch() and named colors outside the theme." },
    messages: {
      raw: "Use a theme token: a color class in the DOM, or a `useMapColors()` role in map paint.",
    },
  },
  create(context) {
    return {
      Literal(node) {
        if (typeof node["value"] === "string" && isRawColor(node["value"])) {
          context.report({ node, messageId: "raw" });
        }
      },
      TemplateElement(node) {
        const value = node["value"] as { raw: string };
        if (HEX_COLOR.test(value.raw)) context.report({ node, messageId: "raw" });
      },
      ArrayExpression(node) {
        const [first] = node["elements"] as (Node | null)[];
        if (
          first?.type === "Literal" &&
          typeof first["value"] === "string" &&
          MAPLIBRE_COLOR_EXPRESSIONS.has(first["value"])
        ) {
          context.report({ node, messageId: "raw" });
        }
      },
    };
  },
};

/** Radios come from `@osmix/ui` (`Radio`, `RadioLabel`, `RadioCard`), which carry the theme. */
const noNativeRadio: Rule = {
  meta: {
    type: "problem",
    docs: { description: "Disallow native radio inputs in app code." },
    messages: { radio: 'Use `Radio` from @osmix/ui instead of <input type="radio">.' },
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        const name = node["name"] as Node;
        if (name.type !== "JSXIdentifier" || name["name"] !== "input") return;
        for (const attribute of node["attributes"] as Node[]) {
          if (attribute.type !== "JSXAttribute") continue;
          const attributeName = attribute["name"] as Node;
          const value = attribute["value"] as Node | null;
          if (attributeName["name"] === "type" && value?.["value"] === "radio") {
            context.report({ node, messageId: "radio" });
          }
        }
      },
    };
  },
};

/** Icon-only buttons are `IconButton`s, which require a label and show it as a tooltip. */
const noIconSizeButton: Rule = {
  meta: {
    type: "problem",
    docs: { description: "Disallow icon-sized Button at call sites." },
    messages: {
      iconButton: "Use IconButton from @osmix/ui, which requires a label and shows a tooltip.",
    },
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        const name = node["name"] as Node;
        if (name.type !== "JSXIdentifier" || name["name"] !== "Button") return;
        for (const attribute of node["attributes"] as Node[]) {
          if (attribute.type !== "JSXAttribute") continue;
          if ((attribute["name"] as Node)["name"] !== "size") continue;
          let value = attribute["value"] as Node | null;
          if (value?.type === "JSXExpressionContainer") value = value["expression"] as Node;
          if (
            value?.type === "Literal" &&
            typeof value["value"] === "string" &&
            value["value"].startsWith("icon")
          ) {
            context.report({ node, messageId: "iconButton" });
          }
        }
      },
    };
  },
};

const ASCII_ELLIPSIS = /\.\.\.(?!\w)/;

/** UI copy uses the "…" character (U+2026), never three periods. */
const noAsciiEllipsis: Rule = {
  meta: {
    type: "suggestion",
    docs: { description: 'Disallow "..." in JSX text and attribute strings.' },
    messages: { ellipsis: 'Use "…" (U+2026) instead of "..." in UI copy.' },
  },
  create(context) {
    const check = (node: Node, text: unknown) => {
      if (typeof text === "string" && ASCII_ELLIPSIS.test(text)) {
        context.report({ node, messageId: "ellipsis" });
      }
    };
    return {
      JSXText(node) {
        check(node, node["value"]);
      },
      JSXAttribute(node) {
        const value = node["value"] as Node | null;
        if (value?.type === "Literal") check(value, value["value"]);
      },
      JSXExpressionContainer(node) {
        const expression = node["expression"] as Node;
        if (expression.type === "Literal") check(expression, expression["value"]);
      },
    };
  },
};

export const rules = {
  "no-ascii-ellipsis": noAsciiEllipsis,
  "no-icon-size-button": noIconSizeButton,
  "no-native-radio": noNativeRadio,
  "no-raw-color": noRawColor,
};

export default { meta: { name: "osmix" }, rules };

import { createCn } from "cn/config";

/**
 * `cn` taught the theme's custom keys, so a call-site `p-0` replaces a primitive's `p-inset` and
 * `shadow-none` replaces `shadow-raised` instead of both being kept.
 */
export const cn = createCn({
  extend: {
    theme: {
      spacing: ["inset"],
      shadow: ["raised", "modal"],
    },
  },
});

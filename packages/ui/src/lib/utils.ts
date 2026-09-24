import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * `tailwind-merge` taught the theme's custom keys, so a call-site `p-0` replaces a primitive's
 * `p-inset` and `shadow-none` replaces `shadow-raised` instead of both being kept.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      spacing: ["inset"],
      shadow: ["raised", "modal"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

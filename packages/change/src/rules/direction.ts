/**
 * Tags whose meaning depends on which way a way runs: `oneway`, `incline`, and keys or values
 * that name a side or direction (`sidewalk=left`, `cycleway:right`, `turn:lanes:forward`).
 */
import type { OsmTags } from "@osmix/types";

import { isDescriptiveWayTag } from "./tags.ts";

const RELATIVE = new Set(["forward", "backward", "left", "right", "opposite"]);

const SWAP: Record<string, string> = {
  forward: "backward",
  backward: "forward",
  left: "right",
  right: "left",
  up: "down",
  down: "up",
};

/** Whether a tag's meaning changes when the way is reversed. */
export function isDirectionRelativeTag(key: string, value: string) {
  if (key === "oneway" || key === "incline" || key.startsWith("oneway:")) return true;
  if (key.split(":").some((part) => RELATIVE.has(part) || part === "direction")) return true;
  if (isDescriptiveWayTag(key)) return false;
  return value
    .toLowerCase()
    .split(/[^a-z]+/)
    .some((part) => RELATIVE.has(part));
}

/** The tags among `tags` whose meaning changes when the way is reversed. */
export function directionRelativeTags(tags: OsmTags | undefined): Record<string, string> {
  const relative: Record<string, string> = {};
  for (const [key, value] of Object.entries(tags ?? {})) {
    if (isDirectionRelativeTag(key, String(value))) relative[key] = String(value);
  }
  return relative;
}

/**
 * Direction-relative tags as they read on the reversed way: sides and directions swap in keys
 * and values, `incline` changes sign or swaps up and down, and `oneway` turns around.
 */
export function reverseDirectionTags(tags: Record<string, string>): Record<string, string> {
  const reversed: Record<string, string> = {};
  for (const [key, value] of Object.entries(tags)) {
    reversed[swapWords(key, ":")] = reverseValue(key, value);
  }
  return reversed;
}

function swapWords(text: string, separator: string) {
  return text
    .split(separator)
    .map((part) => SWAP[part] ?? part)
    .join(separator);
}

function reverseValue(key: string, value: string) {
  if (key === "oneway" || key.startsWith("oneway:")) {
    if (["yes", "true", "1"].includes(value)) return "-1";
    if (value === "-1" || value === "reverse") return "yes";
    return value;
  }
  if (key === "incline" && /^[+-]?\d/.test(value)) {
    const magnitude = value.replace(/^[+-]/, "");
    if (/^0*\.?0*%?$/.test(magnitude)) return value;
    return value.startsWith("-") ? magnitude : `-${magnitude}`;
  }
  return value.replace(/[a-z]+/gi, (word) => SWAP[word.toLowerCase()] ?? word);
}

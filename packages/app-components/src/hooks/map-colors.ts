import { useState } from "react";

/** Map roles defined as `--map-*` tokens in `@osmix/ui/styles.css`. */
const MAP_COLOR_TOKENS = {
  base: "--map-base",
  patch: "--map-patch",
  hover: "--map-hover",
  selected: "--map-selected",
  casing: "--map-casing",
  route: "--map-route",
  routeError: "--map-route-error",
  bbox: "--map-bbox",
  outcomeAdded: "--map-outcome-added",
  outcomeReplaced: "--map-outcome-replaced",
  outcomeMerged: "--map-outcome-merged",
  outcomeConnected: "--map-outcome-connected",
  outcomeRemoved: "--map-outcome-removed",
  outcomeDecision: "--map-outcome-decision",
  outcomeUnchanged: "--map-outcome-unchanged",
} as const;

export type MapColorRole = keyof typeof MAP_COLOR_TOKENS;
export type MapColors = Record<MapColorRole, string>;

/**
 * Resolve the `--map-*` tokens into `rgb()` strings MapLibre's style parser accepts (it does
 * not parse `oklch()` or `var()`). Paints each token onto a 1×1 canvas and reads the pixel back.
 */
export function readMapColors(): MapColors {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Cannot resolve map colors: 2D canvas is unavailable");
  const probe = document.createElement("span");
  probe.hidden = true;
  document.body.append(probe);
  try {
    const read = (token: string) => {
      probe.style.color = `var(${token})`;
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = getComputedStyle(probe).color;
      context.fillRect(0, 0, 1, 1);
      const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
      return `rgb(${red}, ${green}, ${blue})`;
    };
    const entries = Object.entries(MAP_COLOR_TOKENS).map(([role, token]) => [role, read(token)]);
    return Object.fromEntries(entries) as MapColors;
  } finally {
    probe.remove();
  }
}

/**
 * Map paint colors for every MapLibre layer. Never hard-code colors in layer paint; use a role
 * from here so the map stays in step with the theme.
 */
export function useMapColors(): MapColors {
  const [colors] = useState(readMapColors);
  return colors;
}

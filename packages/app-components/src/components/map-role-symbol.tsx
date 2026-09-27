import type { ComponentProps } from "react";

import type { OsmixOverlayRole } from "./osmix-vector-overlay.tsx";

/** How a role symbol is drawn: as a key entry (with its line) or as a point marker. */
export type MapRoleSymbolVariant = "line" | "point";

/**
 * The key symbol for a dataset role, as the overlay draws it: `base` is a solid line with a
 * circle in `--map-base`, `patch` a dashed line with a diamond in `--map-patch`, both over a
 * `--map-casing` outline. The `point` variant drops the line and draws the marker shapes only:
 * a hollow ring for `base` and a smaller diamond for `patch`, so a co-located pair stays
 * distinguishable (the diamond sits inside the ring). Decorative (`aria-hidden`); name the role
 * in text next to it. `size` is the rendered width and height in pixels. Extra props reach the
 * `svg`, so a caller can set its own `data-slot` and `data-role`.
 */
export function MapRoleSymbol({
  role,
  variant = "line",
  size = 16,
  ...props
}: Omit<ComponentProps<"svg">, "role"> & {
  role: OsmixOverlayRole;
  variant?: MapRoleSymbolVariant;
  size?: number;
}) {
  return (
    <svg
      aria-hidden="true"
      data-slot="map-role-symbol"
      data-role={role}
      data-variant={variant}
      width={size}
      height={size}
      viewBox="0 0 28 28"
      className="shrink-0"
      {...props}
    >
      {variant === "point" ? (
        <PointSymbol role={role} />
      ) : role === "base" ? (
        <>
          <line x1="2" y1="14" x2="26" y2="14" stroke="var(--map-casing)" strokeWidth="6" />
          <line x1="2" y1="14" x2="26" y2="14" stroke="var(--map-base)" strokeWidth="3" />
          <circle
            cx="14"
            cy="14"
            r="6"
            fill="var(--map-base)"
            stroke="var(--map-casing)"
            strokeWidth="2.5"
          />
        </>
      ) : (
        <>
          <line x1="2" y1="14" x2="26" y2="14" stroke="var(--map-casing)" strokeWidth="6" />
          <line
            x1="2"
            y1="14"
            x2="26"
            y2="14"
            stroke="var(--map-patch)"
            strokeWidth="3"
            strokeDasharray="3.6 2.4"
          />
          <path
            d="M14 6 22 14 14 22 6 14Z"
            fill="var(--map-patch)"
            stroke="var(--map-casing)"
            strokeWidth="2.5"
          />
        </>
      )}
    </svg>
  );
}

/** The marker shapes alone: a ring for `base`, a diamond that fits inside it for `patch`. */
function PointSymbol({ role }: { role: OsmixOverlayRole }) {
  if (role === "base") {
    return (
      <>
        <circle cx="14" cy="14" r="10" fill="none" stroke="var(--map-casing)" strokeWidth="7" />
        <circle cx="14" cy="14" r="10" fill="none" stroke="var(--map-base)" strokeWidth="3" />
      </>
    );
  }
  return (
    <path
      d="M14 7 21 14 14 21 7 14Z"
      fill="var(--map-patch)"
      stroke="var(--map-casing)"
      strokeWidth="2"
    />
  );
}

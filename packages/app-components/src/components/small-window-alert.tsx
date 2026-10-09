import { Alert } from "@osmix/ui";

/**
 * A persistent banner under the nav in windows narrower than 1024px, which the apps don't
 * support. CSS decides (`small-window-only`), so it never renders or announces on wider windows.
 * It can't be dismissed and doesn't block the app. A passive note (no `role="alert"`): it is part
 * of the page from load, not an event, and stays out of `[role="alert"]` queries.
 */
export function SmallWindowAlert() {
  return (
    <Alert
      shape="banner"
      variant="warning"
      title="Osmix needs a wider window"
      // oxlint-disable-next-line shadcn/no-restyle -- a custom @utility it cannot classify
      className="small-window-only"
    >
      These apps are built for desktop windows at least 1024px wide. Widen the window or use a
      larger screen.
    </Alert>
  );
}

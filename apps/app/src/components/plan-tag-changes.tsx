import { SectionTitle } from "@osmix/ui";
import type { PlanTagChanges } from "osmix";

const tagCount = (count: number) => `${count.toLocaleString()} ${count === 1 ? "tag" : "tags"}`;

/**
 * A proposal's tag changes in one line for its row: "Changes 2 tags" once it is in the plan,
 * "Would change 2 tags" while it waits or is left out.
 */
export function tagChangesSummary(changes: PlanTagChanges, applied: boolean) {
  if (changes.entity === null) {
    const tags = changes.changes.map(({ key, after }) => `${key}=${after}`).join(", ");
    return `${applied ? "Adds" : "Would add"} a point tagged ${tags}`;
  }
  return `${applied ? "Changes" : "Would change"} ${tagCount(changes.changes.length)}`;
}

/**
 * The keys a proposal changes, base value to result, stacked so long values stay readable in
 * the sidebar; the tags it leaves alone are counted, not listed.
 */
export function PlanTagChangeList({ changes, title }: { changes: PlanTagChanges; title: string }) {
  return (
    <section aria-label={`Tag changes: ${title}`} className="flex min-w-0 flex-col">
      <SectionTitle>Tag changes: {title}</SectionTitle>
      {changes.changes.map(({ key, before, after }) => (
        <div key={key} className="flex min-w-0 flex-col gap-1 border-t p-inset">
          <p className="font-mono font-semibold break-all select-all">
            {key}{" "}
            <span className="font-sans font-normal text-muted-foreground">
              {before === undefined ? "added" : after === undefined ? "removed" : "changed"}
            </span>
          </p>
          <dl className="flex min-w-0 flex-col gap-1">
            <dt className="text-muted-foreground">Base value</dt>
            <dd className="min-w-0 break-all select-all">{before ?? "not set"}</dd>
            <dt className="text-muted-foreground">Result</dt>
            <dd className="min-w-0 break-all select-all">{after ?? "removed"}</dd>
          </dl>
        </div>
      ))}
      {changes.unchanged > 0 ? (
        <p className="border-t p-inset text-muted-foreground">
          {tagCount(changes.unchanged)} unchanged
        </p>
      ) : null}
    </section>
  );
}

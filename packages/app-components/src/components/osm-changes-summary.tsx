import {
  changesAtom,
  changesetStatsAtom,
  changeTypeFilterAtom,
  entityTypeFilterAtom,
  pageAtom,
  pageSizeAtom,
  selectedEntityAtom,
  startIndexAtom,
} from "@osmix/app-core";
import {
  cn,
  Checkbox,
  CheckboxLabel,
  Details,
  DetailsContent,
  DetailsSummary,
  EmptyState,
  Item,
  Pager,
  StatusDot,
  type StatusDotStatus,
  Table,
  TableBody,
  TableCell,
  TableRow,
} from "@osmix/ui";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { ChevronDownIcon } from "lucide-react";
import type {
  OsmChange,
  OsmChangesetStats,
  OsmChangeTypes,
  OsmEntity,
  OsmEntityType,
  OsmNode,
  OsmRelation,
  OsmWay,
} from "osmix";
import { getEntityType, isNode, isRelation, isWay } from "osmix";
import { useId, useTransition } from "react";

import { changeDescription, changeTypeLabel, entityTypeLabel } from "../lib/change-labels.ts";
import { EntityContent } from "./entity-details.tsx";

/**
 * `changeset` describes a cross-dataset merge changeset. `deduplication` describes duplicates
 * found inside one dataset, so it omits the intersection counts that scan never produces.
 */
export type ChangesSummaryVariant = "changeset" | "deduplication";

function plural(count: number, noun: string) {
  return `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;
}

/** One sentence that says what the changes do, before any table. */
export function changesLead(summary: OsmChangesetStats, variant: ChangesSummaryVariant): string {
  if (variant === "deduplication") {
    const found = [
      summary.deduplicatedNodes > 0 ? plural(summary.deduplicatedNodes, "duplicate node") : null,
      summary.deduplicatedWays > 0 ? plural(summary.deduplicatedWays, "duplicate way") : null,
    ].filter(Boolean);
    const rewritten =
      summary.deduplicatedNodesReplaced > 0
        ? ` Applying them rewrites ${plural(summary.deduplicatedNodesReplaced, "node reference")}.`
        : "";
    return `${found.join(" and ")}.${rewritten}`;
  }
  const kinds = [
    summary.createChanges > 0 ? `${summary.createChanges.toLocaleString()} created` : null,
    summary.modifyChanges > 0 ? `${summary.modifyChanges.toLocaleString()} modified` : null,
    summary.deleteChanges > 0 ? `${summary.deleteChanges.toLocaleString()} deleted` : null,
  ].filter(Boolean);
  return `${plural(summary.totalChanges, "change")}: ${kinds.join(", ")}.`;
}

/**
 * The lead sentence, then the full counts in a closed "Summary" disclosure. Place it in a
 * `flush` section.
 */
export default function ChangesSummary({
  defaultOpen = false,
  variant = "changeset",
}: {
  defaultOpen?: boolean;
  variant?: ChangesSummaryVariant;
}) {
  const summary = useAtomValue(changesetStatsAtom);
  if (!summary || summary.totalChanges === 0) {
    return (
      <EmptyState>
        {variant === "deduplication" ? "No duplicate nodes or ways found" : "No changes found"}
      </EmptyState>
    );
  }
  return (
    <>
      <p className="px-inset pb-inset">{changesLead(summary, variant)}</p>
      <Details defaultOpen={defaultOpen}>
        <DetailsSummary>Summary</DetailsSummary>
        <DetailsContent>
          <ChangesSummaryTable summary={summary} variant={variant} />
        </DetailsContent>
      </Details>
    </>
  );
}

function ChangesSummaryTable({
  summary,
  variant,
}: {
  summary: OsmChangesetStats;
  variant: ChangesSummaryVariant;
}) {
  const reconciliationHelpId = useId();
  return (
    <>
      <Table aria-describedby={reconciliationHelpId}>
        <TableBody>
          <TableRow>
            <TableCell>Total changes</TableCell>
            <TableCell numeric>{summary.totalChanges.toLocaleString()}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell>Node changes</TableCell>
            <TableCell numeric>{summary.nodeChanges.toLocaleString()}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell>Way changes</TableCell>
            <TableCell numeric>{summary.wayChanges.toLocaleString()}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell>Relation changes</TableCell>
            <TableCell numeric>{summary.relationChanges.toLocaleString()}</TableCell>
          </TableRow>

          <TableRow>
            <TableCell>
              {variant === "deduplication" ? "Duplicate nodes" : "Reconciled nodes"}
            </TableCell>
            <TableCell numeric>{summary.deduplicatedNodes.toLocaleString()}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell>Node references rewritten</TableCell>
            <TableCell numeric>{summary.deduplicatedNodesReplaced.toLocaleString()}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell>
              {variant === "deduplication" ? "Duplicate ways" : "Reconciled ways"}
            </TableCell>
            <TableCell numeric>{summary.deduplicatedWays.toLocaleString()}</TableCell>
          </TableRow>
          {variant === "changeset" ? (
            <>
              <TableRow>
                <TableCell>Intersection points found</TableCell>
                <TableCell numeric>{summary.intersectionPointsFound.toLocaleString()}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Intersection nodes created</TableCell>
                <TableCell numeric>{summary.intersectionNodesCreated.toLocaleString()}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Replaced imported points removed</TableCell>
                <TableCell numeric>{summary.intersectionNodesRemoved.toLocaleString()}</TableCell>
              </TableRow>
            </>
          ) : null}
        </TableBody>
      </Table>
      <p className="border-t px-inset py-2 text-muted-foreground" id={reconciliationHelpId}>
        {variant === "deduplication" ? (
          <>
            Each duplicate is removed in favor of the compatible entity with the highest ID. Node
            references rewritten counts way node references and relation node members that would
            change from a duplicate node ID to its surviving node ID.
          </>
        ) : (
          <>
            Reconciliation resolves equivalent entities to one surviving entity instead of retaining
            both. Node references rewritten counts way node references and relation node members
            changed from a reconciled node ID to its surviving node ID.
          </>
        )}
      </p>
    </>
  );
}

function FilterCheckbox<T extends string>({
  value,
  label,
  count,
  filter,
  setFilter,
}: {
  value: T;
  label: string;
  count: number;
  filter: T[];
  setFilter: (filter: T[]) => void;
}) {
  const setPage = useSetAtom(pageAtom);
  const [, startTransition] = useTransition();

  return (
    <CheckboxLabel>
      <Checkbox
        checked={filter.includes(value)}
        onCheckedChange={(checked) => {
          startTransition(() => {
            setPage(0);
            if (checked) {
              setFilter([...filter, value]);
            } else {
              setFilter(filter.filter((type) => type !== value));
            }
          });
        }}
      />
      {label}
      <span className="text-muted-foreground">{count.toLocaleString()}</span>
    </CheckboxLabel>
  );
}

/**
 * One filter group, with each option's count. Options with nothing to show are left out, and
 * a group with fewer than two options left is not shown: a single checkbox filters nothing.
 */
function FilterGroup<T extends string>({
  legend,
  options,
  filter,
  setFilter,
  label,
}: {
  legend: string;
  options: readonly (readonly [T, number])[];
  filter: T[];
  setFilter: (filter: T[]) => void;
  label: (value: T) => string;
}) {
  const shown = options.filter(([, count]) => count > 0);
  if (shown.length < 2) return null;
  return (
    <fieldset className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <legend className="pb-1 text-muted-foreground">{legend}</legend>
      {shown.map(([value, count]) => (
        <FilterCheckbox
          key={value}
          value={value}
          label={label(value)}
          count={count}
          filter={filter}
          setFilter={setFilter}
        />
      ))}
    </fieldset>
  );
}

/**
 * Filters by change type and entity type, each option with its count from the changeset stats.
 * Renders nothing when no group has two or more options to choose between.
 */
export function ChangesFilters() {
  const summary = useAtomValue(changesetStatsAtom);
  const [changeTypeFilter, setChangeTypeFilter] = useAtom(changeTypeFilterAtom);
  const [entityTypeFilter, setEntityTypeFilter] = useAtom(entityTypeFilterAtom);
  if (!summary) return null;
  const changeTypes = [
    ["create", summary.createChanges],
    ["modify", summary.modifyChanges],
    ["delete", summary.deleteChanges],
  ] as const satisfies readonly (readonly [OsmChangeTypes, number])[];
  const entityTypes = [
    ["node", summary.nodeChanges],
    ["way", summary.wayChanges],
    ["relation", summary.relationChanges],
  ] as const satisfies readonly (readonly [OsmEntityType, number])[];
  const hasChoice = [changeTypes, entityTypes].some(
    (options) => options.filter(([, count]) => count > 0).length >= 2,
  );
  if (!hasChoice) return null;

  return (
    <div
      data-slot="changes-filters"
      className="flex flex-wrap justify-between gap-x-4 gap-y-2 border-t px-inset py-2"
    >
      <FilterGroup
        legend="Change"
        options={changeTypes}
        filter={changeTypeFilter}
        setFilter={setChangeTypeFilter}
        label={changeTypeLabel}
      />
      <FilterGroup
        legend="Entity"
        options={entityTypes}
        filter={entityTypeFilter}
        setFilter={setEntityTypeFilter}
        label={entityTypeLabel}
      />
    </div>
  );
}

const CHANGE_TYPE_STATUS: Record<OsmChangeTypes, StatusDotStatus> = {
  create: "ok",
  modify: "warn",
  delete: "error",
};

function isSameEntity(a: OsmEntity | null, b: OsmEntity) {
  return a !== null && a.id === b.id && getEntityType(a) === getEntityType(b);
}

/**
 * The page of changes as a divided list. A row shows its change type (a status dot and the
 * word), the entity, and a line on what it relates to. Clicking a row selects the entity on the
 * map; the selected row is the current one, tinted and expanded to show its diff. Clearing the
 * selection (Esc on the map) collapses it.
 */
export function ChangesList({
  duplicates = false,
  setSelectedEntity,
}: {
  /** Describe deletions as duplicates of the entity that replaces them. */
  duplicates?: boolean;
  setSelectedEntity: (entity: OsmEntity) => void;
}) {
  const page = useAtomValue(changesAtom);
  const startIndex = useAtomValue(startIndexAtom);
  const pageSize = useAtomValue(pageSizeAtom);
  const selected = useAtomValue(selectedEntityAtom);
  const changes = page?.changes ?? [];
  const total = page?.total ?? 0;

  if (changes.length === 0) {
    return <EmptyState className="border-t">No changes match these filters</EmptyState>;
  }
  return (
    <>
      <p className="border-t px-inset py-2 text-muted-foreground" aria-live="polite">
        {(startIndex + 1).toLocaleString()}–
        {Math.min(startIndex + pageSize, total).toLocaleString()} of {plural(total, "change")}
      </p>
      <div role="list" aria-label="Changes" className="flex flex-col border-t">
        {changes.map((change) => {
          const { changeType, entity } = change;
          const current = isSameEntity(selected, entity);
          return (
            <Item
              key={`${getEntityType(entity)}-${entity.id}`}
              role="listitem"
              variant="row"
              aria-current={current ? "true" : undefined}
              className="flex-col items-stretch gap-0 p-0"
            >
              <button
                type="button"
                aria-expanded={current}
                className="flex w-full cursor-pointer items-start gap-2 px-inset py-2 text-left focus-ring"
                onClick={() => setSelectedEntity(entity)}
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex items-center gap-2">
                    <StatusDot status={CHANGE_TYPE_STATUS[changeType]} />
                    <span className="font-semibold">{changeTypeLabel(changeType)}</span>
                    <span>
                      {entityTypeLabel(getEntityType(entity))}{" "}
                      <span className="font-mono">{entity.id}</span>
                    </span>
                  </span>
                  <span className="truncate text-muted-foreground">
                    {changeDescription(change, { duplicates })}
                  </span>
                </span>
                <ChevronDownIcon
                  aria-hidden="true"
                  className={cn(
                    "mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform",
                    current && "rotate-180",
                  )}
                />
              </button>
              {current ? (
                <div data-slot="change-diff" className="border-t">
                  <AugmentedDiffContent change={change} />
                </div>
              ) : null}
            </Item>
          );
        })}
      </div>
    </>
  );
}

type DiffStatus = "added" | "removed" | "modified" | "unchanged";

/**
 * Renders a table row with diff highlighting.
 */
function DiffRow({
  label,
  oldValue,
  newValue,
  status,
}: {
  label: string;
  oldValue?: string;
  newValue?: string;
  status: DiffStatus;
}) {
  return (
    <TableRow
      className={cn(
        status === "added" && "bg-success/10",
        status === "removed" && "bg-destructive/10",
        status === "modified" && "bg-warning/10",
      )}
    >
      <TableCell>{label}</TableCell>
      <TableCell>
        {status === "removed" ? (
          <span className="text-destructive line-through">{oldValue}</span>
        ) : status === "added" ? (
          <span className="text-success">{newValue}</span>
        ) : status === "modified" ? (
          <>
            <span className="text-destructive line-through">{oldValue}</span>
            <span className="mx-1">→</span>
            <span className="text-success">{newValue}</span>
          </>
        ) : (
          <span>{newValue}</span>
        )}
      </TableCell>
    </TableRow>
  );
}

function tagValueToString(val: unknown): string {
  if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
    return String(val);
  }
  if (val == null) {
    return "";
  }
  return JSON.stringify(val);
}

/**
 * Computes and displays a unified diff for tags.
 */
function TagsDiff({
  oldTags,
  newTags,
}: {
  oldTags?: Record<string, unknown>;
  newTags?: Record<string, unknown>;
}) {
  const old = oldTags ?? {};
  const current = newTags ?? {};
  const allKeys = new Set([...Object.keys(old), ...Object.keys(current)]);

  const rows: Array<{
    key: string;
    status: DiffStatus;
    oldValue?: string;
    newValue?: string;
  }> = [];

  for (const key of allKeys) {
    const oldVal = old[key] !== undefined ? tagValueToString(old[key]) : undefined;
    const newVal = current[key] !== undefined ? tagValueToString(current[key]) : undefined;

    if (oldVal === undefined && newVal !== undefined) {
      rows.push({ key, status: "added", newValue: newVal });
    } else if (oldVal !== undefined && newVal === undefined) {
      rows.push({ key, status: "removed", oldValue: oldVal });
    } else if (oldVal !== newVal) {
      rows.push({ key, status: "modified", oldValue: oldVal, newValue: newVal });
    } else {
      rows.push({ key, status: "unchanged", newValue: newVal });
    }
  }

  // Sort: modified first, then added, then removed, then unchanged
  const statusOrder: Record<DiffStatus, number> = {
    modified: 0,
    added: 1,
    removed: 2,
    unchanged: 3,
  };
  rows.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);

  return (
    <>
      {rows.map((row) => (
        <DiffRow
          key={row.key}
          label={row.key}
          oldValue={row.oldValue}
          newValue={row.newValue}
          status={row.status}
        />
      ))}
    </>
  );
}

/**
 * Displays a unified diff for a node entity.
 */
function NodeDiff({ oldNode, newNode }: { oldNode: OsmNode; newNode: OsmNode }) {
  const lonChanged = oldNode.lon !== newNode.lon;
  const latChanged = oldNode.lat !== newNode.lat;

  return (
    <Table>
      <TableBody>
        <DiffRow
          label="lon"
          oldValue={String(oldNode.lon)}
          newValue={String(newNode.lon)}
          status={lonChanged ? "modified" : "unchanged"}
        />
        <DiffRow
          label="lat"
          oldValue={String(oldNode.lat)}
          newValue={String(newNode.lat)}
          status={latChanged ? "modified" : "unchanged"}
        />
        <TagsDiff oldTags={oldNode.tags} newTags={newNode.tags} />
      </TableBody>
    </Table>
  );
}

type ArrayDiffOp =
  | { type: "keep"; value: number; index: number }
  | { type: "insert"; value: number; index: number }
  | { type: "delete"; value: number; index: number };

/**
 * Computes a diff between two number arrays using a simple LCS-based approach.
 * Returns an array of operations (keep, insert, delete) to transform oldArr to newArr.
 */
function computeArrayDiff(oldArr: number[], newArr: number[]): ArrayDiffOp[] {
  // Build LCS table
  const m = oldArr.length;
  const n = newArr.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldArr[i - 1] === newArr[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to find the diff
  const ops: ArrayDiffOp[] = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldArr[i - 1] === newArr[j - 1]) {
      ops.unshift({ type: "keep", value: oldArr[i - 1], index: j - 1 });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.unshift({ type: "insert", value: newArr[j - 1], index: j - 1 });
      j--;
    } else {
      ops.unshift({ type: "delete", value: oldArr[i - 1], index: i - 1 });
      i--;
    }
  }

  return ops;
}

/**
 * Displays a compact diff for refs arrays, showing only the changes.
 */
function RefsDiff({ oldRefs, newRefs }: { oldRefs: number[]; newRefs: number[] }) {
  const oldRefsStr = oldRefs.join(",");
  const newRefsStr = newRefs.join(",");

  if (oldRefsStr === newRefsStr) {
    return (
      <TableRow>
        <TableCell>refs</TableCell>
        <TableCell className="text-muted-foreground">{newRefs.length} nodes (unchanged)</TableCell>
      </TableRow>
    );
  }

  const ops = computeArrayDiff(oldRefs, newRefs);

  // Count changes
  const inserts = ops.filter((op) => op.type === "insert");
  const deletes = ops.filter((op) => op.type === "delete");

  // For small arrays or when most elements changed, show full diff
  if (oldRefs.length <= 5 || newRefs.length <= 5) {
    return (
      <TableRow className="bg-warning/10">
        <TableCell>refs</TableCell>
        <TableCell>
          <span className="text-destructive line-through">{oldRefsStr}</span>
          <span className="mx-1">→</span>
          <span className="text-success">{newRefsStr}</span>
        </TableCell>
      </TableRow>
    );
  }

  // Show compact summary with inline changes
  return (
    <>
      <TableRow className="bg-warning/10">
        <TableCell>refs</TableCell>
        <TableCell>
          <span className="text-muted-foreground">
            {newRefs.length} nodes ({inserts.length} added, {deletes.length} removed)
          </span>
        </TableCell>
      </TableRow>
      {deletes.length > 0 && (
        <TableRow className="bg-destructive/10">
          <TableCell className="pl-4 text-muted-foreground">removed</TableCell>
          <TableCell>
            {deletes.map((op) => (
              <span key={`del-${op.index}-${op.value}`} className="text-destructive">
                <span className="text-muted-foreground">[{op.index}]</span>
                <span className="line-through">{op.value}</span>
                {op !== deletes[deletes.length - 1] && ", "}
              </span>
            ))}
          </TableCell>
        </TableRow>
      )}
      {inserts.length > 0 && (
        <TableRow className="bg-success/10">
          <TableCell className="pl-4 text-muted-foreground">added</TableCell>
          <TableCell>
            {inserts.map((op) => (
              <span key={`ins-${op.index}-${op.value}`} className="text-success">
                <span className="text-muted-foreground">[{op.index}]</span>
                {op.value}
                {op !== inserts[inserts.length - 1] && ", "}
              </span>
            ))}
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

/**
 * Displays a unified diff for a way entity.
 */
function WayDiff({ oldWay, newWay }: { oldWay: OsmWay; newWay: OsmWay }) {
  return (
    <Table>
      <TableBody>
        <RefsDiff oldRefs={oldWay.refs} newRefs={newWay.refs} />
        <TagsDiff oldTags={oldWay.tags} newTags={newWay.tags} />
      </TableBody>
    </Table>
  );
}

type MemberArrayDiffOp =
  | { type: "keep"; value: OsmRelation["members"][0]; index: number }
  | { type: "insert"; value: OsmRelation["members"][0]; index: number }
  | { type: "delete"; value: OsmRelation["members"][0]; index: number };

/**
 * Computes a diff between two member arrays.
 */
function computeMemberArrayDiff(
  oldArr: OsmRelation["members"],
  newArr: OsmRelation["members"],
): MemberArrayDiffOp[] {
  const memberKey = (m: OsmRelation["members"][0]) => `${m.type}:${m.ref}:${m.role ?? ""}`;

  const m = oldArr.length;
  const n = newArr.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (memberKey(oldArr[i - 1]) === memberKey(newArr[j - 1])) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const ops: MemberArrayDiffOp[] = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && memberKey(oldArr[i - 1]) === memberKey(newArr[j - 1])) {
      ops.unshift({ type: "keep", value: oldArr[i - 1], index: j - 1 });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.unshift({ type: "insert", value: newArr[j - 1], index: j - 1 });
      j--;
    } else {
      ops.unshift({ type: "delete", value: oldArr[i - 1], index: i - 1 });
      i--;
    }
  }

  return ops;
}

/**
 * Formats a single member for display.
 */
function formatMember(m: OsmRelation["members"][0]) {
  return `${m.type}:${m.ref}${m.role ? `(${m.role})` : ""}`;
}

/**
 * Displays a compact diff for relation members, showing only the changes.
 */
function MembersDiff({
  oldMembers,
  newMembers,
}: {
  oldMembers: OsmRelation["members"];
  newMembers: OsmRelation["members"];
}) {
  const oldStr = oldMembers.map(formatMember).join(", ");
  const newStr = newMembers.map(formatMember).join(", ");

  if (oldStr === newStr) {
    return (
      <TableRow>
        <TableCell>members</TableCell>
        <TableCell className="text-muted-foreground">
          {newMembers.length} members (unchanged)
        </TableCell>
      </TableRow>
    );
  }

  const ops = computeMemberArrayDiff(oldMembers, newMembers);

  const inserts = ops.filter((op) => op.type === "insert");
  const deletes = ops.filter((op) => op.type === "delete");

  // For small arrays, show full diff
  if (oldMembers.length <= 3 || newMembers.length <= 3) {
    return (
      <TableRow className="bg-warning/10">
        <TableCell>members</TableCell>
        <TableCell>
          <span className="text-destructive line-through">{oldStr}</span>
          <span className="mx-1">→</span>
          <span className="text-success">{newStr}</span>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <>
      <TableRow className="bg-warning/10">
        <TableCell>members</TableCell>
        <TableCell>
          <span className="text-muted-foreground">
            {newMembers.length} members ({inserts.length} added, {deletes.length} removed)
          </span>
        </TableCell>
      </TableRow>
      {deletes.length > 0 && (
        <TableRow className="bg-destructive/10">
          <TableCell className="pl-4 text-muted-foreground">removed</TableCell>
          <TableCell>
            {deletes.map((op) => (
              <span key={`del-${op.index}-${formatMember(op.value)}`} className="text-destructive">
                <span className="text-muted-foreground">[{op.index}]</span>
                <span className="line-through">{formatMember(op.value)}</span>
                {op !== deletes[deletes.length - 1] && ", "}
              </span>
            ))}
          </TableCell>
        </TableRow>
      )}
      {inserts.length > 0 && (
        <TableRow className="bg-success/10">
          <TableCell className="pl-4 text-muted-foreground">added</TableCell>
          <TableCell>
            {inserts.map((op) => (
              <span key={`ins-${op.index}-${formatMember(op.value)}`} className="text-success">
                <span className="text-muted-foreground">[{op.index}]</span>
                {formatMember(op.value)}
                {op !== inserts[inserts.length - 1] && ", "}
              </span>
            ))}
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

/**
 * Displays a unified diff for a relation entity.
 */
function RelationDiff({
  oldRelation,
  newRelation,
}: {
  oldRelation: OsmRelation;
  newRelation: OsmRelation;
}) {
  return (
    <Table>
      <TableBody>
        <MembersDiff oldMembers={oldRelation.members} newMembers={newRelation.members} />
        <TagsDiff oldTags={oldRelation.tags} newTags={newRelation.tags} />
      </TableBody>
    </Table>
  );
}

/**
 * Displays a unified diff for any entity type.
 */
function EntityDiff({ oldEntity, newEntity }: { oldEntity: OsmEntity; newEntity: OsmEntity }) {
  if (isNode(oldEntity) && isNode(newEntity)) {
    return <NodeDiff oldNode={oldEntity} newNode={newEntity} />;
  }
  if (isWay(oldEntity) && isWay(newEntity)) {
    return <WayDiff oldWay={oldEntity} newWay={newEntity} />;
  }
  if (isRelation(oldEntity) && isRelation(newEntity)) {
    return <RelationDiff oldRelation={oldEntity} newRelation={newEntity} />;
  }
  // Fallback
  return <EntityContent entity={newEntity} />;
}

/**
 * Displays a deleted entity with all properties shown as removed.
 */
function DeletedEntityContent({ entity }: { entity: OsmEntity }) {
  if (isNode(entity)) {
    return (
      <Table>
        <TableBody>
          <DiffRow label="lon" oldValue={String(entity.lon)} status="removed" />
          <DiffRow label="lat" oldValue={String(entity.lat)} status="removed" />
          {entity.tags &&
            Object.entries(entity.tags).map(([k, v]) => (
              <DiffRow key={k} label={k} oldValue={String(v)} status="removed" />
            ))}
        </TableBody>
      </Table>
    );
  }
  if (isWay(entity)) {
    const refsDisplay =
      entity.refs.length > 5 ? `${entity.refs.length} nodes` : entity.refs.join(",");
    return (
      <Table>
        <TableBody>
          <DiffRow label="refs" oldValue={refsDisplay} status="removed" />
          {entity.tags &&
            Object.entries(entity.tags).map(([k, v]) => (
              <DiffRow key={k} label={k} oldValue={String(v)} status="removed" />
            ))}
        </TableBody>
      </Table>
    );
  }
  if (isRelation(entity)) {
    const membersDisplay =
      entity.members.length > 3
        ? `${entity.members.length} members`
        : entity.members.map(formatMember).join(", ");
    return (
      <Table>
        <TableBody>
          <DiffRow label="members" oldValue={membersDisplay} status="removed" />
          {entity.tags &&
            Object.entries(entity.tags).map(([k, v]) => (
              <DiffRow key={k} label={k} oldValue={String(v)} status="removed" />
            ))}
        </TableBody>
      </Table>
    );
  }
  return <EntityContent entity={entity} />;
}

/**
 * Displays a created entity with all properties shown as added.
 */
function CreatedEntityContent({ entity }: { entity: OsmEntity }) {
  if (isNode(entity)) {
    return (
      <Table>
        <TableBody>
          <DiffRow label="lon" newValue={String(entity.lon)} status="added" />
          <DiffRow label="lat" newValue={String(entity.lat)} status="added" />
          {entity.tags &&
            Object.entries(entity.tags).map(([k, v]) => (
              <DiffRow key={k} label={k} newValue={String(v)} status="added" />
            ))}
        </TableBody>
      </Table>
    );
  }
  if (isWay(entity)) {
    const refsDisplay =
      entity.refs.length > 5 ? `${entity.refs.length} nodes` : entity.refs.join(",");
    return (
      <Table>
        <TableBody>
          <DiffRow label="refs" newValue={refsDisplay} status="added" />
          {entity.tags &&
            Object.entries(entity.tags).map(([k, v]) => (
              <DiffRow key={k} label={k} newValue={String(v)} status="added" />
            ))}
        </TableBody>
      </Table>
    );
  }
  if (isRelation(entity)) {
    const membersDisplay =
      entity.members.length > 3
        ? `${entity.members.length} members`
        : entity.members.map(formatMember).join(", ");
    return (
      <Table>
        <TableBody>
          <DiffRow label="members" newValue={membersDisplay} status="added" />
          {entity.tags &&
            Object.entries(entity.tags).map(([k, v]) => (
              <DiffRow key={k} label={k} newValue={String(v)} status="added" />
            ))}
        </TableBody>
      </Table>
    );
  }
  return <EntityContent entity={entity} />;
}

/**
 * Displays augmented diff content for a change.
 * Shows a unified diff with additions, deletions, and modifications highlighted.
 */
function AugmentedDiffContent({ change }: { change: OsmChange }) {
  const { changeType, entity, oldEntity } = change;

  return (
    <>
      {changeType === "modify" && oldEntity ? (
        <EntityDiff oldEntity={oldEntity} newEntity={entity} />
      ) : changeType === "delete" && oldEntity ? (
        <DeletedEntityContent entity={oldEntity} />
      ) : changeType === "create" ? (
        <CreatedEntityContent entity={entity} />
      ) : (
        <EntityContent entity={entity} />
      )}
    </>
  );
}

export function ChangesPagination() {
  const [currentPage, setCurrentPage] = useAtom(pageAtom);
  const totalPages = useAtomValue(changesAtom)?.totalPages ?? 0;
  const [isPending, startTransition] = useTransition();
  return (
    <Pager
      className="border-t px-inset py-2"
      label="Changes pages"
      page={currentPage}
      pageCount={totalPages}
      disabled={isPending}
      onPageChange={(page) => startTransition(() => setCurrentPage(page))}
    />
  );
}

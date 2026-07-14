import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type { OsmChange } from "osmix";
import type { OsmEntity, OsmNode, OsmRelation, OsmWay } from "osmix";
import { getEntityType, isNode, isRelation, isWay } from "osmix";
import { useTransition } from "react";

import { cn } from "../lib/utils";
import {
  changesAtom,
  changesetStatsAtom,
  changeTypeFilterAtom,
  entityTypeFilterAtom,
  pageAtom,
  startIndexAtom,
} from "../state/changes";
import { Details, DetailsContent, DetailsSummary } from "./details";
import { EntityContent } from "./entity-details";
import { EmptyState } from "./section";
import { Button } from "./ui/button";
import { Checkbox, CheckboxLabel } from "./ui/checkbox";
import { Table, TableBody, TableCell, TableRow } from "./ui/table";

export default function ChangesSummary() {
  return (
    <Details>
      <DetailsSummary>Summary</DetailsSummary>
      <DetailsContent>
        <ChangesSummaryTable />
      </DetailsContent>
    </Details>
  );
}

function ChangesSummaryTable() {
  const summary = useAtomValue(changesetStatsAtom);
  if (!summary || summary.totalChanges === 0) return <EmptyState>No changes found</EmptyState>;
  return (
    <Table>
      <TableBody>
        <TableRow>
          <TableCell>total changes</TableCell>
          <TableCell>{summary.totalChanges.toLocaleString()}</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>node changes</TableCell>
          <TableCell>{summary.nodeChanges.toLocaleString()}</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>way changes</TableCell>
          <TableCell>{summary.wayChanges.toLocaleString()}</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>relation changes</TableCell>
          <TableCell>{summary.relationChanges.toLocaleString()}</TableCell>
        </TableRow>

        <TableRow>
          <TableCell>deduplicated nodes</TableCell>
          <TableCell>{summary.deduplicatedNodes.toLocaleString()}</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>deduplicated nodes replaced</TableCell>
          <TableCell>{summary.deduplicatedNodesReplaced.toLocaleString()}</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>intersection points found</TableCell>
          <TableCell>{summary.intersectionPointsFound.toLocaleString()}</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}

function FilterCheckbox<T extends string>({
  value,
  filter,
  setFilter,
}: {
  value: T;
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
      {value}
    </CheckboxLabel>
  );
}

export function ChangesFilters() {
  const [changeTypeFilter, setChangeTypeFilter] = useAtom(changeTypeFilterAtom);
  const [entityTypeFilter, setEntityTypeFilter] = useAtom(entityTypeFilterAtom);

  return (
    <div className="flex flex-wrap justify-between gap-x-2 gap-y-1 px-2 py-2">
      {(["create", "modify", "delete"] as const).map((value) => (
        <FilterCheckbox
          key={value}
          value={value}
          filter={changeTypeFilter}
          setFilter={setChangeTypeFilter}
        />
      ))}
      {(["node", "way", "relation"] as const).map((value) => (
        <FilterCheckbox
          key={value}
          value={value}
          filter={entityTypeFilter}
          setFilter={setEntityTypeFilter}
        />
      ))}
    </div>
  );
}

const CHANGE_TYPE_COLOR = {
  create: "text-success",
  modify: "text-warning",
  delete: "text-destructive",
};

export function ChangesList({
  setSelectedEntity,
}: {
  setSelectedEntity: (entity: OsmEntity) => void;
}) {
  const changes = useAtomValue(changesAtom)?.changes;
  const startIndex = useAtomValue(startIndexAtom);

  return (
    <div className="flex flex-col">
      {changes?.map(({ changeType, entity, refs }, i) => {
        const changeTypeColor = CHANGE_TYPE_COLOR[changeType];
        const entityType = getEntityType(entity);
        return (
          <button
            key={`${entityType}-${entity.id}`}
            className={cn(
              "pl-2 py-1 font-bold cursor-pointer w-full text-left select-text hover:bg-accent",
              changeTypeColor,
            )}
            onClick={() => setSelectedEntity(entity)}
            type="button"
            tabIndex={0}
          >
            {startIndex + i + 1}. {changeType.toUpperCase()} {entityType.toUpperCase()} {entity.id}{" "}
            {refs && `(${refs.map((ref) => `${ref.type} ${ref.id}`).join(", ")})`}
          </button>
        );
      })}
    </div>
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
  const { changeType, entity, oldEntity, refs } = change;

  return (
    <>
      {refs && (
        <div className="p-2 border-b">
          Related: {refs.map((ref) => `${ref.type} ${ref.id}`).join(", ")}
        </div>
      )}
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

export function ChangesExpandableList() {
  const changes = useAtomValue(changesAtom)?.changes;
  const startIndex = useAtomValue(startIndexAtom);

  return (
    <div className="flex flex-col">
      {changes?.map((change, i) => {
        const { changeType, entity } = change;
        const changeTypeColor = CHANGE_TYPE_COLOR[changeType];
        const entityType = getEntityType(entity);
        const summaryLabel = `${startIndex + i + 1}. ${changeType.toUpperCase()} ${entityType.toUpperCase()} ${entity.id}`;
        return (
          <Details key={`${entityType}-${entity.id}`} defaultOpen={false}>
            <DetailsSummary className={cn(changeTypeColor)}>{summaryLabel}</DetailsSummary>

            <DetailsContent className="w-full overflow-scroll inset-shadow">
              <AugmentedDiffContent change={change} />
            </DetailsContent>
          </Details>
        );
      })}
    </div>
  );
}

export function ChangesPagination() {
  const [currentPage, setCurrentPage] = useAtom(pageAtom);
  const totalPages = useAtomValue(changesAtom)?.totalPages ?? 0;
  const [, startTransition] = useTransition();
  const goToNextPage = () => {
    startTransition(() => {
      if (currentPage < totalPages - 1) {
        setCurrentPage(currentPage + 1);
      }
    });
  };
  const goToPrevPage = () => {
    startTransition(() => {
      if (currentPage > 0) {
        setCurrentPage(currentPage - 1);
      }
    });
  };
  return (
    <div className="flex items-center justify-between">
      <Button variant="ghost" size="icon-sm" onClick={goToPrevPage} disabled={currentPage <= 0}>
        <ArrowLeft />
      </Button>
      <span className="text-muted-foreground">
        {(totalPages === 0 ? 0 : currentPage + 1).toLocaleString()} of {totalPages.toLocaleString()}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={goToNextPage}
        disabled={currentPage >= totalPages - 1}
      >
        <ArrowRight />
      </Button>
    </div>
  );
}

import {
  Button,
  Details,
  DetailsContent,
  DetailsSummary,
  ScrollArea,
  Table,
  TableBody,
  TableCell,
  TableRow,
} from "@osmix/ui";
import type { Osm } from "osmix";
import { getRelationKindMetadata } from "osmix";
import type { OsmEntity, OsmEntityType, OsmNode, OsmRelation, OsmWay } from "osmix";
import { isNode, isRelation, isWay } from "osmix";
import type { ReactNode } from "react";
import { Fragment } from "react/jsx-runtime";

/**
 * Value cells wrap instead of widening the table: a way's refs list or a long tag value would
 * otherwise scroll the panel sideways. `wrap-anywhere` lets an unbroken value break too.
 */
const VALUE_CELL = "whitespace-normal wrap-anywhere";

/**
 * The details of one entity: its coordinates or refs, its tags and, with `osm`, a disclosure
 * listing a way's nodes or a relation's members. With `onSelect`, each listed entity gets a
 * "Select {type} {id}" button that calls it. With `summary` (the default) everything sits
 * under a `Details` titled "{Type} {id}"; `summary={false}` renders the content directly, for
 * a panel whose header already names the entity.
 */
export default function EntityDetails({
  defaultOpen,
  entity,
  onSelect,
  osm,
  summary = true,
}: {
  defaultOpen?: boolean;
  entity: OsmEntity;
  onSelect?: (entity: OsmEntity) => void;
  osm?: Osm;
  summary?: boolean;
}) {
  if (isNode(entity)) {
    if (!summary) return <NodeContent node={entity} />;
    return <NodeDetails node={entity} defaultOpen={defaultOpen} />;
  }
  if (isWay(entity)) {
    const wayNodes = osm && (
      <Details defaultOpen={false}>
        <DetailsSummary>Way nodes ({entity.refs.length})</DetailsSummary>
        <DetailsContent>
          <NodeListTable
            nodes={entity.refs.map((ref) => osm.nodes.getById(ref)).filter((n) => n != null)}
            onSelect={onSelect}
          />
        </DetailsContent>
      </Details>
    );
    if (!summary)
      return (
        <>
          <WayContent way={entity} />
          {wayNodes}
        </>
      );
    return (
      <WayDetails way={entity} defaultOpen={defaultOpen}>
        {wayNodes}
      </WayDetails>
    );
  }
  if (isRelation(entity)) {
    const members = osm && (
      <Details defaultOpen={false}>
        <DetailsSummary>Relation members ({entity.members.length})</DetailsSummary>
        <DetailsContent>
          <RelationMemberListTable members={entity.members} osm={osm} onSelect={onSelect} />
        </DetailsContent>
      </Details>
    );
    if (!summary)
      return (
        <>
          <RelationContent relation={entity} />
          {members}
        </>
      );
    return (
      <RelationDetails relation={entity} defaultOpen={defaultOpen}>
        {members}
      </RelationDetails>
    );
  }
}

/** The content table for any entity, without a `Details` wrapper. */
export function EntityContent({ entity }: { entity: OsmEntity }) {
  if (isNode(entity)) return <NodeContent node={entity} />;
  if (isWay(entity)) return <WayContent way={entity} />;
  if (isRelation(entity)) return <RelationContent relation={entity} />;
}

export function NodeDetails({ node, defaultOpen }: { node: OsmNode; defaultOpen?: boolean }) {
  return (
    <Details defaultOpen={defaultOpen}>
      <DetailsSummary>Node {node.id}</DetailsSummary>
      <DetailsContent>
        <NodeContent node={node} />
      </DetailsContent>
    </Details>
  );
}

export function NodeContent({ node }: { node: OsmNode }) {
  return (
    <Table>
      <TableBody>
        <TableRow>
          <TableCell>lon</TableCell>
          <TableCell className={VALUE_CELL}>{node.lon}</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>lat</TableCell>
          <TableCell className={VALUE_CELL}>{node.lat}</TableCell>
        </TableRow>
        <TagList tags={node.tags} />
      </TableBody>
    </Table>
  );
}

export function WayContent({ way }: { way: OsmWay }) {
  return (
    <Table>
      <TableBody>
        <TableRow>
          <TableCell>refs</TableCell>
          <TableCell className={VALUE_CELL}>{way.refs.join(", ")}</TableCell>
        </TableRow>
        <TagList tags={way.tags} />
      </TableBody>
    </Table>
  );
}

export function WayDetails({
  way,
  children,
  defaultOpen,
}: {
  way: OsmWay;
  children?: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <Details defaultOpen={defaultOpen}>
      <DetailsSummary>Way {way.id}</DetailsSummary>
      <DetailsContent>
        <WayContent way={way} />
        {children}
      </DetailsContent>
    </Details>
  );
}

export function RelationContent({ relation }: { relation: OsmRelation }) {
  const kindMetadata = getRelationKindMetadata(relation);
  const relationMemberCount = relation.members.filter((m) => m.type === "relation").length;

  return (
    <Table>
      <TableBody>
        <TableRow>
          <TableCell>kind</TableCell>
          <TableCell className={VALUE_CELL}>{kindMetadata.kind}</TableCell>
        </TableRow>
        {kindMetadata.description && (
          <TableRow>
            <TableCell>description</TableCell>
            <TableCell className={VALUE_CELL}>{kindMetadata.description}</TableCell>
          </TableRow>
        )}
        {relationMemberCount > 0 && (
          <TableRow>
            <TableCell>nested relations</TableCell>
            <TableCell className={VALUE_CELL}>{relationMemberCount}</TableCell>
          </TableRow>
        )}
        <TagList tags={relation.tags} />
      </TableBody>
    </Table>
  );
}

export function RelationDetails({
  relation,
  children,
  defaultOpen,
}: {
  relation: OsmRelation;
  children?: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <Details defaultOpen={defaultOpen}>
      <DetailsSummary>Relation {relation.id}</DetailsSummary>
      <DetailsContent>
        <RelationContent relation={relation} />
        {children}
      </DetailsContent>
    </Details>
  );
}

export function TagList({ tags }: { tags?: Record<string, unknown> }) {
  const entries = Object.entries(tags || {});
  if (entries.length === 0) return null;
  return (
    <>
      {entries.map(([k, v]) => (
        <TableRow key={k}>
          <TableCell>{k}</TableCell>
          <TableCell className={VALUE_CELL}>{String(v)}</TableCell>
        </TableRow>
      ))}
    </>
  );
}

/**
 * The id of a listed way node or relation member as a link button that selects it. An explicit
 * control, so the row stays a plain row: its cells keep `select-all` for copying, and the
 * keyboard reaches the selection like any other button.
 */
function SelectEntityButton({
  type,
  id,
  onSelect,
}: {
  type: OsmEntityType;
  id: number;
  onSelect: () => void;
}) {
  return (
    <Button
      variant="link"
      size="xs"
      className="h-auto p-0"
      aria-label={`Select ${type} ${id}`}
      onClick={onSelect}
    >
      {id}
    </Button>
  );
}

export function NodeListDetails({
  nodes,
  onSelect,
}: {
  nodes: OsmNode[];
  onSelect?: (node: OsmNode) => void;
}) {
  return (
    <Details defaultOpen>
      <DetailsSummary>Nodes ({nodes.length})</DetailsSummary>
      <DetailsContent>
        <ScrollArea className="max-h-48">
          <NodeListTable nodes={nodes} onSelect={onSelect} />
        </ScrollArea>
      </DetailsContent>
    </Details>
  );
}

/** A way's nodes in order, with tags under each; `onSelect` adds a select button per row. */
export function NodeListTable({
  nodes,
  onSelect,
}: {
  nodes: OsmNode[];
  onSelect?: (node: OsmNode) => void;
}) {
  return (
    <Table className="table-auto">
      <TableBody>
        {nodes.map((node, i) => (
          <Fragment key={String(node.id)}>
            <TableRow>
              <TableCell>{i + 1}</TableCell>
              <TableCell>
                {onSelect ? (
                  <SelectEntityButton type="node" id={node.id} onSelect={() => onSelect(node)} />
                ) : (
                  node.id
                )}
              </TableCell>
              <TableCell>
                {node.lon}, {node.lat}
              </TableCell>
            </TableRow>
            {node.tags &&
              Object.entries(node.tags).map(([k, v]) => (
                <TableRow key={`${node.id}-${k}`}>
                  <TableCell />
                  <TableCell>{k}</TableCell>
                  <TableCell>{String(v)}</TableCell>
                </TableRow>
              ))}
          </Fragment>
        ))}
      </TableBody>
    </Table>
  );
}

function resolveMember(osm: Osm, member: OsmRelation["members"][number]): OsmEntity | null {
  if (member.type === "node") return osm.nodes.getById(member.ref);
  if (member.type === "way") return osm.ways.getById(member.ref);
  if (member.type === "relation") return osm.relations.getById(member.ref);
  return null;
}

/**
 * A relation's members in order, resolved against `osm`, with tags under each; `onSelect` adds
 * a select button to every member that resolves. A member missing from `osm` keeps a plain id.
 */
export function RelationMemberListTable({
  members,
  osm,
  onSelect,
}: {
  members: OsmRelation["members"];
  osm: Osm;
  onSelect?: (entity: OsmEntity) => void;
}) {
  return (
    <Table className="table-auto">
      <TableBody>
        {members.map((member, i) => {
          const entity = resolveMember(osm, member);
          return (
            <Fragment key={`${member.type}-${member.ref}-${member.role ?? ""}`}>
              <TableRow>
                <TableCell>{i + 1}</TableCell>
                <TableCell>{member.type}</TableCell>
                <TableCell>
                  {entity && onSelect ? (
                    <SelectEntityButton
                      type={member.type}
                      id={member.ref}
                      onSelect={() => onSelect(entity)}
                    />
                  ) : (
                    member.ref
                  )}
                </TableCell>
                <TableCell>{member.role || ""}</TableCell>
                {member.type === "node" && entity && (
                  <TableCell>
                    {(entity as OsmNode).lon}, {(entity as OsmNode).lat}
                  </TableCell>
                )}
                {member.type === "way" && entity && (
                  <TableCell>{(entity as OsmWay).refs.length} nodes</TableCell>
                )}
                {member.type === "relation" && entity && (
                  <TableCell>{(entity as OsmRelation).members.length} members</TableCell>
                )}
                {!entity && <TableCell className="text-muted-foreground">not found</TableCell>}
              </TableRow>
              {entity?.tags &&
                Object.entries(entity.tags).map(([k, v]) => (
                  <TableRow key={`${member.type}-${member.ref}-${k}`}>
                    <TableCell />
                    <TableCell />
                    <TableCell>{k}</TableCell>
                    <TableCell colSpan={2}>{String(v)}</TableCell>
                  </TableRow>
                ))}
            </Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
}

import type { Osm } from "osmix";
import { getRelationKindMetadata } from "osmix";
import type { OsmEntity, OsmNode, OsmRelation, OsmWay } from "osmix";
import { isNode, isRelation, isWay } from "osmix";
import type { ReactNode } from "react";
import { Fragment } from "react/jsx-runtime";

import { Details, DetailsContent, DetailsSummary } from "./details";
import { Table, TableBody, TableCell, TableRow } from "./ui/table";

const noop = (_: OsmEntity) => undefined;

export default function EntityDetails({
  defaultOpen,
  entity,
  onSelect = noop,
  osm,
}: {
  defaultOpen?: boolean;
  entity: OsmEntity;
  onSelect?: (entity: OsmEntity) => void;
  osm?: Osm;
}) {
  if (isNode(entity)) return <NodeDetails node={entity} defaultOpen={defaultOpen} />;
  if (isWay(entity))
    return (
      <WayDetails way={entity} defaultOpen={defaultOpen}>
        {osm && (
          <Details defaultOpen={false}>
            <DetailsSummary>Way nodes ({entity.refs.length})</DetailsSummary>
            <DetailsContent>
              <NodeListTable
                nodes={entity.refs.map((ref) => osm.nodes.getById(ref)).filter((n) => n != null)}
                onSelect={onSelect}
              />
            </DetailsContent>
          </Details>
        )}
      </WayDetails>
    );
  if (isRelation(entity))
    return (
      <RelationDetails relation={entity} defaultOpen={defaultOpen}>
        {osm && (
          <Details defaultOpen={false}>
            <DetailsSummary>Relation members ({entity.members.length})</DetailsSummary>
            <DetailsContent>
              <RelationMemberListTable members={entity.members} osm={osm} onSelect={onSelect} />
            </DetailsContent>
          </Details>
        )}
      </RelationDetails>
    );
}

export function EntityContent({ entity }: { entity: OsmEntity }) {
  if (isNode(entity)) return <NodeContent node={entity} />;
  if (isWay(entity)) return <WayContent way={entity} />;
  if (isRelation(entity)) return <RelationDetails relation={entity} />;
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
          <TableCell>{node.lon}</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>lat</TableCell>
          <TableCell>{node.lat}</TableCell>
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
          <TableCell>{way.refs.join(",")}</TableCell>
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
          <TableCell>{kindMetadata.kind}</TableCell>
        </TableRow>
        {kindMetadata.description && (
          <TableRow>
            <TableCell>description</TableCell>
            <TableCell>{kindMetadata.description}</TableCell>
          </TableRow>
        )}
        {relationMemberCount > 0 && (
          <TableRow>
            <TableCell>nested relations</TableCell>
            <TableCell>{relationMemberCount}</TableCell>
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
          <TableCell>{String(v)}</TableCell>
        </TableRow>
      ))}
    </>
  );
}

export function NodeListDetails({
  nodes,
  onSelect,
}: {
  nodes: OsmNode[];
  onSelect: (node: OsmNode) => void;
}) {
  return (
    <Details defaultOpen>
      <DetailsSummary>Nodes ({nodes.length})</DetailsSummary>
      <DetailsContent className="max-h-48 overflow-y-scroll">
        <NodeListTable nodes={nodes} onSelect={onSelect} />
      </DetailsContent>
    </Details>
  );
}

function NodeListTable({
  nodes,
  onSelect,
}: {
  nodes: OsmNode[];
  onSelect: (node: OsmNode) => void;
}) {
  return (
    <Table className="table-auto">
      <TableBody>
        {nodes.map((node, i) => (
          <Fragment key={String(node.id)}>
            <TableRow
              onClick={() => onSelect(node)}
              onKeyDown={() => onSelect(node)}
              className="cursor-pointer"
            >
              <TableCell>{i + 1}</TableCell>
              <TableCell>{node.id}</TableCell>
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

function RelationMemberListTable({
  members,
  osm,
  onSelect,
}: {
  members: OsmRelation["members"];
  osm: Osm;
  onSelect: (entity: OsmEntity) => void;
}) {
  return (
    <Table className="table-auto">
      <TableBody>
        {members.map((member, i) => {
          let entity: OsmEntity | null = null;
          if (member.type === "node") {
            entity = osm.nodes.getById(member.ref);
          } else if (member.type === "way") {
            entity = osm.ways.getById(member.ref);
          } else if (member.type === "relation") {
            entity = osm.relations.getById(member.ref);
          }

          return (
            <Fragment key={`${member.type}-${member.ref}-${member.role ?? ""}`}>
              <TableRow
                onClick={() => entity && onSelect(entity)}
                onKeyDown={() => entity && onSelect(entity)}
                className={entity ? "cursor-pointer" : ""}
              >
                <TableCell>{i + 1}</TableCell>
                <TableCell>{member.type}</TableCell>
                <TableCell>{member.ref}</TableCell>
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

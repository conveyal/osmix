import com.conveyal.r5.profile.StreetMode;
import com.conveyal.r5.streets.EdgeStore;
import com.conveyal.r5.streets.StreetRouter;
import com.conveyal.r5.streets.VertexStore;
import com.conveyal.r5.transit.TransportNetwork;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;

import java.io.BufferedWriter;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Local-only coordinate-linked R5 oracle, compiled against an adjacent R5 checkout. */
public final class R5RoutingOracle {
    private static final ObjectMapper JSON = new ObjectMapper();

    record WayTransition(long fromWayId, long toWayId) {}
    private record WayRun(long wayId, double distanceMeters) {}

    record RouteCase(
            String id, StreetMode mode,
            double fromLon, double fromLat, double toLon, double toLat,
            Long fromOsmNodeId, Long toOsmNodeId,
            Boolean expectedReachable,
            List<Long> forbiddenWayIds,
            List<WayTransition> forbiddenWayTransitions
    ) {}

    record VertexResolution(int index, String method, int coordinateMatches) {}

    record RouteEdge(
            long wayId, double fromLon, double fromLat, double toLon, double toLat,
            double distanceMeters
    ) {}

    record RouteResult(
            boolean originLinked, boolean destinationLinked, boolean reachable,
            double distanceMeters, int durationSeconds, List<RouteEdge> edges
    ) {}

    record Check(String kind, String status, String evidence) {}

    record AssertionResult(String status, List<Check> checks) {
        long count(String status) {
            return checks.stream().filter(check -> check.status.equals(status)).count();
        }
    }

    private R5RoutingOracle() {}

    public static void main(String[] args) throws Exception {
        if (args.length < 4 || args.length % 2 != 0) {
            throw new IllegalArgumentException(
                    "Usage: R5RoutingOracle <manifest.tsv> <output-directory> "
                            + "<dataset-id> <input.osm.pbf> [<dataset-id> <input.osm.pbf> ...]"
            );
        }
        Path outputDirectory = Path.of(args[1]);
        Files.createDirectories(outputDirectory);
        List<RouteCase> routeCases = readCases(Path.of(args[0]));
        long failed = 0;
        for (int argument = 2; argument < args.length; argument += 2) {
            failed += runDataset(args[argument], Path.of(args[argument + 1]).toAbsolutePath(),
                    routeCases, outputDirectory);
        }
        if (failed > 0) throw new IllegalStateException(failed + " R5 route assertions failed; see TSV evidence");
    }

    static List<RouteCase> readCases(Path manifest) throws IOException {
        List<String> lines = Files.readAllLines(manifest);
        if (lines.isEmpty()) throw new IllegalArgumentException("Empty routing manifest");
        Map<String, Integer> columns = new HashMap<>();
        String[] headers = lines.getFirst().split("\t", -1);
        for (int i = 0; i < headers.length; i++) columns.put(headers[i], i);
        List<RouteCase> cases = new ArrayList<>();
        for (int lineNumber = 1; lineNumber < lines.size(); lineNumber++) {
            String line = lines.get(lineNumber);
            if (line.isBlank()) continue;
            String[] cells = line.split("\t", -1);
            if (cells.length < 10) throw new IllegalArgumentException("Malformed manifest line " + (lineNumber + 1));
            String reachable = cell(cells, columns, "r5_expected_reachable");
            if (!reachable.isEmpty() && !reachable.equals("true") && !reachable.equals("false")) {
                throw new IllegalArgumentException("Invalid r5_expected_reachable: " + reachable);
            }
            List<Long> forbiddenWays = new ArrayList<>();
            for (JsonNode way : arrayCell(cells, columns, "r5_forbidden_way_ids")) {
                if (!way.isIntegralNumber()) throw new IllegalArgumentException("Invalid forbidden way ID: " + way);
                forbiddenWays.add(way.longValue());
            }
            List<WayTransition> forbiddenTransitions = new ArrayList<>();
            for (JsonNode transition : arrayCell(cells, columns, "r5_forbidden_way_transitions")) {
                if (!transition.path("fromWayId").isIntegralNumber() || !transition.path("toWayId").isIntegralNumber()) {
                    throw new IllegalArgumentException("Invalid forbidden way transition: " + transition);
                }
                forbiddenTransitions.add(new WayTransition(transition.get("fromWayId").longValue(),
                        transition.get("toWayId").longValue()));
            }
            cases.add(new RouteCase(
                    cell(cells, columns, "case_id"), StreetMode.valueOf(cell(cells, columns, "mode")),
                    coordinate(cell(cells, columns, "from_lon")), coordinate(cell(cells, columns, "from_lat")),
                    coordinate(cell(cells, columns, "to_lon")), coordinate(cell(cells, columns, "to_lat")),
                    requestedNode(cells, columns, "from"), requestedNode(cells, columns, "to"),
                    reachable.isEmpty() ? null : Boolean.valueOf(reachable), forbiddenWays, forbiddenTransitions
            ));
        }
        return cases;
    }

    private static String cell(String[] cells, Map<String, Integer> columns, String name) {
        Integer index = columns.get(name);
        return index == null || index >= cells.length ? "" : cells[index];
    }

    private static JsonNode arrayCell(String[] cells, Map<String, Integer> columns, String name) throws IOException {
        String value = cell(cells, columns, name);
        if (value.isEmpty()) return JSON.createArrayNode();
        JsonNode array = JSON.readTree(value);
        if (!array.isArray()) throw new IllegalArgumentException(name + " must be a JSON array");
        return array;
    }

    private static double coordinate(String value) {
        return value.isEmpty() ? Double.NaN : Double.parseDouble(value);
    }

    private static Long requestedNode(String[] cells, Map<String, Integer> columns, String prefix) {
        if (!cell(cells, columns, prefix + "_endpoint_kind").equals("osm-node")) return null;
        return Long.valueOf(cell(cells, columns, prefix + "_osm_node_id"));
    }

    private static long runDataset(String datasetId, Path pbf, List<RouteCase> routeCases, Path outputDirectory)
            throws Exception {
        TransportNetwork network = TransportNetwork.fromFiles(pbf.toString(), List.of());
        Path output = outputDirectory.resolve("r5-" + datasetId + ".tsv");
        long failed = 0;
        long passed = 0;
        long unavailable = 0;
        try (BufferedWriter writer = Files.newBufferedWriter(output)) {
            writer.write("case_id\tmode\torigin_vertex_resolution\tdestination_vertex_resolution"
                    + "\torigin_requested_osm_node_id\tdestination_requested_osm_node_id"
                    + "\torigin_osm_identity\tdestination_osm_identity"
                    + "\torigin_coordinate_vertex_matches\tdestination_coordinate_vertex_matches"
                    + "\tcoordinate_origin_linked\tcoordinate_destination_linked"
                    + "\tcoordinate_reachable\tcoordinate_distance_m\tcoordinate_duration_s"
                    + "\tcoordinate_vertex_reachable\tcoordinate_vertex_distance_m\tcoordinate_vertex_duration_s"
                    + "\tcoordinate_route_edges\tcoordinate_route_transitions"
                    + "\tcoordinate_vertex_route_edges\tassertion_basis\tassertion_status\tassertion_checks\n");
            for (RouteCase routeCase : routeCases) {
                VertexResolution origin = resolveVertex(network.streetLayer.vertexStore,
                        routeCase.fromLat, routeCase.fromLon, routeCase.fromOsmNodeId);
                VertexResolution destination = resolveVertex(network.streetLayer.vertexStore,
                        routeCase.toLat, routeCase.toLon, routeCase.toOsmNodeId);
                RouteResult coordinateResult = routeCoordinates(network, routeCase);
                RouteResult vertexResult = origin.index >= 0 && destination.index >= 0
                        ? routeVertices(network, routeCase.mode, origin.index, destination.index) : null;
                AssertionResult assertions = checkRoute(routeCase, coordinateResult);
                failed += assertions.count("failed");
                passed += assertions.count("passed");
                unavailable += assertions.count("unavailable");
                writer.write(String.join("\t", routeCase.id, routeCase.mode.name(), origin.method,
                        destination.method, requestedId(routeCase.fromOsmNodeId), requestedId(routeCase.toOsmNodeId),
                        identity(routeCase.fromOsmNodeId), identity(routeCase.toOsmNodeId),
                        matches(origin), matches(destination),
                        Boolean.toString(coordinateResult.originLinked), Boolean.toString(coordinateResult.destinationLinked),
                        Boolean.toString(coordinateResult.reachable), distance(coordinateResult), duration(coordinateResult),
                        vertexResult == null ? "" : Boolean.toString(vertexResult.reachable),
                        distance(vertexResult), duration(vertexResult), edgesJson(coordinateResult).toString(),
                        transitionsJson(coordinateResult).toString(), edgesJson(vertexResult).toString(),
                        "coordinate-linked-route", assertions.status, checksJson(assertions).toString()));
                writer.newLine();
            }
        }
        System.out.printf("Wrote %s: %d asserted checks passed, %d failed, %d unavailable%n", output, passed, failed, unavailable);
        return failed;
    }

    private static String requestedId(Long id) { return id == null ? "" : id.toString(); }
    private static String identity(Long id) { return id == null ? "not-requested" : "unverified"; }
    private static String matches(VertexResolution resolution) {
        return resolution.coordinateMatches < 0 ? "" : Integer.toString(resolution.coordinateMatches);
    }
    private static String distance(RouteResult result) {
        return result == null || !result.reachable ? "" : Double.toString(result.distanceMeters);
    }
    private static String duration(RouteResult result) {
        return result == null || !result.reachable ? "" : Integer.toString(result.durationSeconds);
    }

    private static RouteResult routeCoordinates(TransportNetwork network, RouteCase routeCase) {
        if (!validCoordinate(routeCase.fromLat, routeCase.fromLon)
                || !validCoordinate(routeCase.toLat, routeCase.toLon)) {
            return new RouteResult(false, false, false, Double.NaN, -1, List.of());
        }
        StreetRouter router = new StreetRouter(network.streetLayer);
        router.streetMode = routeCase.mode;
        boolean originLinked = router.setOrigin(routeCase.fromLat, routeCase.fromLon);
        boolean destinationLinked = router.setDestination(routeCase.toLat, routeCase.toLon);
        StreetRouter.State state = null;
        if (originLinked && destinationLinked) {
            router.route();
            state = router.getState(router.getDestinationSplit());
        }
        return result(network, originLinked, destinationLinked, state);
    }

    private static RouteResult routeVertices(TransportNetwork network, StreetMode mode, int origin, int destination) {
        StreetRouter router = new StreetRouter(network.streetLayer);
        router.streetMode = mode;
        router.setOrigin(origin);
        router.toVertex = destination;
        router.route();
        return result(network, true, true, router.getStateAtVertex(destination));
    }

    private static RouteResult result(TransportNetwork network, boolean originLinked, boolean destinationLinked,
                                      StreetRouter.State state) {
        List<RouteEdge> edges = new ArrayList<>();
        for (StreetRouter.State cursor = state; cursor != null; cursor = cursor.backState) {
            if (cursor.backEdge < 0) continue;
            EdgeStore.Edge edge = network.streetLayer.edgeStore.getCursor(cursor.backEdge);
            VertexStore.Vertex from = network.streetLayer.vertexStore.getCursor(edge.getFromVertex());
            VertexStore.Vertex to = network.streetLayer.vertexStore.getCursor(edge.getToVertex());
            double length = (cursor.distance - (cursor.backState == null ? 0 : cursor.backState.distance)) / 1_000d;
            edges.add(new RouteEdge(edge.getOSMID(), from.getLon(), from.getLat(), to.getLon(), to.getLat(), length));
        }
        Collections.reverse(edges);
        return new RouteResult(originLinked, destinationLinked, state != null,
                state == null ? Double.NaN : state.distance / 1_000d,
                state == null ? -1 : state.getDurationSeconds(), List.copyOf(edges));
    }

    static AssertionResult checkRoute(RouteCase routeCase, RouteResult result) {
        List<Check> checks = new ArrayList<>();
        boolean linked = result.originLinked && result.destinationLinked;
        if (routeCase.expectedReachable != null) {
            checks.add(new Check("reachability", !linked ? "unavailable"
                    : result.reachable == routeCase.expectedReachable ? "passed" : "failed",
                    "expected=" + routeCase.expectedReachable + ", observed=" + result.reachable));
        }
        for (long way : routeCase.forbiddenWayIds) {
            boolean present = result.edges.stream().anyMatch(edge -> edge.wayId == way && edge.distanceMeters > 0);
            checks.add(new Check("forbidden-way", !linked ? "unavailable" : !result.reachable ? "not-applicable"
                    : present ? "failed" : "passed", "positive-distance way=" + way));
        }
        List<WayTransition> transitions = transitions(result);
        for (WayTransition forbidden : routeCase.forbiddenWayTransitions) {
            checks.add(new Check("whole-way-pair-exclusion", !linked ? "unavailable"
                    : !result.reachable ? "not-applicable" : transitions.contains(forbidden) ? "failed" : "passed",
                    "positive-distance adjacent way runs " + forbidden.fromWayId + "->" + forbidden.toWayId));
        }
        String status = checks.isEmpty() ? "diagnostic-only"
                : checks.stream().anyMatch(check -> check.status.equals("failed")) ? "failed"
                : checks.stream().anyMatch(check -> check.status.equals("unavailable")) ? "unavailable"
                : checks.stream().anyMatch(check -> check.status.equals("passed")) ? "passed" : "not-applicable";
        return new AssertionResult(status, List.copyOf(checks));
    }

    private static List<WayTransition> transitions(RouteResult result) {
        List<WayRun> runs = new ArrayList<>();
        for (RouteEdge edge : result.edges) {
            if (!runs.isEmpty() && runs.getLast().wayId == edge.wayId) {
                WayRun previous = runs.removeLast();
                runs.add(new WayRun(edge.wayId, previous.distanceMeters + edge.distanceMeters));
            } else {
                runs.add(new WayRun(edge.wayId, edge.distanceMeters));
            }
        }
        List<WayTransition> transitions = new ArrayList<>();
        // Endpoint linking can add a zero-length backEdge. Do not treat touching that
        // edge as traversing its way. Retain intervening zero-length way runs so their
        // removal cannot invent an adjacency between two other OSM ways.
        for (int i = 1; i < runs.size(); i++) {
            WayRun from = runs.get(i - 1);
            WayRun to = runs.get(i);
            if (from.distanceMeters > 0 && to.distanceMeters > 0) {
                transitions.add(new WayTransition(from.wayId, to.wayId));
            }
        }
        return transitions;
    }

    private static ArrayNode edgesJson(RouteResult result) {
        ArrayNode output = JSON.createArrayNode();
        if (result != null) for (RouteEdge edge : result.edges) {
            var item = output.addObject();
            item.put("wayId", edge.wayId).put("distanceMeters", edge.distanceMeters);
            item.putArray("edgeFromCoordinates").add(edge.fromLon).add(edge.fromLat);
            item.putArray("edgeToCoordinates").add(edge.toLon).add(edge.toLat);
        }
        return output;
    }

    private static ArrayNode transitionsJson(RouteResult result) {
        ArrayNode output = JSON.createArrayNode();
        for (int i = 1; i < result.edges.size(); i++) {
            RouteEdge from = result.edges.get(i - 1);
            RouteEdge to = result.edges.get(i);
            if (from.wayId == to.wayId) continue;
            var item = output.addObject().put("fromWayId", from.wayId).put("toWayId", to.wayId);
            item.put("fromSegmentDistanceMeters", from.distanceMeters);
            item.put("toSegmentDistanceMeters", to.distanceMeters);
            item.putArray("viaCoordinates").add(from.toLon).add(from.toLat);
            item.put("osmNodeIdentity", "unverified");
        }
        return output;
    }

    private static ArrayNode checksJson(AssertionResult assertions) {
        ArrayNode output = JSON.createArrayNode();
        for (Check check : assertions.checks) {
            output.addObject().put("kind", check.kind).put("status", check.status).put("evidence", check.evidence);
        }
        return output;
    }

    /**
     * fromFiles drops R5's OSM-node index. Coordinates can locate vertices but cannot prove
     * which requested OSM identity survived; coincident features and shape nodes make that unsafe.
     */
    static VertexResolution resolveVertex(VertexStore vertices, double lat, double lon, Long requestedNodeId) {
        if (!validCoordinate(lat, lon)) return new VertexResolution(-1, "unresolved-coordinate", -1);
        if (requestedNodeId == null) return new VertexResolution(-1, "coordinate", -1);
        int fixedLat = VertexStore.floatingDegreesToFixed(lat);
        int fixedLon = VertexStore.floatingDegreesToFixed(lon);
        int match = -1;
        int matches = 0;
        for (int index = 0; index < vertices.getVertexCount(); index++) {
            if (vertices.fixedLats.get(index) == fixedLat && vertices.fixedLons.get(index) == fixedLon) {
                match = index;
                matches++;
            }
        }
        if (matches == 1) return new VertexResolution(match, "unique-coordinate-vertex", matches);
        return new VertexResolution(-1, matches == 0 ? "coordinate-fallback-no-vertex"
                : "coordinate-fallback-ambiguous-vertex", matches);
    }

    private static boolean validCoordinate(double lat, double lon) {
        return Double.isFinite(lat) && Double.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
    }
}

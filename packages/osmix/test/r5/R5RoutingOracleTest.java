import com.conveyal.r5.profile.StreetMode;
import com.conveyal.r5.streets.VertexStore;

import java.nio.file.Files;
import java.util.List;

/** Optional local regression runner; no JUnit or Osmix package/CI dependency is required. */
public final class R5RoutingOracleTest {
    private static int scenarios;

    public static void main(String[] args) throws Exception {
        test("unique coordinate does not prove either coincident requested identity", () -> {
            VertexStore vertices = new VertexStore(2);
            vertices.addVertex(1, 2);
            for (long requestedId : List.of(101L, 102L)) {
                var resolution = R5RoutingOracle.resolveVertex(vertices, 1, 2, requestedId);
                require(resolution.index() == 0, "Unique coordinate vertex should be usable");
                require(resolution.method().equals("unique-coordinate-vertex"), "Must not claim an exact OSM node");
                require(resolution.coordinateMatches() == 1, "Must report coordinate evidence count");
            }
        });
        test("coincident graph vertices remain ambiguous", () -> {
            VertexStore vertices = new VertexStore(2);
            vertices.addVertex(1, 2);
            vertices.addVertex(1, 2);
            var resolution = R5RoutingOracle.resolveVertex(vertices, 1, 2, 101L);
            require(resolution.index() == -1, "Must not choose one coincident vertex");
            require(resolution.method().equals("coordinate-fallback-ambiguous-vertex"), "Must expose ambiguity");
            require(resolution.coordinateMatches() == 2, "Must retain both matches");
        });
        test("missing graph vertex is explicit", () -> {
            var resolution = R5RoutingOracle.resolveVertex(new VertexStore(1), 1, 2, 101L);
            require(resolution.index() == -1 && resolution.method().equals("coordinate-fallback-no-vertex"),
                    "Missing vertex must not be guessed");
        });
        test("unresolved coordinates cannot resolve a vertex", () -> {
            var resolution = R5RoutingOracle.resolveVertex(new VertexStore(1), Double.NaN, 2, 101L);
            require(resolution.index() == -1 && resolution.method().equals("unresolved-coordinate"),
                    "Missing manifest coordinates must remain unresolved");
        });
        test("coordinate endpoints make no identity request", () -> {
            var resolution = R5RoutingOracle.resolveVertex(new VertexStore(1), 1, 2, null);
            require(resolution.method().equals("coordinate"), "Coordinate request must be labeled accurately");
        });
        test("manifest reads requested IDs and explicit assertions despite missing coordinates", () -> {
            var manifest = Files.createTempFile("osmix-r5-manifest-test-", ".tsv");
            try {
                Files.writeString(manifest, "case_id\tmode\tfrom_lon\tfrom_lat\tto_lon\tto_lat"
                        + "\tfrom_endpoint_kind\tfrom_osm_node_id\tto_endpoint_kind\tto_osm_node_id"
                        + "\tr5_expected_reachable\tr5_forbidden_way_ids\tr5_forbidden_way_transitions\n"
                        + "missing\tCAR\t\t\t2\t1\tosm-node\t101\tosm-node\t102\tfalse\t[10]"
                        + "\t[{\"fromWayId\":10,\"toWayId\":20}]\n");
                var route = R5RoutingOracle.readCases(manifest).getFirst();
                require(route.fromOsmNodeId() == 101L && route.toOsmNodeId() == 102L, "IDs must be consumed");
                require(Double.isNaN(route.fromLon()), "Missing coordinates must remain unresolved");
                require(Boolean.FALSE.equals(route.expectedReachable()), "Explicit reachability must be read");
                require(route.forbiddenWayIds().equals(List.of(10L)), "Forbidden ways must be read");
                require(route.forbiddenWayTransitions().equals(List.of(new R5RoutingOracle.WayTransition(10, 20))),
                        "Whole-way-pair exclusions must be read");
            } finally {
                Files.deleteIfExists(manifest);
            }
        });
        test("invalid reachability fails", () -> {
            var assertions = R5RoutingOracle.checkRoute(route(false, List.of(), List.of()), reachable(10, 20));
            require(assertions.status().equals("failed") && assertions.count("failed") == 1,
                    "An invalid reachable route must fail its declared check");
        });
        test("forbidden way in actual route fails", () -> {
            var assertions = R5RoutingOracle.checkRoute(route(null, List.of(20L), List.of()), reachable(10, 20));
            require(assertions.status().equals("failed") && assertions.count("failed") == 1,
                    "Forbidden-way assertion must reject traversed OSM way");
        });
        test("forbidden whole-way pair fails", () -> {
            var assertions = R5RoutingOracle.checkRoute(route(null, List.of(),
                    List.of(new R5RoutingOracle.WayTransition(10, 20))), reachable(10, 20));
            require(assertions.status().equals("failed") && assertions.count("failed") == 1,
                    "Prohibited transition must fail, without claiming via-node identity");
        });
        test("valid route passes only declared checks", () -> {
            var assertions = R5RoutingOracle.checkRoute(route(true, List.of(99L),
                    List.of(new R5RoutingOracle.WayTransition(20, 10))), reachable(10, 20));
            require(assertions.status().equals("passed") && assertions.count("passed") == 3,
                    "Reachability, way, and pair assertions must all be counted");
        });
        test("zero-distance origin and destination links do not imply forbidden traversal", () -> {
            var result = new R5RoutingOracle.RouteResult(true, true, true, 10, 5, List.of(
                    new R5RoutingOracle.RouteEdge(10, 0, 0, 1, 0, 0),
                    new R5RoutingOracle.RouteEdge(20, 1, 0, 2, 0, 10),
                    new R5RoutingOracle.RouteEdge(30, 2, 0, 3, 0, 0)));
            var assertions = R5RoutingOracle.checkRoute(route(null, List.of(10L, 30L), List.of(
                    new R5RoutingOracle.WayTransition(10, 20),
                    new R5RoutingOracle.WayTransition(20, 30))), result);
            require(assertions.count("passed") == 4 && assertions.count("failed") == 0,
                    "Touching a way at an endpoint must not count as traversing it");
        });
        test("zero-length segments within a traversed way do not conceal an illegal pair", () -> {
            var result = new R5RoutingOracle.RouteResult(true, true, true, 20, 5, List.of(
                    new R5RoutingOracle.RouteEdge(10, 0, 0, 1, 0, 10),
                    new R5RoutingOracle.RouteEdge(10, 1, 0, 1, 0, 0),
                    new R5RoutingOracle.RouteEdge(20, 1, 0, 2, 0, 10)));
            var assertions = R5RoutingOracle.checkRoute(route(null, List.of(),
                    List.of(new R5RoutingOracle.WayTransition(10, 20))), result);
            require(assertions.count("failed") == 1, "Same-way fragments must form one traversed way run");
        });
        test("intervening zero-length ways do not invent adjacency", () -> {
            var result = new R5RoutingOracle.RouteResult(true, true, true, 20, 5, List.of(
                    new R5RoutingOracle.RouteEdge(10, 0, 0, 1, 0, 10),
                    new R5RoutingOracle.RouteEdge(20, 1, 0, 1, 0, 0),
                    new R5RoutingOracle.RouteEdge(30, 1, 0, 2, 0, 10)));
            var assertions = R5RoutingOracle.checkRoute(route(null, List.of(),
                    List.of(new R5RoutingOracle.WayTransition(10, 30))), result);
            require(assertions.count("passed") == 1, "Removing an intermediate way must not fabricate a pair");
        });
        test("observation-only routes receive no passed legality credit", () -> {
            var assertions = R5RoutingOracle.checkRoute(route(null, List.of(), List.of()), reachable(10, 20));
            require(assertions.status().equals("diagnostic-only") && assertions.checks().isEmpty(),
                    "An observation is not a passed assertion");
        });
        test("unlinked endpoints are unavailable rather than proven unreachable", () -> {
            var assertions = R5RoutingOracle.checkRoute(route(false, List.of(10L), List.of()),
                    new R5RoutingOracle.RouteResult(false, true, false, Double.NaN, -1, List.of()));
            require(assertions.status().equals("unavailable") && assertions.count("passed") == 0,
                    "Failed linking cannot prove reachability or route legality");
        });
        test("unreachable route does not pretend to exercise a forbidden way", () -> {
            var assertions = R5RoutingOracle.checkRoute(route(false, List.of(10L), List.of()),
                    new R5RoutingOracle.RouteResult(true, true, false, Double.NaN, -1, List.of()));
            require(assertions.count("passed") == 1 && assertions.count("not-applicable") == 1,
                    "Only unreachable expectation was asserted; no actual route exercised way exclusion");
        });
        System.out.println("R5 oracle self-tests passed: " + scenarios + " scenarios");
    }

    private static R5RoutingOracle.RouteCase route(Boolean reachable, List<Long> forbidden,
                                                    List<R5RoutingOracle.WayTransition> transitions) {
        return new R5RoutingOracle.RouteCase("test", StreetMode.CAR, 0, 0, 1, 1,
                101L, 102L, reachable, forbidden, transitions);
    }

    private static R5RoutingOracle.RouteResult reachable(long first, long second) {
        return new R5RoutingOracle.RouteResult(true, true, true, 20, 5, List.of(
                new R5RoutingOracle.RouteEdge(first, 0, 0, 1, 0, 10),
                new R5RoutingOracle.RouteEdge(second, 1, 0, 1, 1, 10)));
    }

    private static void require(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }

    private static void test(String name, Scenario scenario) throws Exception {
        try {
            scenario.run();
            scenarios++;
        } catch (AssertionError failure) {
            throw new AssertionError(name + ": " + failure.getMessage(), failure);
        }
    }

    private interface Scenario { void run() throws Exception; }
}

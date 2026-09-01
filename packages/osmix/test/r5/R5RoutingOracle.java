import com.conveyal.r5.profile.StreetMode;
import com.conveyal.r5.streets.StreetRouter;
import com.conveyal.r5.streets.VertexStore;
import com.conveyal.r5.transit.TransportNetwork;

import java.io.BufferedWriter;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/**
 * Local-only point-to-point R5 oracle for Osmix's Monaco routing manifest.
 *
 * <p>This source is compiled against an adjacent R5 checkout by r5-oracle.init.gradle. It is not
 * part of either product's runtime or CI dependency graph.</p>
 */
public final class R5RoutingOracle {

    private record RouteCase(
            String id,
            StreetMode mode,
            double fromLon,
            double fromLat,
            double toLon,
            double toLat,
            boolean exactOrigin,
            boolean exactDestination
    ) {}

    private record VertexResolution(int index, String method) {}

    private record RouteResult(
            boolean originLinked,
            boolean destinationLinked,
            boolean reachable,
            double distanceMeters,
            int durationSeconds
    ) {}

    private R5RoutingOracle() {}

    public static void main(String[] args) throws Exception {
        if (args.length < 4 || args.length % 2 != 0) {
            throw new IllegalArgumentException(
                    "Usage: R5RoutingOracle <manifest.tsv> <output-directory> "
                            + "<dataset-id> <input.osm.pbf> [<dataset-id> <input.osm.pbf> ...]"
            );
        }

        Path manifest = Path.of(args[0]);
        Path outputDirectory = Path.of(args[1]);
        Files.createDirectories(outputDirectory);
        List<RouteCase> routeCases = readCases(manifest);

        for (int argument = 2; argument < args.length; argument += 2) {
            String datasetId = args[argument];
            Path pbf = Path.of(args[argument + 1]).toAbsolutePath();
            runDataset(datasetId, pbf, routeCases, outputDirectory);
        }
    }

    private static List<RouteCase> readCases(Path manifest) throws IOException {
        List<RouteCase> cases = new ArrayList<>();
        List<String> lines = Files.readAllLines(manifest);
        for (int lineNumber = 1; lineNumber < lines.size(); lineNumber += 1) {
            String line = lines.get(lineNumber);
            if (line.isBlank()) continue;
            String[] cells = line.split("\t", -1);
            if (cells.length < 10) {
                throw new IllegalArgumentException(
                        "Malformed routing manifest line " + (lineNumber + 1) + ": " + line
                );
            }
            cases.add(new RouteCase(
                    cells[0],
                    StreetMode.valueOf(cells[1]),
                    Double.parseDouble(cells[2]),
                    Double.parseDouble(cells[3]),
                    Double.parseDouble(cells[4]),
                    Double.parseDouble(cells[5]),
                    cells[6].equals("osm-node"),
                    cells[8].equals("osm-node")
            ));
        }
        return cases;
    }

    private static void runDataset(
            String datasetId,
            Path pbf,
            List<RouteCase> routeCases,
            Path outputDirectory
    ) throws Exception {
        TransportNetwork network = TransportNetwork.fromFiles(pbf.toString(), List.of());
        Path output = outputDirectory.resolve("r5-" + datasetId + ".tsv");
        try (BufferedWriter writer = Files.newBufferedWriter(output)) {
            writer.write("case_id\tmode\torigin_vertex_resolution\tdestination_vertex_resolution"
                    + "\tcoordinate_origin_linked\tcoordinate_destination_linked"
                    + "\tcoordinate_reachable\tcoordinate_distance_m\tcoordinate_duration_s"
                    + "\texact_vertex_reachable\texact_vertex_distance_m"
                    + "\texact_vertex_duration_s\n");
            for (RouteCase routeCase : routeCases) {
                VertexResolution origin = resolveVertex(
                        network,
                        routeCase.fromLat,
                        routeCase.fromLon,
                        routeCase.exactOrigin
                );
                VertexResolution destination = resolveVertex(
                        network,
                        routeCase.toLat,
                        routeCase.toLon,
                        routeCase.exactDestination
                );
                RouteResult coordinateResult = routeCoordinates(network, routeCase);
                RouteResult exactResult = origin.index >= 0 && destination.index >= 0
                        ? routeVertices(network, routeCase.mode, origin.index, destination.index)
                        : null;

                writer.write(String.join("\t",
                        routeCase.id,
                        routeCase.mode.name(),
                        origin.method,
                        destination.method,
                        Boolean.toString(coordinateResult.originLinked),
                        Boolean.toString(coordinateResult.destinationLinked),
                        Boolean.toString(coordinateResult.reachable),
                        coordinateResult.reachable
                                ? Double.toString(coordinateResult.distanceMeters)
                                : "",
                        coordinateResult.reachable
                                ? Integer.toString(coordinateResult.durationSeconds)
                                : "",
                        exactResult == null ? "" : Boolean.toString(exactResult.reachable),
                        exactResult == null || !exactResult.reachable
                                ? ""
                                : Double.toString(exactResult.distanceMeters),
                        exactResult == null || !exactResult.reachable
                                ? ""
                                : Integer.toString(exactResult.durationSeconds)
                ));
                writer.newLine();
            }
        }
        System.out.println("Wrote " + output);
    }

    private static RouteResult routeCoordinates(TransportNetwork network, RouteCase routeCase) {
        StreetRouter router = new StreetRouter(network.streetLayer);
        router.streetMode = routeCase.mode;
        boolean originLinked = router.setOrigin(routeCase.fromLat, routeCase.fromLon);
        boolean destinationLinked = router.setDestination(routeCase.toLat, routeCase.toLon);
        StreetRouter.State state = null;
        if (originLinked && destinationLinked) {
            router.route();
            state = router.getState(router.getDestinationSplit());
        }
        return result(originLinked, destinationLinked, state);
    }

    private static RouteResult routeVertices(
            TransportNetwork network,
            StreetMode mode,
            int originVertex,
            int destinationVertex
    ) {
        StreetRouter router = new StreetRouter(network.streetLayer);
        router.streetMode = mode;
        router.setOrigin(originVertex);
        router.toVertex = destinationVertex;
        router.route();
        return result(true, true, router.getStateAtVertex(destinationVertex));
    }

    private static RouteResult result(
            boolean originLinked,
            boolean destinationLinked,
            StreetRouter.State state
    ) {
        return new RouteResult(
                originLinked,
                destinationLinked,
                state != null,
                state == null ? Double.NaN : state.distance / 1_000d,
                state == null ? -1 : state.getDurationSeconds()
        );
    }

    /**
     * Resolve OSM-node cases to an exact R5 street vertex whenever R5 retained that node as a
     * topological vertex. Intermediate shape nodes fall back to normal coordinate-to-edge linking.
     */
    private static VertexResolution resolveVertex(
            TransportNetwork network,
            double lat,
            double lon,
            boolean exact
    ) {
        if (!exact) return new VertexResolution(-1, "coordinate");

        VertexStore vertices = network.streetLayer.vertexStore;
        int fixedLat = VertexStore.floatingDegreesToFixed(lat);
        int fixedLon = VertexStore.floatingDegreesToFixed(lon);
        int match = -1;
        int matches = 0;
        for (int index = 0; index < vertices.getVertexCount(); index += 1) {
            boolean sameCoordinate =
                    vertices.fixedLats.get(index) == fixedLat
                            && vertices.fixedLons.get(index) == fixedLon;
            if (sameCoordinate) {
                match = index;
                matches += 1;
            }
        }
        if (matches == 1) return new VertexResolution(match, "exact-osm-node");
        if (matches == 0) return new VertexResolution(-1, "coordinate-fallback-no-vertex");
        return new VertexResolution(-1, "coordinate-fallback-ambiguous-vertex");
    }
}

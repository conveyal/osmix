#!/bin/bash

# Download Monaco highway data from LayerCake (OSM US) using DuckDB
# Monaco bounding box coordinates from MapTiler:
# - xmin: 7.409205
# - xmax: 7.448637
# - ymin: 43.72335
# - ymax: 43.75169

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="$SCRIPT_DIR/../../../fixtures"
OUTPUT_FILE="$OUTPUT_DIR/monaco-highways.parquet"

echo "Downloading Monaco highway data from LayerCake..."
echo "Output: $OUTPUT_FILE"

duckdb <<EOF
INSTALL spatial;
LOAD spatial;

COPY (
    FROM 'https://data.openstreetmap.us/layercake/highways.parquet'
    SELECT
        id,
        tags,
        geometry
    WHERE
        bbox.xmin >= 7.409205 AND bbox.xmax <= 7.448637 AND
        bbox.ymin >= 43.72335 AND bbox.ymax <= 43.75169
) TO '$OUTPUT_FILE' WITH (FORMAT PARQUET);
EOF

if [ -f "$OUTPUT_FILE" ]; then
    echo "Successfully downloaded Monaco highways to $OUTPUT_FILE"
    echo "File size: $(ls -lh "$OUTPUT_FILE" | awk '{print $5}')"
else
    echo "Error: Failed to download file"
    exit 1
fi


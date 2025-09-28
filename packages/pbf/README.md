# @osmix/pbf

A low level [OpenStreetMap PBF](https://wiki.openstreetmap.org/wiki/PBF_Format) parser and writer. Written in TypeScript. 

## Background

When searching through the existing OSM PBF parsing libraries I found they used out of date dependencies, lacked useable types, or made parsing decisions which affected the resulting data.

`@osmix/pbf` is designed to be a core, shared library useable by higher level libraries, CLIs, and tools that can make decisions on how to decompress and store the resulting data. 

In common with existing parsers `@osmix/pbf` uses mapbox's [pbf](https://github.com/mapbox/pbf) library.

## Usage

### Simple Reader and Writer 

```ts
import {createOsmPbfReader} from "@osmix/pbf"

const fileStream = // ReadableStream or ArrayBuffer from an OSM PBF file.
const {header, blocks} = await createOsmPbfReader(fileStream)

console.log(header)
for await (const block of blocks) {
    console.log(block.stringtable)
    for (const group of block.primitivegroup) {
        console.log(group.nodes, group.dense, group.ways, group.relations)
    }
}
```

## Streaming

```ts
import {OsmPbfBytesToBlocksTransformStream} from "@osmix/pbf"

await fileStream
    .pipeThrough(new OsmPbfBytesToBlocksTransformStream())
    .pipeTo(
        new WritableStream({
            write: (block) => {
                if ("primitivegroup" in block) {
                    for (const group of block.primitivegroup) 
                        console.log(group)
                } else {
                    console.log(block) // header
                }
            },
        }),
    )
```

```ts
import {OsmBlocksToPbfBytesTransformStream} from "@osmix/pbf"
const blocksStream = // ReadableStream of OSM blocks starting with the header
await blocksStream
    .pipeThrough(new OsmBlocksToPbfBytesTransformStream())
    .pipeTo(fileWritableStream)
```

## API


# About

`reading-json-files` is a TypeScript console utility for reading Bible JSON data and generating Markdown output.

The repository intentionally keeps `README.md` as a generated artifact. Running the default Markdown generation command rewrites `README.md`, so this file documents the project purpose, architecture, and commands without being overwritten by normal generation flows.

## What It Does

The project supports two Bible storage formats:

- A full single-file `Version` JSON document.
- A static chunked format made of `manifest.json` plus one NDJSON file per book.

The Markdown generator can read either format, select books, chapters, or verse ranges, and render the selected content as Markdown.

## Main Commands

Generate Markdown:

```sh
./generate-markdown.sh GEN.1
./generate-markdown.sh "GEN 1:1-10" -o prueba.md
./generate-markdown.sh -f GEN.1 -f "JHN 3:16" -o prueba.md
```

Convert a full JSON Bible file to the chunked static format:

```sh
yarn chunk ./content/NVI_vid_128.json
yarn chunk ./content/NVI_vid_128.json --force
```

Run the HTTP byte-range E2E check:

```sh
yarn e2e:http-range
```

Run TypeScript checks:

```sh
yarn types
```

## Markdown Generation

The wrapper script is:

```sh
./generate-markdown.sh
```

Important options:

```text
-s, --source <path-or-url>     Full JSON, chunked manifest, chunked directory, or HTTP URL
-f, --filter <reference>       Selection filter; can be repeated
-o, --output <file>            Markdown output file
--chunk-size <bytes>           Byte-range size for chunked reads
--join-lines                   Join verse lines with spaces
```

Supported filters:

```text
GEN              full book
GEN.1            full chapter
GEN 1            full chapter
GEN 1:1          one verse
GEN 1:1-10       verse range
```

If no filter is provided, the script opens a simple interactive selector.

Default source:

```text
./content/NVI_vid_128_chunked
```

Default output:

```text
README.md
```

## Chunked Storage

The chunked format is static HTTP-compatible:

```text
content/
  NVI_vid_128_chunked/
    manifest.json
    books/
      GEN.ndjson
      EXO.ndjson
      ...
```

Each book file is NDJSON. Each line contains one chapter object compatible with the existing `Chapter` model. The `items` array preserves the existing `ChapterItem` shape.

`manifest.json` stores version metadata, book metadata, and byte offsets for every chapter. The reader can use those offsets to download a chapter in smaller byte ranges, such as 1024 bytes or 4096 bytes at a time.

## Source Layout

```text
src/
  index.ts                         Markdown generation CLI
  types.ts                         Domain and chunked manifest types
  sources/
    byte-range-reader.ts           Local and HTTP byte-range readers
    chapter-source.ts              Source detection and metadata loading
    chunked-source.ts              Chunked manifest and NDJSON chapter loader
    full-json-source.ts            Full JSON chapter loader
  tools/
    chunk-version.ts               Full JSON to chunked format converter
    e2e-http-range.ts              Local HTTP range E2E test
```

## Architecture Notes

The architecture decision is documented in:

```text
architecture/02_chunked_static_bible_storage.md
```

The chunked format keeps the storage layer compatible with static HTTP hosting. It does not require an API server, database, or dynamic endpoint.

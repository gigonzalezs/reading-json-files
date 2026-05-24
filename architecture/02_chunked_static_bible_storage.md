# ADR 002: Chunked Static Bible Storage with Per-Book NDJSON

## Status

Proposed

## Context

The current utility reads a complete Bible version from a single JSON document. This is simple for batch processing, but it couples every read operation to downloading and parsing the entire payload. For a full Bible version, this can mean transferring several megabytes even when the caller only needs one chapter.

The project should remain compatible with plain HTTP storage. It must not require an API server, database, dynamic endpoint, or application state outside static files. The existing `ChapterItem` model must remain the content unit used by the renderer:

```ts
export type ChapterItem = {
  type: ChapterItemType
  verse_numbers: number[]
  lines: string[]
  rlw_lines: RedLetterWordsSection[][]
}
```

The feature has two parts:

1. Add a TypeScript conversion tool that can download a single-version JSON file from the web, or read it from a local path, and convert it to a chunked static format. The output directory must use the same Bible version name with the suffix `_chunked`.
2. Improve `src/index.ts` so it can read both the current single JSON format and the new chunked format while preserving its current purpose: selecting configured chapters and rendering them to Markdown.

Even when chapter byte offsets are known, the reader must not assume that the complete chapter range should be loaded into memory in one operation. It must be able to fetch or read smaller byte ranges, for example 1024 bytes or 4 KiB at a time, until the target chapter line is complete.

## Decision

Store each converted Bible version as a static directory containing:

```text
content/
  <version-file-name>_chunked/
    manifest.json
    books/
      <BOOK_USFM>.ndjson
```

The `manifest.json` file stores version metadata, book metadata, and byte-range metadata for each chapter. Each book file is NDJSON. Each NDJSON line stores one chapter record. The chapter record preserves the existing chapter-level content model and keeps `ChapterItem` values unchanged.

The NDJSON file must avoid repeating metadata that can be inferred from the manifest or the file path. Its content payload should be minimal:

```json
{"chapter_usfm":"GEN.1","is_chapter":true,"previous":null,"current":{"usfm":"GEN.1","human":"Genesis 1"},"next":{"usfm":"GEN.2","human":"Genesis 2","canonical":true,"toc":true},"items":[]}
```

The exact chapter line is a serialized `Chapter`-compatible object. The `items` field remains an ordered array of `ChapterItem` objects. Offsets, byte lengths, version metadata, book names, and file names are not stored in NDJSON lines.

The manifest uses compact chapter range records:

```json
{
  "format": "book-ndjson-v1",
  "source": {
    "version_id": 128,
    "local_abbreviation": "NVI",
    "local_title": "Nueva Version Internacional - Espanol",
    "repository": "https://github.com/mrk214/bible-data-es-spa"
  },
  "language": {
    "iso_639_1": "es",
    "iso_639_3": "spa",
    "language_tag": "spa",
    "local_name": "Espanol (America Latina)",
    "text_direction": "ltr"
  },
  "publisher": {
    "name": "Biblica, Inc."
  },
  "copyright": {
    "html": "...",
    "text": "..."
  },
  "booksPath": "books",
  "books": [
    {
      "book_usfm": "GEN",
      "name": "Genesis",
      "file": "GEN.ndjson",
      "chapters": [
        { "chapter_usfm": "GEN.1", "o": 0, "l": 4212 },
        { "chapter_usfm": "GEN.2", "o": 4213, "l": 3890 }
      ]
    }
  ]
}
```

Where:

- `o` is the UTF-8 byte offset of the chapter line in the book NDJSON file.
- `l` is the UTF-8 byte length of the chapter line, including its trailing newline.
- `booksPath` is relative to the manifest location.
- `file` is relative to `booksPath`.

The converter must write each NDJSON line with a single trailing `\n`, calculate offsets from UTF-8 bytes, and write the manifest after all book files have been generated.

## Reader Behavior

The reader must support two source formats:

- `single-json`: current behavior, where the configured source points to a complete `Version` JSON document.
- `book-ndjson-v1`: new behavior, where the configured source points to a chunked directory or its `manifest.json`.

For `single-json`, the reader may keep the current full-document fetch and parse behavior.

For `book-ndjson-v1`, the reader loads `manifest.json`, resolves the requested `chapter_usfm`, then reads only the target byte range from the relevant book NDJSON file.

The chapter loader must support incremental byte reads within the known chapter range:

```text
target chapter: GEN.1
offset: 0
length: 4212
read size: 1024 bytes

GET bytes=0-1023
GET bytes=1024-2047
GET bytes=2048-3071
GET bytes=3072-4095
GET bytes=4096-4211
```

The same behavior should exist for local files by opening the book file and reading slices from the file descriptor.

The implementation should expose a shared abstraction similar to:

```ts
type ByteRangeReader = {
  readRange(source: string, start: number, endInclusive: number): Promise<Uint8Array>
}
```

HTTP and local filesystem implementations can then share the same higher-level parser:

```ts
async function readChapterLine(
  reader: ByteRangeReader,
  source: string,
  offset: number,
  length: number,
  chunkSize: number,
): Promise<string>
```

The parser appends decoded chunks until it has read `length` bytes. It then parses the resulting line as JSON and validates that the parsed chapter has the expected `chapter_usfm`.

The default read chunk size should be conservative, such as 4096 bytes, and configurable for tests or constrained environments.

## Conversion Tool

Add a TypeScript tool, separate from the Markdown renderer, with responsibilities:

1. Accept a source argument that can be either an HTTP URL or a local file path.
2. Fetch or read the full source JSON once.
3. Parse it as `Version`.
4. Create an output directory named from the source version file name plus `_chunked`.
5. Write one NDJSON file per book under `books/`.
6. Store one `Chapter`-compatible JSON object per line.
7. Preserve the existing `ChapterItem` objects exactly.
8. Calculate byte offsets and byte lengths while writing each line.
9. Write `manifest.json`.

For example:

```text
NVI_vid_128.json
NVI_vid_128_chunked/
  manifest.json
  books/
    GEN.ndjson
    EXO.ndjson
    ...
```

For URL sources, the output name should be derived from the URL path basename. For local file sources, it should be derived from the input file basename. The `.json` suffix should be removed before appending `_chunked`.

## Consequences

This keeps the storage layer static and deployable on any HTTP file host that supports ordinary file downloads. It reduces the amount of data required to render one chapter from the full Bible JSON to a small range inside one book file.

The manifest becomes the only file that must be loaded before navigation. It is small enough to cache aggressively and gives the application enough information to resolve books, chapters, and byte ranges.

The NDJSON files remain readable and stream-friendly. They also keep the content model close to the existing source JSON because each line is a chapter object with unchanged `ChapterItem` arrays.

There are operational constraints:

- HTTP byte ranges require server support for `Range` requests.
- Dynamic gzip or brotli compression can invalidate byte offsets. Book NDJSON files should be served without dynamic compression when range reads are used.
- The converter must produce deterministic UTF-8 output. Any change to serialization changes offsets and requires regenerating the manifest.
- The reader needs fallback/error handling for hosts that ignore `Range` and return `200 OK` with a full file instead of `206 Partial Content`.

## Alternatives Considered

### JSON file per chapter

This is the simplest static shape and works well with CDNs and compression. It was not selected because it creates many small files and does not preserve the requested NDJSON-per-book storage model.

### Single NDJSON file for the whole Bible

This minimizes file count but creates larger byte ranges and weaker locality. A per-book NDJSON file keeps the number of files moderate while limiting range reads to the current book.

### API server

An API server would simplify range and query behavior, but it is outside the feature constraint. The storage must stay compatible with static HTTP hosting.

### Store verse-level records in NDJSON

Verse-level records would allow smaller reads but would change the content unit and complicate rendering. The renderer currently depends on ordered `ChapterItem` values that mix headings, labels, verses, grouped verses, and red-letter sections. Chapter-level NDJSON preserves that model.

## Implementation Notes

The implementation should introduce explicit source detection instead of overloading the existing `bookUrl` behavior. A configured source can point to either:

- a `.json` file containing a full `Version`;
- a chunked `manifest.json`;
- a chunked directory, resolved internally to `manifest.json`.

The Markdown rendering logic should not know whether the chapter came from a full JSON document or from a book NDJSON range. It should receive a resolved `Version` summary and a `Chapter`.

Recommended internal split:

```text
src/
  index.ts
  types.ts
  sources/
    full-json-source.ts
    chunked-source.ts
    byte-range-reader.ts
  tools/
    chunk-version.ts
```

This separation keeps `src/index.ts` focused on selecting chapters and rendering Markdown, while source-specific loading logic lives behind a small chapter-loading interface.

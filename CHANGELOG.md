# Changelog

## Unreleased

### Added

- Added ADR 002 describing static chunked Bible storage with per-book NDJSON.
- Added a TypeScript conversion tool at `src/tools/chunk-version.ts`.
- Added `yarn chunk` to convert a full Bible `Version` JSON into:

  ```text
  <version>_chunked/
    manifest.json
    books/
      <BOOK_USFM>.ndjson
  ```

- Added chunked manifest types and `VersionSummary` / `ResolvedChapter` types.
- Added source loaders for both full JSON and chunked storage.
- Added local and HTTP byte-range readers.
- Added incremental byte-range reading with configurable chunk size.
- Added validation that a loaded chunked chapter matches the requested `chapter_usfm`.
- Added an HTTP range E2E script at `src/tools/e2e-http-range.ts`.
- Added `yarn e2e:http-range`.
- Added `generate-markdown.sh` as a documented shell wrapper for Markdown generation.
- Added Markdown output override via `-o` / `--output`.
- Added source override via `-s` / `--source`.
- Added chunk read size override via `--chunk-size`.
- Added line rendering mode override via `--join-lines`.
- Added CLI filters for Markdown generation:

  ```text
  GEN
  GEN.1
  GEN 1
  GEN 1:1
  GEN 1:1-10
  ```

- Added repeated filters with `-f` / `--filter`.
- Added positional filters after options.
- Added a simple interactive selector when no filter is provided.
- Added this `ABOUT.md` because `README.md` is treated as generated output.
- Added this `CHANGELOG.md`.

### Changed

- Changed `src/index.ts` so it no longer directly assumes every source is a full JSON file.
- Changed Markdown generation to resolve chapters through a source abstraction.
- Changed the default Markdown source to the local chunked NVI directory:

  ```text
  ./content/NVI_vid_128_chunked
  ```

- Changed chapter selection so it is no longer hardcoded to a fixed internal list for normal CLI use.
- Changed the shell wrapper help to document source, output, chunk size, line mode, and filter options.

### Verified

- Verified `yarn types`.
- Verified chunk generation from `content/NVI_vid_128.json`.
- Verified NVI chunk generation produced 66 books and 1189 chapters.
- Verified all NVI books were chunked completely.
- Verified `GEN.ndjson` offsets and byte lengths against the original JSON.
- Verified `GEN.24` loads identically from full JSON and chunked storage.
- Verified `GEN.24` can be loaded over local HTTP using byte-range requests.
- Verified HTTP range E2E with `GEN.24`, 1024-byte reads, and 14 `206 Partial Content` responses.
- Verified Markdown generation for:

  ```text
  GEN
  GEN.1
  GEN 1:1-10
  GEN.1 + JHN 3:16
  ```

### Notes

- `README.md` remains generated output and may be overwritten by the Markdown generator.
- Use `ABOUT.md` for stable project documentation.

import path from 'node:path'

import {
  getByteRangeReader,
  isHttpUrl,
  readIncrementalRange,
  readTextSource,
} from '@/sources/byte-range-reader'
import { Chapter, ChunkedManifest, ResolvedChapter } from '@/types'

const DEFAULT_CHUNK_SIZE = 4096

const getManifestSource = (source: string): string => {
  if (source.endsWith('manifest.json')) {
    return source
  }

  if (isHttpUrl(source)) {
    return new URL('manifest.json', source.endsWith('/') ? source : `${source}/`).toString()
  }

  return path.join(source, 'manifest.json')
}

const resolveRelativeSource = (baseSource: string, relativePath: string): string => {
  if (isHttpUrl(baseSource)) {
    return new URL(relativePath, baseSource).toString()
  }

  return path.join(path.dirname(baseSource), relativePath)
}

export const readChunkedManifest = async (source: string): Promise<ChunkedManifest> =>
  JSON.parse(await readTextSource(getManifestSource(source))) as ChunkedManifest

export const isChunkedManifest = (value: unknown): value is ChunkedManifest =>
  typeof value === 'object' &&
  value !== null &&
  'format' in value &&
  value.format === 'book-ndjson-v1'

export const loadChunkedChapter = async (
  source: string,
  chapterUsfm: string,
  chunkSize = DEFAULT_CHUNK_SIZE,
): Promise<ResolvedChapter> => {
  if (chunkSize < 1) {
    throw new Error(`Invalid chunk size '${chunkSize}'.`)
  }

  const manifestSource = getManifestSource(source)
  const manifest = JSON.parse(await readTextSource(manifestSource)) as ChunkedManifest
  const bookUsfm = chapterUsfm.split('.')[0]
  const book = manifest.books.find((b) => b.book_usfm === bookUsfm)

  if (!book) {
    throw new Error(`Book '${bookUsfm}' not found in '${manifestSource}'.`)
  }

  const chapterRange = book.chapters.find((c) => c.chapter_usfm === chapterUsfm)

  if (!chapterRange) {
    throw new Error(`Chapter '${chapterUsfm}' not found in '${book.book_usfm}'.`)
  }

  const bookSource = resolveRelativeSource(
    manifestSource,
    path.join(manifest.booksPath, book.file),
  )
  const bytes = await readIncrementalRange(
    getByteRangeReader(bookSource),
    bookSource,
    chapterRange.o,
    chapterRange.l,
    chunkSize,
  )
  const chapter = JSON.parse(Buffer.from(bytes).toString('utf8').trimEnd()) as Chapter

  if (chapter.chapter_usfm !== chapterUsfm) {
    throw new Error(
      `Chunked chapter mismatch: requested '${chapterUsfm}', read '${chapter.chapter_usfm}'.`,
    )
  }

  return {
    version: {
      version_id: manifest.source.version_id,
      local_abbreviation: manifest.source.local_abbreviation,
      local_title: manifest.source.local_title,
      language: manifest.language,
      repository: manifest.source.repository,
      publisher: manifest.publisher,
      copyright: manifest.copyright,
    },
    chapter,
  }
}

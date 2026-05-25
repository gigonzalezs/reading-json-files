import path from 'node:path'

import {
  getManifestSource,
  isChunkedManifest,
  loadChunkedChapter,
} from '@/sources/chunked-source'
import { isHttpUrl, readTextSource } from '@/sources/byte-range-reader'
import { resolveFullJsonChapter } from '@/sources/full-json-source'
import { Book, ChunkedManifest, ResolvedChapter, Version, VersionSummary } from '@/types'

type LoadChapterOptions = {
  chunkSize?: number
}

export type SourceBook = {
  book_usfm: string
  name: string
  chapters: string[]
}

export type SourceMetadata = {
  version: VersionSummary
  books: SourceBook[]
}

const sourceLooksLikeChunkedDirectory = (source: string): boolean => {
  if (source.endsWith('manifest.json')) {
    return true
  }

  if (isHttpUrl(source)) {
    return !new URL(source).pathname.endsWith('.json')
  }

  return path.extname(source) === ''
}

export const loadChapter = async (
  source: string,
  chapterUsfm: string,
  options: LoadChapterOptions = {},
): Promise<ResolvedChapter> => {
  if (sourceLooksLikeChunkedDirectory(source)) {
    return loadChunkedChapter(source, chapterUsfm, options.chunkSize)
  }

  const parsed = JSON.parse(await readTextSource(source)) as unknown

  if (isChunkedManifest(parsed)) {
    return loadChunkedChapter(source, chapterUsfm, options.chunkSize)
  }

  return resolveFullJsonChapter(parsed as Version, source, chapterUsfm)
}

const getFullJsonMetadata = (version: Version): SourceMetadata => ({
  version: {
    version_id: version.version_id,
    local_abbreviation: version.local_abbreviation,
    local_title: version.local_title,
    language: version.language,
    repository: version.repository,
    publisher: version.publisher,
    copyright: version.copyright,
  },
  books: version.books.map((book: Book) => ({
    book_usfm: book.book_usfm,
    name: book.name,
    chapters: book.chapters.map((chapter) => chapter.chapter_usfm),
  })),
})

const getChunkedMetadata = (manifest: ChunkedManifest): SourceMetadata => ({
  version: {
    version_id: manifest.source.version_id,
    local_abbreviation: manifest.source.local_abbreviation,
    local_title: manifest.source.local_title,
    language: manifest.language,
    repository: manifest.source.repository,
    publisher: manifest.publisher,
    copyright: manifest.copyright,
  },
  books: manifest.books.map((book) => ({
    book_usfm: book.book_usfm,
    name: book.name,
    chapters: book.chapters.map((chapter) => chapter.chapter_usfm),
  })),
})

export const loadSourceMetadata = async (source: string): Promise<SourceMetadata> => {
  if (sourceLooksLikeChunkedDirectory(source)) {
    const manifest = JSON.parse(
      await readTextSource(getManifestSource(source)),
    ) as ChunkedManifest
    return getChunkedMetadata(manifest)
  }

  const parsed = JSON.parse(await readTextSource(source)) as unknown

  if (isChunkedManifest(parsed)) {
    return getChunkedMetadata(parsed)
  }

  return getFullJsonMetadata(parsed as Version)
}

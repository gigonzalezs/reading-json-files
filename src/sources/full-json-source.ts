import { readTextSource } from '@/sources/byte-range-reader'
import { Chapter, ResolvedChapter, Version, VersionSummary } from '@/types'

export const getVersionSummary = (version: Version): VersionSummary => ({
  version_id: version.version_id,
  local_abbreviation: version.local_abbreviation,
  local_title: version.local_title,
  language: version.language,
  repository: version.repository,
  publisher: version.publisher,
  copyright: version.copyright,
})

export const loadFullJsonChapter = async (
  source: string,
  chapterUsfm: string,
): Promise<ResolvedChapter> => {
  const version = JSON.parse(await readTextSource(source)) as Version
  return resolveFullJsonChapter(version, source, chapterUsfm)
}

export const resolveFullJsonChapter = (
  version: Version,
  source: string,
  chapterUsfm: string,
): ResolvedChapter => {
  const bookUsfm = chapterUsfm.split('.')[0]
  const book = version.books.find((b) => b.book_usfm === bookUsfm)

  if (!book) {
    throw new Error(`Book '${bookUsfm}' not found in '${source}'.`)
  }

  const chapter: Chapter | undefined = book.chapters.find(
    (c) => c.chapter_usfm === chapterUsfm,
  )

  if (!chapter) {
    throw new Error(`Chapter '${chapterUsfm}' not found in '${book.book_usfm}'.`)
  }

  return {
    version: getVersionSummary(version),
    chapter,
  }
}

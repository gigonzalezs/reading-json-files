import path from 'node:path'

import { isChunkedManifest, loadChunkedChapter } from '@/sources/chunked-source'
import { isHttpUrl, readTextSource } from '@/sources/byte-range-reader'
import { resolveFullJsonChapter } from '@/sources/full-json-source'
import { ResolvedChapter, Version } from '@/types'

type LoadChapterOptions = {
  chunkSize?: number
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

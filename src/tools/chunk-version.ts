// Node.js >= v22.13.1

import fs from 'node:fs'
import path from 'node:path'

import { Book, Chapter, Copyright, Language, Publisher, Version } from '@/types'

type CliOptions = {
  source: string
  outputBaseDir?: string
  force: boolean
}

type ChunkedManifest = {
  format: 'book-ndjson-v1'
  source: {
    version_id: number
    local_abbreviation: string
    local_title: string
    repository: string
  }
  language: Language
  publisher: Publisher
  copyright: Copyright
  booksPath: 'books'
  books: ChunkedManifestBook[]
}

type ChunkedManifestBook = {
  book_usfm: string
  name: string
  file: string
  chapters: ChunkedManifestChapter[]
}

type ChunkedManifestChapter = {
  chapter_usfm: string
  o: number
  l: number
}

const CONTENT_DIR = path.join(process.cwd(), 'content')

const parseArgs = (argv: string[]): CliOptions => {
  const positional: string[] = []
  let force = false

  for (const arg of argv) {
    if (arg === '--force') {
      force = true
    } else {
      positional.push(arg)
    }
  }

  const [source, outputBaseDir] = positional

  if (!source) {
    throw new Error(
      [
        'Missing source.',
        'Usage: yarn chunk <source-url-or-file-path> [output-base-dir] [--force]',
        'Example: yarn chunk ./content/NVI_vid_128.json',
      ].join('\n'),
    )
  }

  return { source, outputBaseDir, force }
}

const isHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

const getSourceBaseName = (source: string): string => {
  const sourcePath = isHttpUrl(source) ? new URL(source).pathname : source
  const baseName = path.basename(sourcePath)

  if (!baseName) {
    throw new Error(`Cannot derive an output name from source '${source}'.`)
  }

  return baseName.endsWith('.json') ? baseName.slice(0, -'.json'.length) : baseName
}

const getDefaultOutputBaseDir = (source: string): string => {
  if (isHttpUrl(source)) {
    return CONTENT_DIR
  }

  const absoluteSourcePath = path.resolve(source)
  return path.dirname(absoluteSourcePath)
}

const readSourceJson = async (source: string): Promise<Version> => {
  if (isHttpUrl(source)) {
    const response = await fetch(source)

    if (!response.ok) {
      throw new Error(`Failed to fetch '${source}': ${response.status} ${response.statusText}`)
    }

    return (await response.json()) as Version
  }

  const file = await fs.promises.readFile(path.resolve(source), 'utf8')
  return JSON.parse(file) as Version
}

const assertOutputDirIsWritable = async (
  outputDir: string,
  force: boolean,
): Promise<void> => {
  try {
    const entries = await fs.promises.readdir(outputDir)

    if (entries.length === 0) {
      return
    }

    if (!force) {
      throw new Error(
        `Output directory '${outputDir}' already exists and is not empty. Re-run with --force to replace it.`,
      )
    }

    await fs.promises.rm(outputDir, { recursive: true, force: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return
    }

    throw error
  }
}

const createManifest = (version: Version): ChunkedManifest => ({
  format: 'book-ndjson-v1',
  source: {
    version_id: version.version_id,
    local_abbreviation: version.local_abbreviation,
    local_title: version.local_title,
    repository: version.repository,
  },
  language: version.language,
  publisher: version.publisher,
  copyright: version.copyright,
  booksPath: 'books',
  books: [],
})

const writeBookNdjson = async (
  booksDir: string,
  book: Book,
): Promise<ChunkedManifestBook> => {
  const file = `${book.book_usfm}.ndjson`
  const filePath = path.join(booksDir, file)
  const handle = await fs.promises.open(filePath, 'w')
  const chapters: ChunkedManifestChapter[] = []
  let offset = 0

  try {
    for (const chapter of book.chapters) {
      const line = `${JSON.stringify(toChunkedChapter(chapter))}\n`
      const byteLength = Buffer.byteLength(line, 'utf8')

      await handle.write(line, undefined, 'utf8')

      chapters.push({
        chapter_usfm: chapter.chapter_usfm,
        o: offset,
        l: byteLength,
      })

      offset += byteLength
    }
  } finally {
    await handle.close()
  }

  return {
    book_usfm: book.book_usfm,
    name: book.name,
    file,
    chapters,
  }
}

const toChunkedChapter = (chapter: Chapter): Chapter => ({
  chapter_usfm: chapter.chapter_usfm,
  is_chapter: chapter.is_chapter,
  previous: chapter.previous,
  current: chapter.current,
  next: chapter.next,
  ...(chapter.chapter_html === undefined ? {} : { chapter_html: chapter.chapter_html }),
  items: chapter.items,
})

const writeChunkedVersion = async (
  version: Version,
  outputDir: string,
): Promise<ChunkedManifest> => {
  const booksDir = path.join(outputDir, 'books')
  const manifest = createManifest(version)

  await fs.promises.mkdir(booksDir, { recursive: true })

  for (const book of version.books) {
    manifest.books.push(await writeBookNdjson(booksDir, book))
  }

  await fs.promises.writeFile(
    path.join(outputDir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  )

  return manifest
}

const main = async (): Promise<void> => {
  const options = parseArgs(process.argv.slice(2))
  const version = await readSourceJson(options.source)
  const outputBaseDir = path.resolve(
    options.outputBaseDir ?? getDefaultOutputBaseDir(options.source),
  )
  const outputDir = path.join(outputBaseDir, `${getSourceBaseName(options.source)}_chunked`)

  await assertOutputDirIsWritable(outputDir, options.force)
  const manifest = await writeChunkedVersion(version, outputDir)

  console.info(`Chunked version written to: ${outputDir}`)
  console.info(`Books: ${manifest.books.length}`)
  console.info(
    `Chapters: ${manifest.books.reduce((total, book) => total + book.chapters.length, 0)}`,
  )
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})

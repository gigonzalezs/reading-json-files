// Node.js >= v22.13.1
// Tested on Linux and macOS. Not tested on Windows.

import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline/promises'
import { isNonEmptyArray } from 'ramda-adjunct'

import {
  loadChapter,
  loadSourceMetadata,
  SourceBook,
  SourceMetadata,
} from '@/sources/chapter-source'
import { Chapter, ChapterItem } from '@/types'

const __dirname = path.dirname(new URL(import.meta.url).pathname)
const README_PATH = path.join(__dirname, '..', 'README.md')
const DEFAULT_CHUNK_SIZE = 4096
const DEFAULT_SOURCE = path.join(__dirname, '..', 'content', 'NVI_vid_128_chunked')

type CliOptions = {
  source: string
  output: string
  chunkSize: number
  filters: string[]
  separatedLines: boolean
}

type ParsedFilter = {
  bookUsfm: string
  chapter?: number
  verseStart?: number
  verseEnd?: number
}

type ChapterSelection = {
  chapterUsfm: string
  verseStart?: number
  verseEnd?: number
}

const writeFile = async (filePath: string, data: string) => {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
  await fs.promises.writeFile(filePath, data, 'utf8')
}

const readOptionValue = (
  argv: string[],
  index: number,
  option: string,
): string => {
  const value = argv[index + 1]

  if (!value || value.startsWith('-')) {
    throw new Error(`Missing value for ${option}.`)
  }

  return value
}

const parseArgs = (argv: string[]): CliOptions => {
  const positionalFilters: string[] = []
  const options: CliOptions = {
    source: DEFAULT_SOURCE,
    output: README_PATH,
    chunkSize: DEFAULT_CHUNK_SIZE,
    filters: [],
    separatedLines: true,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '-s' || arg === '--source') {
      options.source = readOptionValue(argv, index, arg)
      index += 1
    } else if (arg === '-f' || arg === '--filter') {
      options.filters.push(readOptionValue(argv, index, arg))
      index += 1
    } else if (arg === '-o' || arg === '--output') {
      options.output = path.resolve(readOptionValue(argv, index, arg))
      index += 1
    } else if (arg === '--join-lines') {
      options.separatedLines = false
    } else if (arg === '--chunk-size') {
      const chunkSize = Number(readOptionValue(argv, index, arg))

      if (!Number.isSafeInteger(chunkSize) || chunkSize < 1) {
        throw new Error(`Invalid --chunk-size value '${argv[index + 1]}'.`)
      }

      options.chunkSize = chunkSize
      index += 1
    } else {
      positionalFilters.push(arg)
    }
  }

  options.filters.push(...normalizePositionalFilters(positionalFilters))
  return options
}

const normalizePositionalFilters = (args: string[]): string[] => {
  const filters: string[] = []

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index]
    const next = args[index + 1]

    if (next && /^[1-9]\d*(?::[1-9]\d*(?:-[1-9]\d*)?)?$/.test(next)) {
      filters.push(`${current} ${next}`)
      index += 1
    } else {
      filters.push(current)
    }
  }

  return filters
}

const splitFilterValues = (filters: string[]): string[] =>
  filters.flatMap((filter) =>
    filter
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  )

const parseFilter = (filter: string): ParsedFilter => {
  const match =
    /^([1-3]?[A-Z]{2,3})(?:[ .](\d+)(?::(\d+)(?:-(\d+))?)?)?$/i.exec(
      filter.trim(),
    )

  if (!match) {
    throw new Error(
      `Invalid filter '${filter}'. Use examples like GEN, GEN.1, GEN 1, or GEN 1:1-10.`,
    )
  }

  const chapter = match[2] === undefined ? undefined : Number(match[2])
  const verseStart = match[3] === undefined ? undefined : Number(match[3])
  const verseEnd =
    verseStart === undefined
      ? undefined
      : match[4] === undefined
        ? verseStart
        : Number(match[4])

  if (
    chapter !== undefined &&
    (!Number.isSafeInteger(chapter) || chapter < 1)
  ) {
    throw new Error(`Invalid chapter in filter '${filter}'.`)
  }

  if (
    verseStart !== undefined &&
    (!Number.isSafeInteger(verseStart) ||
      verseEnd === undefined ||
      !Number.isSafeInteger(verseEnd) ||
      verseStart < 1 ||
      verseEnd < verseStart)
  ) {
    throw new Error(`Invalid verse range in filter '${filter}'.`)
  }

  return {
    bookUsfm: match[1].toUpperCase(),
    chapter,
    verseStart,
    verseEnd,
  }
}

const resolveSelections = (
  metadata: SourceMetadata,
  filters: string[],
): ChapterSelection[] => {
  const selections: ChapterSelection[] = []

  for (const filter of splitFilterValues(filters)) {
    const parsed = parseFilter(filter)
    const book = metadata.books.find((b) => b.book_usfm === parsed.bookUsfm)

    if (!book) {
      throw new Error(`Book '${parsed.bookUsfm}' not found in source.`)
    }

    if (parsed.chapter === undefined) {
      selections.push(
        ...book.chapters.map((chapterUsfm) => ({
          chapterUsfm,
        })),
      )
      continue
    }

    const chapterUsfm = `${parsed.bookUsfm}.${parsed.chapter}`

    if (!book.chapters.includes(chapterUsfm)) {
      throw new Error(`Chapter '${chapterUsfm}' not found in source.`)
    }

    selections.push({
      chapterUsfm,
      verseStart: parsed.verseStart,
      verseEnd: parsed.verseEnd,
    })
  }

  return selections
}

const askInteractiveFilters = async (
  metadata: SourceMetadata,
): Promise<string[]> => {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('No filters were provided and interactive input is not available.')
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  try {
    console.info(`Source: ${metadata.version.local_title}`)
    console.info('Books:')
    metadata.books.forEach((book, index) => {
      console.info(
        `${String(index + 1).padStart(2, ' ')}. ${book.book_usfm} - ${book.name}`,
      )
    })

    const selectedBooksAnswer = await rl.question(
      '\nSelect books by number or USFM, comma-separated: ',
    )
    const selectedBooks = resolveInteractiveBooks(metadata.books, selectedBooksAnswer)
    const filters: string[] = []

    for (const book of selectedBooks) {
      const answer = await rl.question(
        `${book.book_usfm}: press Enter for full book, or enter chapters/ranges like 1, 1:1-10, 2:3-5: `,
      )

      if (!answer.trim()) {
        filters.push(book.book_usfm)
      } else {
        filters.push(
          ...answer
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean)
            .map((value) => `${book.book_usfm} ${value}`),
        )
      }
    }

    return filters
  } finally {
    rl.close()
  }
}

const resolveInteractiveBooks = (
  books: SourceBook[],
  answer: string,
): SourceBook[] => {
  const selected = answer
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      const index = Number(value)

      if (Number.isSafeInteger(index)) {
        return books[index - 1]
      }

      return books.find((book) => book.book_usfm === value.toUpperCase())
    })

  if (selected.some((book) => book === undefined)) {
    throw new Error(`Invalid book selection '${answer}'.`)
  }

  if (selected.length === 0) {
    throw new Error('At least one book must be selected.')
  }

  return selected as SourceBook[]
}

const verseIntersectsRange = (
  verseNumbers: number[],
  verseStart: number,
  verseEnd: number,
): boolean =>
  verseNumbers.some((verseNumber) => verseNumber >= verseStart && verseNumber <= verseEnd)

const getItemsForSelection = (
  chapter: Chapter,
  selection: ChapterSelection,
): ChapterItem[] => {
  if (selection.verseStart === undefined || selection.verseEnd === undefined) {
    return chapter.items
  }

  return chapter.items.filter(
    (chapterItem) =>
      chapterItem.type === 'verse' &&
      verseIntersectsRange(
        chapterItem.verse_numbers,
        selection.verseStart as number,
        selection.verseEnd as number,
      ),
  )
}

const getSelectionLabel = (selection: ChapterSelection): string => {
  if (selection.verseStart === undefined || selection.verseEnd === undefined) {
    return selection.chapterUsfm
  }

  if (selection.verseStart === selection.verseEnd) {
    return `${selection.chapterUsfm}:${selection.verseStart}`
  }

  return `${selection.chapterUsfm}:${selection.verseStart}-${selection.verseEnd}`
}

const appendChapterMarkdown = (
  markdown: string,
  chapter: Chapter,
  selection: ChapterSelection,
  versionTitle: string,
  versionAbbreviation: string,
  separatedLines: boolean,
): string => {
  let nextMarkdown = markdown
  let lastVerseNumber = -1
  const selectedItems = getItemsForSelection(chapter, selection)

  nextMarkdown += '---\n\n'
  nextMarkdown += '> [!IMPORTANT]\n'
  nextMarkdown += '>\n'
  nextMarkdown += `> **${chapter.current.human} - (${getSelectionLabel(selection)})**\n`
  nextMarkdown += '>\n'
  nextMarkdown += `> **${versionTitle} - (${versionAbbreviation})**\n`
  nextMarkdown += '>\n'
  nextMarkdown += `> **Separated lines: ${separatedLines ? 'YES' : 'NO'}**\n`
  nextMarkdown += '\n'

  selectedItems.forEach((chapterItem) => {
    if (chapterItem.type === 'verse') {
      if (
        typeof chapterItem.verse_numbers[0] === 'number' &&
        chapterItem.verse_numbers[0] !== lastVerseNumber
      ) {
        if (chapterItem.verse_numbers.length > 1) {
          const firstVerse = chapterItem.verse_numbers[0]
          const lastVerse =
            chapterItem.verse_numbers[chapterItem.verse_numbers.length - 1]
          nextMarkdown += '`' + firstVerse + '-' + lastVerse + '` '
        } else {
          nextMarkdown += '`' + chapterItem.verse_numbers[0] + '` '
        }

        lastVerseNumber = chapterItem.verse_numbers[0]
      }

      const joinWith = separatedLines ? '\n\n' : ' '

      if (isNonEmptyArray(chapterItem.rlw_lines)) {
        const lines: string[] = chapterItem.rlw_lines.map((rlwLine) => {
          let line = ''

          rlwLine.forEach((rlwSection) => {
            if (rlwSection.rl) {
              line +=
                '<span style="color:red;">**`' +
                rlwSection.text +
                '`**</span> '
            } else {
              line += `${rlwSection.text} `
            }
          })

          return line.trim()
        })

        nextMarkdown += `${lines.join(joinWith)}\n\n`
      } else {
        nextMarkdown += `${chapterItem.lines.join(joinWith)}\n\n`
      }
    } else {
      if (chapterItem.type === 'section1') {
        nextMarkdown += `# ${chapterItem.lines[0]}\n\n`
      }
      if (chapterItem.type === 'section2') {
        nextMarkdown += `## ${chapterItem.lines[0]}\n\n`
      }
      if (chapterItem.type === 'heading1') {
        nextMarkdown += `### ${chapterItem.lines[0]}\n\n`
      }
      if (chapterItem.type === 'heading2') {
        nextMarkdown += `#### ${chapterItem.lines[0]}\n\n`
      }
      if (chapterItem.type === 'label') {
        nextMarkdown += `*${chapterItem.lines[0]}*\n\n`
      }
    }
  })

  return `${nextMarkdown}\n`
}

const main = async (): Promise<void> => {
  const options = parseArgs(process.argv.slice(2))
  const metadata = await loadSourceMetadata(options.source)
  const filters =
    options.filters.length > 0
      ? options.filters
      : await askInteractiveFilters(metadata)
  const selections = resolveSelections(metadata, filters)
  let markdown: string = ''

  markdown += '# This README was generated using code\n\n'
  markdown += `Source: ${metadata.version.local_title} - (${metadata.version.local_abbreviation})\n\n`
  markdown += `Filters: ${splitFilterValues(filters).join(', ')}\n\n`

  for (const selection of selections) {
    const { version, chapter } = await loadChapter(options.source, selection.chapterUsfm, {
      chunkSize: options.chunkSize,
    })

    markdown = appendChapterMarkdown(
      markdown,
      chapter,
      selection,
      version.local_title,
      version.local_abbreviation,
      options.separatedLines,
    )
  }

  await writeFile(options.output, markdown)
  console.info(`Done! Check the '${options.output}' file.`)
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})

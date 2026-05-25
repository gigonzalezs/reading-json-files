// Node.js >= v22.13.1

import fs from 'node:fs'
import http, { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'

import { loadChapter } from '@/sources/chapter-source'
import { ChunkedManifest, Version } from '@/types'

type RangeRequest = {
  path: string
  range: string
  status: number
}

type TestServer = {
  baseUrl: string
  rangeRequests: RangeRequest[]
  close(): Promise<void>
}

const CHUNKED_DIR = path.resolve('content/NVI_vid_128_chunked')
const ORIGINAL_JSON = path.resolve('content/NVI_vid_128.json')
const CHAPTER_USFM = 'GEN.24'
const CHUNK_SIZE = 1024

const getContentType = (filePath: string): string => {
  if (filePath.endsWith('.json')) {
    return 'application/json; charset=utf-8'
  }

  if (filePath.endsWith('.ndjson')) {
    return 'application/x-ndjson; charset=utf-8'
  }

  return 'application/octet-stream'
}

const resolveSafeFilePath = (rootDir: string, urlPath: string): string => {
  const normalizedPath = decodeURIComponent(urlPath.replace(/^\/+/, ''))
  const filePath = path.resolve(rootDir, normalizedPath)

  if (!filePath.startsWith(`${rootDir}${path.sep}`) && filePath !== rootDir) {
    throw new Error(`Rejected path outside server root: ${urlPath}`)
  }

  return filePath
}

const parseRange = (
  rangeHeader: string,
  fileSize: number,
): { start: number; end: number } => {
  const match = /^bytes=(\d+)-(\d+)$/.exec(rangeHeader)

  if (!match) {
    throw new Error(`Unsupported Range header '${rangeHeader}'.`)
  }

  const start = Number(match[1])
  const end = Number(match[2])

  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
    throw new Error(`Invalid Range header '${rangeHeader}'.`)
  }

  if (start < 0 || end < start || end >= fileSize) {
    throw new Error(`Unsatisfiable Range header '${rangeHeader}'.`)
  }

  return { start, end }
}

const sendError = (
  response: ServerResponse,
  status: number,
  message: string,
): void => {
  response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' })
  response.end(message)
}

const serveFile = async (
  rootDir: string,
  request: IncomingMessage,
  response: ServerResponse,
  rangeRequests: RangeRequest[],
): Promise<void> => {
  const requestUrl = new URL(request.url ?? '/', 'http://localhost')
  const filePath = resolveSafeFilePath(rootDir, requestUrl.pathname)
  const stat = await fs.promises.stat(filePath)

  if (!stat.isFile()) {
    sendError(response, 404, 'Not found')
    return
  }

  const rangeHeader = request.headers.range
  const baseHeaders = {
    'Accept-Ranges': 'bytes',
    'Content-Type': getContentType(filePath),
  }

  if (!rangeHeader) {
    response.writeHead(200, {
      ...baseHeaders,
      'Content-Length': stat.size,
    })
    fs.createReadStream(filePath).pipe(response)
    return
  }

  try {
    const { start, end } = parseRange(rangeHeader, stat.size)
    const contentLength = end - start + 1

    rangeRequests.push({
      path: requestUrl.pathname,
      range: rangeHeader,
      status: 206,
    })

    response.writeHead(206, {
      ...baseHeaders,
      'Content-Length': contentLength,
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
    })
    fs.createReadStream(filePath, { start, end }).pipe(response)
  } catch (error) {
    rangeRequests.push({
      path: requestUrl.pathname,
      range: rangeHeader,
      status: 416,
    })
    response.writeHead(416, {
      ...baseHeaders,
      'Content-Range': `bytes */${stat.size}`,
    })
    response.end(error instanceof Error ? error.message : 'Invalid range')
  }
}

const startServer = async (rootDir: string): Promise<TestServer> => {
  const rangeRequests: RangeRequest[] = []
  const server = http.createServer((request, response) => {
    serveFile(rootDir, request, response, rangeRequests).catch((error: unknown) => {
      sendError(response, 500, error instanceof Error ? error.message : String(error))
    })
  })

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })

  const address = server.address()

  if (address === null || typeof address === 'string') {
    throw new Error('Unexpected HTTP server address.')
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}/`,
    rangeRequests,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
          } else {
            resolve()
          }
        })
      }),
  }
}

const findOriginalChapter = (version: Version): unknown => {
  const bookUsfm = CHAPTER_USFM.split('.')[0]
  const book = version.books.find((b) => b.book_usfm === bookUsfm)
  const chapter = book?.chapters.find((c) => c.chapter_usfm === CHAPTER_USFM)

  if (!chapter) {
    throw new Error(`Original chapter '${CHAPTER_USFM}' not found.`)
  }

  return chapter
}

const main = async (): Promise<void> => {
  const manifest = JSON.parse(
    await fs.promises.readFile(path.join(CHUNKED_DIR, 'manifest.json'), 'utf8'),
  ) as ChunkedManifest
  const book = manifest.books.find((b) => b.book_usfm === 'GEN')
  const chapterRange = book?.chapters.find((c) => c.chapter_usfm === CHAPTER_USFM)

  if (!book || !chapterRange) {
    throw new Error(`Manifest chapter '${CHAPTER_USFM}' not found.`)
  }

  const expectedRangeRequests = Math.ceil(chapterRange.l / CHUNK_SIZE)
  const original = JSON.parse(await fs.promises.readFile(ORIGINAL_JSON, 'utf8')) as Version
  const originalChapter = findOriginalChapter(original)
  const server = await startServer(CHUNKED_DIR)

  try {
    const resolved = await loadChapter(server.baseUrl, CHAPTER_USFM, {
      chunkSize: CHUNK_SIZE,
    })
    const rangeRequestsForBook = server.rangeRequests.filter(
      (request) => request.path === `/books/${book.file}`,
    )

    if (JSON.stringify(resolved.chapter) !== JSON.stringify(originalChapter)) {
      throw new Error(`Loaded chapter '${CHAPTER_USFM}' does not match original JSON.`)
    }

    if (rangeRequestsForBook.length !== expectedRangeRequests) {
      throw new Error(
        `Expected ${expectedRangeRequests} byte-range requests for ${CHAPTER_USFM}, got ${rangeRequestsForBook.length}.`,
      )
    }

    if (rangeRequestsForBook.some((request) => request.status !== 206)) {
      throw new Error('At least one book byte-range request did not return HTTP 206.')
    }

    console.info('HTTP range E2E passed')
    console.info(`Server: ${server.baseUrl}`)
    console.info(`Chapter: ${CHAPTER_USFM}`)
    console.info(`Chapter bytes: ${chapterRange.l}`)
    console.info(`Read chunk size: ${CHUNK_SIZE}`)
    console.info(`HTTP byte-range requests: ${rangeRequestsForBook.length}`)
    console.info(`First range: ${rangeRequestsForBook[0]?.range}`)
    console.info(`Last range: ${rangeRequestsForBook.at(-1)?.range}`)
  } finally {
    await server.close()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})

import fs from 'node:fs'

export type ByteRangeReader = {
  readRange(
    source: string,
    start: number,
    endInclusive: number,
  ): Promise<Uint8Array>
}

export const isHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export const readTextSource = async (source: string): Promise<string> => {
  if (isHttpUrl(source)) {
    const response = await fetch(source)

    if (!response.ok) {
      throw new Error(`Failed to fetch '${source}': ${response.status} ${response.statusText}`)
    }

    return response.text()
  }

  return fs.promises.readFile(source, 'utf8')
}

export const httpByteRangeReader: ByteRangeReader = {
  async readRange(source, start, endInclusive) {
    const response = await fetch(source, {
      headers: {
        Range: `bytes=${start}-${endInclusive}`,
      },
    })

    if (response.status !== 206) {
      throw new Error(
        `Expected HTTP 206 Partial Content for '${source}', got ${response.status}. The host may not support byte-range reads.`,
      )
    }

    return new Uint8Array(await response.arrayBuffer())
  },
}

export const localByteRangeReader: ByteRangeReader = {
  async readRange(source, start, endInclusive) {
    const length = endInclusive - start + 1
    const handle = await fs.promises.open(source, 'r')
    const buffer = Buffer.alloc(length)

    try {
      const result = await handle.read(buffer, 0, length, start)

      if (result.bytesRead !== length) {
        throw new Error(
          `Short byte-range read for '${source}': expected ${length} bytes, read ${result.bytesRead}.`,
        )
      }

      return buffer
    } finally {
      await handle.close()
    }
  },
}

export const getByteRangeReader = (source: string): ByteRangeReader =>
  isHttpUrl(source) ? httpByteRangeReader : localByteRangeReader

export const readIncrementalRange = async (
  reader: ByteRangeReader,
  source: string,
  offset: number,
  length: number,
  chunkSize: number,
): Promise<Uint8Array> => {
  const chunks: Uint8Array[] = []
  const finalByte = offset + length - 1
  let cursor = offset

  while (cursor <= finalByte) {
    const endInclusive = Math.min(cursor + chunkSize - 1, finalByte)
    chunks.push(await reader.readRange(source, cursor, endInclusive))
    cursor = endInclusive + 1
  }

  return Buffer.concat(chunks)
}

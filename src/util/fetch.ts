import fs from 'fs'
import fsp from 'fs/promises'
import stream from 'stream'
import type streamWeb from 'node:stream/web'
import os from 'os'
import { join } from 'node:path'

/**
 * A non-spec-compliant, non-complete implementation of the Cache Web API for use in Spyglass.
 * This class stores the cached response on the file system under the cache root.
 */
class HttpCache implements Cache {
  readonly #cacheRoot: string | undefined

  constructor(cacheRoot: string | undefined) {
    if (cacheRoot) {
      this.#cacheRoot = `${cacheRoot}http/`
    }
  }

  async match(
    request: RequestInfo | URL,
    _options?: CacheQueryOptions | undefined,
  ): Promise<Response | undefined> {
    if (!this.#cacheRoot) {
      return undefined
    }

    const fileName = this.#getFileName(request)
    try {
      const etag = (await fsp.readFile(join(this.#cacheRoot, `${fileName}.etag`), 'utf8'))
        .trim()
      const binPath = join(this.#cacheRoot, `${fileName}.bin`)
      const bodyStream = fs.createReadStream(binPath)
      return new Response(
        stream.Readable.toWeb(bodyStream) as unknown as ReadableStream,
        //              \___/
        // stream Readable -> stream/web ReadableStream
        //                                \_______________/
        //                 stream/web ReadableStream -> DOM ReadableStream
        { headers: { etag } },
      )
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') {
        return undefined
      }

      throw e
    }
  }

  async put(request: RequestInfo | URL, response: Response): Promise<void> {
    const clonedResponse = response.clone()
    const etag = clonedResponse.headers.get('etag')
    if (!(this.#cacheRoot && clonedResponse.body && etag)) {
      return
    }

    const fileName = this.#getFileName(request)
    await fsp.mkdir(this.#cacheRoot, { recursive: true })
    await Promise.all([
      fsp.writeFile(
        join(this.#cacheRoot, `${fileName}.bin`),
        stream.Readable.fromWeb(clonedResponse.body as unknown as streamWeb.ReadableStream),
        //              \_____/                     \_________________________/
        //                 |             DOM ReadableStream -> stream/web ReadableStream
        // stream/web ReadableStream -> stream Readable
      ),
      fsp.writeFile(join(this.#cacheRoot, `${fileName}.etag`), `${etag}${os.EOL}`),
    ])
  }

  #getFileName(request: RequestInfo | URL) {
    const uriString = request instanceof Request ? request.url : request.toString()
    return Buffer.from(uriString, 'utf8').toString('base64url')
  }

  async add(): Promise<void> {
    throw new Error('Method not implemented.')
  }
  async addAll(): Promise<void> {
    throw new Error('Method not implemented.')
  }
  async delete(): Promise<boolean> {
    throw new Error('Method not implemented.')
  }
  async keys(): Promise<readonly Request[]> {
    throw new Error('Method not implemented.')
  }
  async matchAll(): Promise<readonly Response[]> {
    throw new Error('Method not implemented.')
  }
}

export const cache = new HttpCache('./cache')

let ghAvailability: boolean | undefined
async function isGhAvailable(): Promise<boolean> {
  if (ghAvailability !== undefined) {
    return ghAvailability
  }
  try {
    const { spawn } = await import('node:child_process')
    ghAvailability = await new Promise<boolean>((resolve) => {
      const proc = spawn('gh', ['--version'], { stdio: 'ignore' })
      proc.on('error', () => resolve(false))
      proc.on('exit', (code) => resolve(code === 0))
    })
  } catch {
    ghAvailability = false
  }
  return ghAvailability
}

async function fetchViaGh(request: Request, etag: string | undefined): Promise<Response | null> {
  const { spawn } = await import('node:child_process')
  const args = ['api', '-i', request.url]
  if (etag) {
    args.splice(2, 0, '-H', `If-None-Match: ${etag}`)
  }

  const { stdout, stderr, status } = await new Promise<{ stdout: string; stderr: string; status: number | null }>(
    (resolve, reject) => {
      const proc = spawn('gh', args)
      let out = '', err = ''
      proc.stdout.on('data', (chunk) => out += chunk)
      proc.stderr.on('data', (chunk) => err += chunk)
      proc.on('error', reject)
      proc.on('exit', (s) => resolve({ stdout: out, stderr: err, status: s }))
    },
  )

  // gh exits 1 with "gh: HTTP 304" on a 304
  if (status === 1 && /HTTP 304/.test(stderr)) {
    return null
  }

  if (status !== 0) {
    throw new Error(`gh api exited ${status}: ${stderr.trim()}`)
  }

  const lines = stdout.split(/\r?\n/)
  const statusLine = lines[0] ?? ''
  const statusMatch = statusLine.match(/^HTTP\/[\d.]+\s+(\d+)/)
  if (!statusMatch) {
    throw new Error(`gh: could not parse status line: ${JSON.stringify(statusLine)}`)
  }
  const responseStatus = parseInt(statusMatch[1]!, 10)

  if (responseStatus === 304) {
    return null
  }

  if (responseStatus !== 200) {
    throw new Error(`gh api: ${request.url} returned ${responseStatus}`)
  }

  const sepIdx = lines.indexOf('', 1)
  const headerLines = sepIdx === -1 ? lines.slice(1) : lines.slice(1, sepIdx)
  const body = sepIdx === -1 ? '' : lines.slice(sepIdx + 1).join('\n')

  const headers = new Headers()
  for (const line of headerLines) {
    const i = line.indexOf(':')
    if (i < 0) continue
    headers.set(line.slice(0, i).trim(), line.slice(i + 1).trim())
  }

  return new Response(body, { status: responseStatus, headers })
}

export async function fetchWithCache(
  input: RequestInfo | URL | Array<RequestInfo | URL>,
  init?: RequestInit,
): Promise<Response> {
  const inputs = Array.isArray(input) ? input : [input]
  if (inputs.length === 0) {
    throw new Error('fetchWithCache: no URLs provided')
  }

  for (let i = 0; i < inputs.length; i++) {
    const isLast = i === inputs.length - 1
    const target = inputs[i]!
    try {
      return await fetchOne(target, init)
    } catch (e) {
      if (isLast) {
        throw e
      }
      console.warn(`[fetchWithCache] ${target} failed, trying next`, e)
    }
  }
  // Unreachable: the last iteration either returns or re-throws.
  throw new Error('fetchWithCache: exhausted inputs without result')
}

async function fetchOne(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init)
  const cachedResponse = await cache.match(request)
  const cachedEtag = cachedResponse?.headers.get('ETag') ?? undefined

  const url = new URL(request.url)
  const useGh = url.hostname === 'raw.githubusercontent.com' && await isGhAvailable()

  if (useGh && cachedEtag) {
    request.headers.set('If-None-Match', cachedEtag)
  }

  if (useGh) {
    try {
      const response = await fetchViaGh(request, cachedEtag)
      if (response === null) {
        if (!cachedResponse) {
          throw new Error('gh returned 304 but no cached response available')
        }
        console.info(`[fetchWithCache] gh 304, reusing cache for ${request.url}`)
        return cachedResponse
      }
      try {
        await cache.put(request, response)
        console.info(`[fetchWithCache] updated cache for ${request.url}`)
      } catch (e) {
        console.warn('[fetchWithCache] put cache', e)
      }
      return response
    } catch (e) {
      console.warn('[fetchWithCache] gh path failed, falling back to fetch', e)
    }
  }

  if (cachedEtag) {
    request.headers.set('If-None-Match', cachedEtag)
  }
  let response: Response
  try {
    response = await fetch(request)
  } catch (e) {
    console.warn('[fetchWithCache] fetch', e)
    if (cachedResponse) {
      console.info(`[fetchWithCache] falling back to cache for ${request.url}`)
      return cachedResponse
    }
    throw e
  }
  if (response.status === 304) {
    console.info(`[fetchWithCache] reusing cache for ${request.url}`)
    return cachedResponse!
  }
  if (response.status !== 200) {
    throw new Error(`fetchWithCache: ${request.url} returned ${response.status}`)
  }
  try {
    await cache.put(request, response)
    console.info(`[fetchWithCache] updated cache for ${request.url}`)
  } catch (e) {
    console.warn('[fetchWithCache] put cache', e)
  }
  return response
}

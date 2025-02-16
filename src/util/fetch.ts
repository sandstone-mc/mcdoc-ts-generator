import { errorMessage } from '.'
import fs from 'fs'
import fsp from 'fs/promises'
import stream from 'stream'
import type streamWeb from 'node:stream/web'
import os from 'os'
import { join } from 'node:path'

const CACHE_NAME = 'misode-v2'
const CACHE_LATEST_VERSION = 'cached_latest_version'
const CACHE_PATCH = 'misode_cache_patch'


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
			const bodyStream = fs.createReadStream(join(this.#cacheRoot, `${fileName}.bin`))
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

export async function fetchWithCache(
	input: RequestInfo | URL,
	init?: RequestInit,
): Promise<Response> {
	const request = new Request(input, init)
	const cachedResponse = await cache.match(request)
	const cachedEtag = cachedResponse?.headers.get('ETag')
	if (cachedEtag) {
		request.headers.set('If-None-Match', cachedEtag)
	}
	try {
		const response = await fetch(request)
		if (response.status === 304) {
			console.info(`[fetchWithCache] reusing cache for ${request.url}`)
			return cachedResponse!
		} else {
			try {
				await cache.put(request, response)
				console.info(`[fetchWithCache] updated cache for ${request.url}`)
			} catch (e) {
				console.warn('[fetchWithCache] put cache', e)
			}
			return response
		}
	} catch (e) {
		console.warn('[fetchWithCache] fetch', e)
		if (cachedResponse) {
			console.info(`[fetchWithCache] falling back to cache for ${request.url}`)
			return cachedResponse
		}
		throw e
	}
}
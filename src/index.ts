import { dirname, join, resolve } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

import ts from 'typescript'
import {
    ConfigService,
    fileUtil,
    Service,
    VanillaConfig,
    MetaRegistry,
    type SymbolRegistrar,
    type ProjectInitializer,
    ResourcepackCategories,
    type ResourcepackCategory,
} from '@spyglassmc/core'
import { NodeJsExternals } from '@spyglassmc/core/lib/nodejs.js'
import * as je from '@spyglassmc/java-edition'
import { ReleaseVersion } from '@spyglassmc/java-edition/lib/dependency/index.js'
import * as mcdoc from '@spyglassmc/mcdoc'
import { errorMessage } from './util'
import { fetchWithCache } from './util/fetch'
import { TypesGenerator } from './typegen'

const cache_root = join(dirname(fileURLToPath(import.meta.url)), 'cache')

const project_path = resolve(process.cwd(), 'dummy')

// TODO: Actually export these
const module_files = new Map<string, ts.TypeAliasDeclaration[]>()

await fileUtil.ensureDir(NodeJsExternals, project_path)

function registerAttributes(meta: MetaRegistry, release: ReleaseVersion) {
	mcdoc.runtime.registerAttribute(meta, 'since', mcdoc.runtime.attribute.validator.string, {
		filterElement: (config, ctx) => {
			if (!config.startsWith('1.')) {
				ctx.logger.warn(`Invalid mcdoc attribute for "since": ${config}`)
				return true
			}
			return ReleaseVersion.cmp(release, config as ReleaseVersion) >= 0
		},
	})
	mcdoc.runtime.registerAttribute(meta, 'until', mcdoc.runtime.attribute.validator.string, {
		filterElement: (config, ctx) => {
			if (!config.startsWith('1.')) {
				ctx.logger.warn(`Invalid mcdoc attribute for "until": ${config}`)
				return true
			}
			return ReleaseVersion.cmp(release, config as ReleaseVersion) < 0
		},
	})
	mcdoc.runtime.registerAttribute(
		meta,
		'deprecated',
		mcdoc.runtime.attribute.validator.optional(mcdoc.runtime.attribute.validator.string),
		{
			mapField: (config, field, ctx) => {
				if (config === undefined) {
					return { ...field, deprecated: true }
				}
				if (!config.startsWith('1.')) {
					ctx.logger.warn(`Invalid mcdoc attribute for "deprecated": ${config}`)
					return field
				}
				if (ReleaseVersion.cmp(release, config as ReleaseVersion) >= 0) {
					return { ...field, deprecated: true }
				}
				return field
			},
		},
	)
}

const vanillaMcdocUrl = 'https://api.spyglassmc.com/vanilla-mcdoc/symbols'

export interface VanillaMcdocSymbols {
	ref: string,
	mcdoc: Record<string, unknown>,
	'mcdoc/dispatcher': Record<string, Record<string, unknown>>,
}
export async function fetchVanillaMcdoc(): Promise<VanillaMcdocSymbols> {
	try {
		return await (await fetchWithCache(vanillaMcdocUrl)).json() as VanillaMcdocSymbols
	} catch (e) {
		throw new Error(`Error occurred while fetching vanilla-mcdoc: ${errorMessage(e)}`)
	}
}

export async function fetchRegistries(versionId: string) {
	console.debug(`[fetchRegistries] ${versionId}`)

    let etag = ''

	try {
        const req = await fetchWithCache(`https://api.spyglassmc.com/mcje/versions/${versionId}/registries`)

        etag = req.headers.get('ETag')!

		const data = await req.json() as VanillaMcdocSymbols

		const result = new Map<string, string[]>()
		for (const id in data) {
            /* @ts-ignore */
			result.set(id, data[id].map((e: string) => 'minecraft:' + e))
		}
		return [result, etag] as const
	} catch (e) {
		throw new Error(`Error occurred while fetching registries: ${errorMessage(e)}`)
	}
}

export type BlockStateData = [Record<string, string[]>, Record<string, string>]

export async function fetchBlockStates(versionId: string) {
	console.debug(`[fetchBlockStates] ${versionId}`)
	const result = new Map<string, BlockStateData>()
    let etag = ''
	try {
        const req = await fetchWithCache(`https://api.spyglassmc.com/mcje/versions/${versionId}/block_states`)

        etag = req.headers.get('ETag')!

		const data = await req.json() as Record<string, BlockStateData>
		for (const id in data) {
			result.set(id, data[id])
		}
	} catch (e) {
		console.warn('Error occurred while fetching block states:', errorMessage(e))
	}
	return [result, etag] as const
}

const VanillaMcdocUri = 'mcdoc://vanilla-mcdoc/symbols.json'

function vanillaMcdocRegistrar(vanillaMcdoc: VanillaMcdocSymbols): SymbolRegistrar {
	return (symbols) => {
		const start = performance.now()
		for (const [id, typeDef] of Object.entries(vanillaMcdoc.mcdoc)) {
			symbols.query(VanillaMcdocUri, 'mcdoc', id).enter({
				data: { data: { typeDef } },
				usage: { type: 'declaration' },
			})
		}
		for (const [dispatcher, ids] of Object.entries(vanillaMcdoc['mcdoc/dispatcher'])) {
			symbols.query(VanillaMcdocUri, 'mcdoc/dispatcher', dispatcher)
				.enter({ usage: { type: 'declaration' } })
				.onEach(Object.entries(ids), ([id, typeDef], query) => {
					query.member(id, (memberQuery) => {
						memberQuery.enter({
							data: { data: { typeDef } },
							usage: { type: 'declaration' },
						})
					})
				})
		}
		const duration = performance.now() - start
		console.log(`[vanillaMcdocRegistrar] Done in ${duration}ms`)
	}
}

const initialize: ProjectInitializer = async (ctx) => {
	const { config, logger, meta, externals, cacheRoot } = ctx

	const vanillaMcdoc = await fetchVanillaMcdoc()
	meta.registerSymbolRegistrar('vanilla-mcdoc', {
		checksum: vanillaMcdoc.ref,
		registrar: vanillaMcdocRegistrar(vanillaMcdoc),
	})

	meta.registerUriBinder(je.binder.uriBinder)

	const version = await (await fetch('https://github.com/misode/mcmeta/blob/1b221f1ccc1c12b6f995496eab448ba56d397f0d/version.json?raw=true')).json()
    const release = version.id

    const [registries, registriesETag] = await fetchRegistries(version.id)
    const [blockStates, blockStatesETag] = await fetchBlockStates(version.id)

	const summary: je.dependency.McmetaSummary = {
		registries: Object.fromEntries(registries.entries()),
		blocks: Object.fromEntries([...blockStates.entries()]
			.map(([id, data]) => [id, data])),
		fluids: je.dependency.Fluids,
		commands: { type: 'root', children: {} },
	}

	const versionETag = registriesETag + blockStatesETag

	meta.registerSymbolRegistrar('mcmeta-summary', {
		checksum: versionETag,
		registrar: je.dependency.symbolRegistrar(summary, release),
	})

	registerAttributes(meta, release)

	return { loadedVersion: release }
}

const service = new Service({
    logger: {
        log: (...log_args: any[]) => console.log(...log_args),

        warn: (...log_args: any[]) => console.warn(...log_args),

        error: (...log_args: any[]) => console.error(...log_args),

        info: (...log_args: any[]) => console.info(...log_args),
    },
    project: {
        cacheRoot: fileUtil.ensureEndingSlash(
            pathToFileURL(cache_root).toString(),
        ),
        defaultConfig: ConfigService.merge(VanillaConfig, {
            env: { dependencies: [] },
        }),
        externals: NodeJsExternals,
        initializers: [mcdoc.initialize, initialize],
        projectRoots: [fileUtil.ensureEndingSlash(
            pathToFileURL(project_path).toString(),
        )],
    },
})

await service.project.ready()
await service.project.cacheService.save()

const generated_path = 'types'

function camel_case(name: string) {
    const words = name.split('_')
    if (words.length === 1) return name
    return words[0] + words
        .slice(1)
        .map((word) => word[0].toUpperCase() + word.slice(1))
        .join('')
}

const symbols = service.project.symbols.getVisibleSymbols('mcdoc')

const dispatchers = service.project.symbols.getVisibleSymbols('mcdoc/dispatcher')

const resources = dispatchers['minecraft:resource']!.members!

const TypeGen = new TypesGenerator(service, symbols, dispatchers, module_files, generated_path)

for await (const [resource_type, resource] of Object.entries(resources)) {
    const pack_type = ResourcepackCategories.includes(resource_type as ResourcepackCategory) ? 'resourcepack' : 'datapack'

    const type_path = join(generated_path, pack_type, `${camel_case(resource_type)}.ts`)

    const typeDef = (resource.data! as any).typeDef as mcdoc.McdocType

    let file = `export const original = ${JSON.stringify(typeDef, null, 4)}\n\n`

    const resolved_resource_types = TypeGen.resolveRootTypes(resource_type.replaceAll('/', '_'), typeDef)

    file += compileTypes(resolved_resource_types)

    await Bun.write(type_path, file)
}

function compileTypes(nodes: any[]) {
    const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed, omitTrailingSemicolon: true });
    const resultFile = ts.createSourceFile(
      "code.ts",
      "",
      ts.ScriptTarget.Latest,
      false,
      ts.ScriptKind.TS
    );

    return printer.printList(ts.ListFormat.MultiLine, nodes as unknown as ts.NodeArray<ts.Node>, resultFile)
}

await Bun.write(join(generated_path, 'tsconfig.json'), JSON.stringify({
    "compilerOptions": {
        baseUrl: "./",
        rootDir: "./"
    }
}))

service.project.close()
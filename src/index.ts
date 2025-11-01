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
    AllCategories,
} from '@spyglassmc/core'
import { NodeJsExternals } from '@spyglassmc/core/lib/nodejs.js'
import * as je from '@spyglassmc/java-edition'
import { ReleaseVersion } from '@spyglassmc/java-edition/lib/dependency/index.js'
import * as mcdoc from '@spyglassmc/mcdoc'
import { errorMessage } from './util'
import { fetchWithCache } from './util/fetch'
import { TypesGenerator } from './typegen'

function last<T extends any[]>(list: T) {
    return list[list.length - 1]
}

const cache_root = join(dirname(fileURLToPath(import.meta.url)), 'cache')

const project_path = resolve(process.cwd(), 'dummy')

// TODO: Actually export these
const module_files = new Map<string, ts.TypeAliasDeclaration[]>()

// haha funny Bun
/* @ts-ignore */
await fileUtil.ensureDir(NodeJsExternals, project_path)

function registerAttributes(meta: MetaRegistry, release: ReleaseVersion) {
    // We always generate for the latest version
	mcdoc.runtime.registerAttribute(meta, 'since', mcdoc.runtime.attribute.validator.string, {
		filterElement: () => false,
	})
	mcdoc.runtime.registerAttribute(meta, 'until', mcdoc.runtime.attribute.validator.string, {
		filterElement: () => true,
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

	const version = await (await fetch('https://github.com/misode/mcmeta/blob/summary/version.json?raw=true')).json()
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
        // haha funny Bun
        /* @ts-ignore */
        externals: NodeJsExternals,
        initializers: [mcdoc.initialize, initialize],
        projectRoots: [fileUtil.ensureEndingSlash(
            pathToFileURL(project_path).toString(),
        )],
    },
})

await service.project.ready()
await service.project.cacheService.save()

const parent_dir = 'types'

const generated_path = `${parent_dir}/resources`

function camel_case(name: string) {
    const words = name.split('_')
    if (words.length === 1) return name
    return words[0] + words
        .slice(1)
        .map((word) => word[0].toUpperCase() + word.slice(1))
        .join('')
}
function pascal_case(name: string) {
    const words = name.split('_')
    if (words.length === 1) return name
    return words
        .map((word) => word[0].toUpperCase() + word.slice(1))
        .join('')
}

function pluralize(name: string) {
    if (name.endsWith('y')) return name.slice(0, -1) + 'ies'
    if (name.endsWith('s') || name.endsWith('ch') || name.endsWith('sh') || name.endsWith('x') || name.endsWith('z')) return name + 'es'
    return name + 's'
}

const type_names: Record<string, string> = {}

let type_exports = ''

for await (const registry_name of AllCategories) {
    if (registry_name === 'mcdoc' || registry_name === 'mcdoc/dispatcher') continue

    const registry = Object.keys(service.project.symbols.getVisibleSymbols(registry_name))

    if (registry.length === 0) continue

    const type_name = pluralize(registry_name.split('/').join('_')).toUpperCase()

    type_names[registry_name] = type_name

    const type_path = `${parent_dir}/registries/${registry_name}.ts`

    type_exports += `export type * from './${registry_name}.ts'\n`

    await Bun.write(
        type_path,

        `/* eslint-disable */\n` +
        `/* Auto-generated */\n` +
        `export type ${type_name} = (\n` +
        `  '${registry.join('\' |\n  \'')}'\n` +
        `)`
    )
}

await Bun.write(join(parent_dir, 'registries', 'index.ts'), type_exports)



const symbols = service.project.symbols.getVisibleSymbols('mcdoc')

const dispatchers = service.project.symbols.getVisibleSymbols('mcdoc/dispatcher')

const resources = dispatchers['minecraft:resource']!.members!

const TypeGen = new TypesGenerator(service, symbols, dispatchers, module_files, generated_path)

type ResourceContent = {
    file_path: string
    types: (ts.TypeAliasDeclaration | ts.ImportDeclaration | ts.EnumDeclaration)[]
}

const resource_contents: Map<string, ResourceContent> = new Map()

const sub_resources: [type: 'resourcepack' | 'datapack', parent: string, resource: string, types: (ts.TypeAliasDeclaration | ts.ImportDeclaration | ts.EnumDeclaration)[]][] = []

// TODO: parenting still has an incorrect implementation; if files are named the same thing it will break. I need to figure out a way to pass around the path and properly handle it

for await (const [resource_type, resource] of Object.entries(resources)) {
    const pack_type = ResourcepackCategories.includes(resource_type as ResourcepackCategory) ? 'resourcepack' : 'datapack'

    const reference = (resource.data! as any).typeDef as mcdoc.ReferenceType

    const reference_path = reference.path!.split('::')

	const type_def = (symbols[reference.path!].data! as { typeDef: mcdoc.McdocType}).typeDef

    const resource_type_parts = resource_type.split('/')

    // eg. worldgen
    const resource_section = resource_type_parts.length > 1 ? resource_type_parts.slice(0, -1) : []

    const resource_name = resource_type_parts[resource_type_parts.length - 1]

    // eg. variants
    const resource_group = symbols[reference.path!].identifier.split('::').slice(3 + (resource_section.length), -2)

    const resolved_resource_types = TypeGen.resolveRootTypes([...resource_section, resource_name].join('_'), reference_path[reference_path.length - 2], type_def)

    if (resource_group.length === 1) {
        const parent = Object.hasOwn(resources, resource_group[0]) ? resource_group[0] : false

        if (parent !== false) {
            sub_resources.push([pack_type, reference_path[reference_path.length - 2], resource_type, resolved_resource_types])

            continue
        }
    }

    const type_path = join(...[generated_path, pack_type, ...resource_section, ...resource_group, `${camel_case(resource_name)}.ts`])

    resource_contents.set(reference_path[reference_path.length - 2], {
        types: resolved_resource_types,
        file_path: type_path,
    })
}

if (sub_resources.length > 0) {
    for await (const [pack_type, parent, resource, types] of sub_resources) {
        const existing = resource_contents.get(parent)

        if (existing === undefined) {
            console.warn(`Parent resource "${parent}" not found for sub-resource "${resource}"`)
            continue
        }

        // TODO: Handle imports properly

        existing.types.push(...types)
    }
}

for await (const [module_path, type_aliases] of module_files.entries()) {
    const file = compileTypes(type_aliases)

    const type_path = join(generated_path, ...module_path.split('/')) + '/index.ts'

    await Bun.write(type_path, file)
}

const dispatcher_keys = Object.keys(dispatchers)

for (const dispatcher_key of dispatcher_keys) {
    if (dispatcher_key === 'minecraft:resource') {
        continue
    }
    
    const members = TypeGen.resolveDispatcherTypes(pascal_case(dispatcher_key.replace('/', '_')), dispatcher_key)

    if (members === undefined || members.locator === undefined) {
        continue
    }

    const resource = resource_contents.get(members.locator.split('::').slice(-2)[0])

    if (resource === undefined) {
        continue
    }

    if (members.imports !== false) {
        resource.types.unshift(...members.imports)
    }

    resource.types.push(...members.types)
}

for await (const [_, resource_content] of resource_contents.entries()) {
    const file = compileTypes(resource_content.types)

    await Bun.write(resource_content.file_path, file)
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

    // Yeah this semicolon remover is dumb but I can't be bothered to find the setting, no fucking idea what omitTrailingSemicolon is supposed to be.
    return printer.printList(ts.ListFormat.MultiLine, nodes as unknown as ts.NodeArray<ts.Node>, resultFile).replaceAll(/\;$/gm, '')
}

await Bun.write(join(generated_path, 'tsconfig.json'), JSON.stringify({
    "compilerOptions": {
        baseUrl: "./",
        rootDir: "./",
        paths: {
            'resources/*': [`./*`],
            'registries/*': ['./*']
        }
    }
}))

service.project.close()
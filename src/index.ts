import path, { dirname, resolve } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

import {
    ConfigService,
    fileUtil,
    Service,
    VanillaConfig,
    MetaRegistry,
    type SymbolRegistrar,
    type ProjectInitializer,
} from '@spyglassmc/core'
import { NodeJsExternals } from '@spyglassmc/core/lib/nodejs.js'
import * as je from '@spyglassmc/java-edition'
import { ReleaseVersion } from '@spyglassmc/java-edition/lib/dependency/index.js'
import * as mcdoc from '@spyglassmc/mcdoc'
import { errorMessage, join } from './util'
import { fetchWithCache } from './util/fetch'
import { TypesGenerator } from './typegen'
import { compile_types } from './typegen/compile'
import { handle_imports } from './typegen/import'
import { export_registry, export_dispatcher } from './typegen/export'

const cache_root = join(dirname(fileURLToPath(import.meta.url)), 'cache')

const project_path = resolve(process.cwd(), 'dummy')

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

// Yes this is cursed
export let mcdoc_raw = ''
const vanillaMcdocUrl = 'https://api.spyglassmc.com/vanilla-mcdoc/symbols'

export interface VanillaMcdocSymbols {
    ref: string,
    mcdoc: Record<string, unknown>,
    'mcdoc/dispatcher': Record<string, Record<string, unknown>>,
}
export async function fetchVanillaMcdoc(): Promise<VanillaMcdocSymbols> {
    try {
        const buffer = await fetchWithCache(vanillaMcdocUrl)
        mcdoc_raw = await buffer.text()
        return JSON.parse(mcdoc_raw) as VanillaMcdocSymbols
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

    const version = (await (await fetch('https://api.spyglassmc.com/mcje/versions')).json())[0]
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

const TypeGen = new TypesGenerator()

TypeGen.resolve_types(service.project.symbols)

const { resolved_registries, resolved_dispatchers, resolved_symbols } = TypeGen

for await (const [symbol_path, { exports, imports }] of resolved_symbols.entries()) {
    const file = symbol_path.split('::').slice(1)

    // TODO: modify file more
    file.unshift('types')

    const code = await compile_types([
        ...handle_imports(imports),
        ... exports
    ])

    await Bun.write(`${join(...file)}.ts`, code)
}

// Generate Registry type export
const registryExport = export_registry(resolved_registries)
{
    const file = registryExport.symbol_path.split('::').slice(1)
    file.unshift('types')

    const code = await compile_types([
        ...handle_imports(registryExport.imports),
        ...registryExport.exports
    ])

    await Bun.write(`${join(...file)}.ts`, code)
}

// Generate Dispatcher type export
const dispatcherExport = export_dispatcher(resolved_dispatchers)
{
    const file = dispatcherExport.symbol_path.split('::').slice(1)
    file.unshift('types')

    const code = await compile_types([
        ...handle_imports(dispatcherExport.imports),
        ...dispatcherExport.exports
    ])

    await Bun.write(`${join(...file)}.ts`, code)
}

await Bun.write(join(generated_path, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
        allowImportingTsExtensions: true,
        baseUrl: "./",
        rootDir: "./",
        paths: {
            'resources/*': [`./*`],
            'registries/*': ['./*']
        }
    }
}))

service.project.close()
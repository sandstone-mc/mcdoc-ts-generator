import { promises as fs } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

import walk from 'klaw'
import ts from 'typescript'
import {
    ConfigService,
    fileUtil,
    Service,
    VanillaConfig,
} from '@spyglassmc/core'
import { NodeJsExternals } from '@spyglassmc/core/lib/nodejs.js'
import * as mcdoc from '@spyglassmc/mcdoc'

const cache_root = join(dirname(fileURLToPath(import.meta.url)), 'cache')

const project_path = resolve(process.cwd(), 'mcdoc')

await fileUtil.ensureDir(NodeJsExternals, project_path)

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
        initializers: [mcdoc.initialize],
        projectRoot: fileUtil.ensureEndingSlash(
            pathToFileURL(project_path).toString(),
        ),
    },
})

await service.project.ready()
await service.project.cacheService.save()

const generated_path = 'types'

for await (const doc_file of walk(project_path)) {
    if (doc_file.path.endsWith('.mcdoc')) {
        const DocumentUri = pathToFileURL(doc_file.path).toString()

        const doc_contents = await fs.readFile(doc_file.path, 'utf-8')

        await service.project.onDidOpen(
            DocumentUri,
            'mcdoc',
            0,
            doc_contents,
        )

        await service.project.ensureClientManagedChecked(
            DocumentUri,
        )

        await service.project.ensureBindingStarted(
            DocumentUri,
        )
    }
}

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

for await (const [resource_type, resource] of Object.entries(resources)) {
    const resource_path = resource.definition![0].uri.match(/mcdoc\/java\/(\w+)\//)![1]

    const pack_type = resource_path === 'data' ? 'datapack' : 'resourcepack'

    const type_path = join(generated_path, pack_type, `${camel_case(resource_type)}.ts`)

    const typeDef = (resource.data! as any).typeDef as mcdoc.McdocType

    let file = `const original = ${JSON.stringify(typeDef, null, 4)}\n\n`

    let resourceType: ts.TypeAliasDeclaration | undefined = resolveType(resource_type.replaceAll('/', '_'), typeDef)

    /* @ts-ignore */
    if (resourceType !== undefined) {
        file += compileTypes([resourceType])
    }

    Bun.write(type_path, file)
}

function resolveType(name: string, type: mcdoc.McdocType) {
    if (type.kind === 'struct') {
        return ts.factory.createTypeAliasDeclaration(
            [ts.factory.createModifier(ts.SyntaxKind.ExportKeyword)],
            ts.factory.createIdentifier(name),
            undefined,
            createStruct(type),
        )
    }
}

function compileTypes(nodes: any[]) {
    const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
    const resultFile = ts.createSourceFile(
      "code.ts",
      "",
      ts.ScriptTarget.Latest,
      false,
      ts.ScriptKind.TS
    );

    return printer.printList(ts.ListFormat.MultiLine, nodes as unknown as ts.NodeArray<ts.Node>, resultFile)
}

function createStruct(typeDef: mcdoc.StructType, location: string) {
    const anyFallback = ts.factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword)

    const members: readonly ts.TypeElement[] = typeDef.fields.filter((field) => {
        let old = false
        if (field.attributes && field.attributes.includes((attr: mcdoc.Attribute) => attr.name === 'until')) {
            old = true
        }
        return field.kind === 'pair' && !old
    }).map((_field) => {
        const field = _field as mcdoc.StructTypePairField

        if (typeof field.key === 'string') {
            return ts.factory.createPropertySignature(
                undefined,
                bindKey(field.key),
                field.optional ? ts.factory.createToken(ts.SyntaxKind.QuestionToken) : undefined,
                field.type.kind === 'struct' ? createStruct(field.type, location) : anyFallback,
            )
        } else if (field.key.kind === 'string') {
            if (field.key.attributes && field.key.attributes.includes((attr: mcdoc.Attribute) => attr.name === 'id')) {
                console.log('hello???')
                return ts.factory.createIndexSignature(
                    undefined,
                    [
                        ts.factory.createParameterDeclaration(
                            undefined,
                            undefined,
                            ts.factory.createIdentifier('id'),
                            undefined,
                            ts.factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
                        )
                    ],
                    field.type.kind === 'struct' ? createStruct(field.type, location) : anyFallback,
                )
            }
            let index = (value: ts.TypeNode) => ts.factory.createIndexSignature(
                undefined,
                [
                    ts.factory.createParameterDeclaration(
                        undefined,
                        undefined,
                        ts.factory.createIdentifier('key'),
                        undefined,
                        ts.factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
                    )
                ],
                value,
            )

            if (field.type.kind === 'struct') return {
                type: index(createStruct(field.type, location))
            }
            if (field.type.kind === 'reference') {
                const resolved = resolveReference(field.type, location)

                if (resolved.import) return {
                    import: resolved.import,
                    type: ts.factory.createIdentifier(resolved.name)
                }
                return {
                    type: resolved.name,
                    module: resolved.module
                }
            }

            return index(anyFallback)
        }
        const key = field.key as mcdoc.ReferenceType

        return ts.factory.createIndexSignature(
            undefined,
            [
                ts.factory.createParameterDeclaration(
                    undefined,
                    undefined,
                    ts.factory.createIdentifier(key.path!.split('::').pop()!),
                    undefined,
                    ts.factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
                )
            ],
            field.type.kind === 'struct' ? createStruct(field.type, location) : anyFallback,
        )
    })

    /* @ts-ignore */
    if (members.length === 0) console.log(typeDef.fields[0].key)

    return ts.factory.createTypeLiteralNode(members)
}

function bindKey(key: string | mcdoc.McdocType) {
    if (typeof key === 'string') return ts.factory.createIdentifier(key)

    return ts.factory.createComputedPropertyName(ts.factory.createIdentifier('string'))
}

const resolved_modules = new Map<string, string[]>()

const module_files = new Map<string, ts.TypeAliasDeclaration[]>()

function resolveReference(ref: mcdoc.ReferenceType, current_location: string): (
    { import: false, name: string, module: ts.TypeAliasDeclaration | false } | 
    { import: ts.ImportDeclaration, name: string, module: false }
) {
    const ref_path = ref.path!.split('::')
    const location = ref_path.slice(0, -1).join('/')

    const resolve_module = () => resolveType(ref_path[-1], (symbols[ref.path!].data! as any).typeDef as mcdoc.McdocType)

    if (location === current_location) return {
        import: false,
        name: ref_path[-1],
        module: resolve_module() ?? false
    }

    const module_path = join(generated_path, `${location}/${ref_path[-1]}.ts`)

    const module_import = ts.factory.createImportDeclaration(
        undefined,
        ts.factory.createImportClause(
            true,
            undefined,
            ts.factory.createNamedImports([
                ts.factory.createImportSpecifier(false, undefined, ts.factory.createIdentifier(ref_path[-1]))
            ])
        ),
        ts.factory.createStringLiteral(module_path)
    )

    if (resolved_modules.has(location) && resolved_modules.get(location)!.includes(module_path)) return {
        import: module_import,
        name: ref_path[-1],
        module: false
    }
    const module = resolve_module()

    if (!resolved_modules.has(location)) {
        resolved_modules.set(location, [module_path])

        if (module !== undefined) {
            module_files.set(location, [module])
        }

        return {
            import: module_import,
            name: ref_path[-1],
            module: false
        }
    }

    resolved_modules.get(location)!.push(module_path)

    if (module !== undefined) {
        module_files.get(location)!.push(module)
    }

    return {
        import: module_import,
        name: ref_path[-1],
        module: false
    }
}
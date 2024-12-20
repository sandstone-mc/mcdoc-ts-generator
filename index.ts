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
    type SymbolMap,
} from '@spyglassmc/core'
import { NodeJsExternals } from '@spyglassmc/core/lib/nodejs.js'
import * as mcdoc from '@spyglassmc/mcdoc'

const cache_root = join(dirname(fileURLToPath(import.meta.url)), 'cache')

const project_path = resolve(process.cwd(), 'mcdoc')

const resolved_modules = new Map<string, string[]>()

const module_files = new Map<string, ts.TypeAliasDeclaration[]>()

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
    const local_path = resource.definition![0].uri.match(/mcdoc\/java\/(\w+)\/([\w\/]+)/)!

    const pack_type = local_path[1] === 'data' ? 'datapack' : 'resourcepack'

    const type_path = join(generated_path, pack_type, `${camel_case(resource_type)}.ts`)

    const typeDef = (resource.data! as any).typeDef as mcdoc.McdocType

    let file = `const original = ${JSON.stringify(typeDef, null, 4)}\n\n`

    const resolved_resource_types = resolveRootTypes(resource_type.replaceAll('/', '_'), typeDef, `java/${local_path[1]}/${local_path[2]}`)

    file += compileTypes(resolved_resource_types)

    Bun.write(type_path, file)
}

function resolveRootTypes(name: string, type: mcdoc.McdocType, current_location: string) {
    if (type.kind === 'struct') {
        const result = createStruct(type, current_location)

        const types = [ts.factory.createTypeAliasDeclaration(
            [ts.factory.createModifier(ts.SyntaxKind.ExportKeyword)],
            ts.factory.createIdentifier(name),
            undefined,
            result.type,
        )] as (ts.TypeAliasDeclaration | ts.ImportDeclaration | ts.EnumDeclaration)[]

        if (result.modules.length > 0) {
            types.push(...result.modules)
        }

        if (result.imports.length > 0) {
            types.unshift(...result.imports)
        }
        
        return types
    } else {
        return []
    }
}

function resolveTypes(name: string, type: mcdoc.McdocType, current_location: string) {
    if (type.kind === 'struct') {
        const result = createStruct(type, current_location)

        return {
            type: ts.factory.createTypeAliasDeclaration(
                [ts.factory.createModifier(ts.SyntaxKind.ExportKeyword)],
                ts.factory.createIdentifier(name),
                undefined,
                result.type,
            ),
            imports: result.imports,
            modules: result.modules
        }
    } else {
        return {
            type: undefined,
            imports: [],
            modules: []
        }
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

type StructMember = {
    type: ts.IndexSignatureDeclaration | ts.PropertySignature | ts.Identifier;
    add_import?: ts.ImportDeclaration;
    module?: ts.TypeAliasDeclaration;
}

let dispatcher_count = 0

function createStruct(typeDef: mcdoc.StructType, current_location: string) {
    const anyFallback = ts.factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword)

    const member_types: (ts.IndexSignatureDeclaration | ts.PropertySignature | ts.Identifier)[] = []

    const imports: ts.ImportDeclaration[] = []
    
    const modules: (ts.TypeAliasDeclaration | ts.EnumDeclaration)[] = []

    for (const field of typeDef.fields) {
        if (field.attributes !== undefined && field.attributes.includes((attr: mcdoc.Attribute) => attr.name === 'until')) {
            continue
        }
        if (field.kind === 'pair') {
            const resolvePair: () => StructMember = () => {
                if (typeof field.key === 'string') {
                    let value
                    if (field.type.kind === 'struct') {
                        const struct = createStruct(field.type, current_location)

                        value = struct.type

                        if (struct.imports.length > 0) {
                            imports.push(...struct.imports)
                        }
                        if (struct.modules.length > 0) {
                            modules.push(...struct.modules)
                        }
                    } else {
                        value = anyFallback
                    }
                    return {
                        type: ts.factory.createPropertySignature(
                            undefined,
                            bindKey(field.key),
                            field.optional ? ts.factory.createToken(ts.SyntaxKind.QuestionToken) : undefined,
                            value,
                        )
                    }
                } else if (field.key.kind === 'string') {
                    if (field.key.attributes && field.key.attributes.includes((attr: mcdoc.Attribute) => attr.name === 'id')) {
                        console.log('hello???')
                        let value
                        if (field.type.kind === 'struct') {
                            const struct = createStruct(field.type, current_location)

                            value = struct.type

                            if (struct.imports.length > 0) {
                                imports.push(...struct.imports)
                            }
                            if (struct.modules.length > 0) {
                                modules.push(...struct.modules)
                            }
                        } else {
                            value = anyFallback
                        }
                        return {
                            type: ts.factory.createIndexSignature(
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
                                value,
                            )
                        }
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
        
                    if (field.type.kind === 'struct') {
                        const struct = createStruct(field.type, current_location)

                        if (struct.imports.length > 0) {
                            imports.push(...struct.imports)
                        }
                        if (struct.modules.length > 0) {
                            modules.push(...struct.modules)
                        }

                        return {
                            type: index(struct.type)
                        }
                    }
                    if (field.type.kind === 'reference') {
                        const resolved = resolveReference(field.type, current_location)

                        if (resolved.import) return {
                            add_import: resolved.import,
                            type: ts.factory.createIdentifier(resolved.name)
                        }
                        return {
                            type: ts.factory.createIdentifier(resolved.name),
                            ...(resolved.module ? { module: resolved.module } : {})
                        }
                    }
        
                    return {
                        type: index(anyFallback)
                    }
                } else if (field.key.kind === 'dispatcher') {
                    const value = resolveDispatcher(field.key, current_location)

                    if (value) {
                        if (value.import) {
                            imports.push(value.import)
                        }
                        if (typeof value.module !== 'boolean') {
                            modules.push(value.module)
                        }

                        const name = typeof value.name === 'string' ? value.name : `dispatcher_${dispatcher_count++}`

                        return {
                            type: ts.factory.createPropertySignature(
                                undefined,
                                bindKey('dispatcher'),
                                field.optional ? ts.factory.createToken(ts.SyntaxKind.QuestionToken) : undefined,
                                ts.factory.createTypeReferenceNode(name),
                            )
                        }
                    }

                }
                const key = field.key as mcdoc.ReferenceType

                let value = resolveValueType(field.type, current_location)!

                if (value.imports?.length > 0) {
                    imports.push(...value.imports)
                }

                if (value.modules?.length > 0) {
                    modules.push(...value.modules)
                }
        
                return {
                    type: ts.factory.createIndexSignature(
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
                        value.type,
                    )
                }
            }

            const pair = resolvePair()

            member_types.push(pair.type)

            if (pair.add_import) {
                imports.push(pair.add_import)
            }

            if (pair.module) {
                modules.push(pair.module)
            }
        }

        if (field.kind === 'spread') {
            continue
        }

        if (typeof field.key === 'string') {
            if (field.type.kind === 'struct') {
                const struct = createStruct(field.type, current_location)

                member_types.push(ts.factory.createPropertySignature(
                    undefined,
                    bindKey(field.key),
                    field.optional ? ts.factory.createToken(ts.SyntaxKind.QuestionToken) : undefined,
                    struct.type,
                ))

                if (struct.imports.length > 0) {
                    imports.push(...struct.imports)
                }

                if (struct.modules.length > 0) {
                    modules.push(...struct.modules)
                }
                continue
            }
            if (field.type.kind === 'reference') {
                const resolved = resolveReference(field.type, current_location)

                member_types.push(ts.factory.createPropertySignature(
                    undefined,
                    bindKey(field.key),
                    field.optional ? ts.factory.createToken(ts.SyntaxKind.QuestionToken) : undefined,
                    ts.factory.createTypeReferenceNode(resolved.name),
                ))

                if (resolved.import) {
                    imports.push(resolved.import)
                } else if (resolved.module) {
                    modules.push(resolved.module)
                }
                continue
            }
            if (field.type.kind === 'any') {
                member_types.push(ts.factory.createPropertySignature(
                    undefined,
                    bindKey(field.key),
                    field.optional ? ts.factory.createToken(ts.SyntaxKind.QuestionToken) : undefined,
                    anyFallback,
                ))
                continue
            }

        }
    }

    /* @ts-ignore */
    if (member_types.length === 0) console.log(typeDef.fields[0].key)

    return {
        /* @ts-ignore */ // TODO: Make sure this is okay
        type: ts.factory.createTypeLiteralNode(member_types),
        imports,
        modules
    }
}

let inline_enum_count = 0

/**
 * TODO: Remember to add this!!!
 * ```js
 * type ArrayLengthMutationKeys = 'splice' | 'push' | 'pop' | 'shift' |  'unshift'
 * type FixedLengthArray<T, L extends number, TObj = [T, ...Array<T>]> =
 *   Pick<TObj, Exclude<keyof TObj, ArrayLengthMutationKeys>>
 *   & {
 *       readonly length: L 
 *       [ I : number ] : T
 *       [Symbol.iterator]: () => IterableIterator<T>   
 *   }
 * ```
 */
function resolveValueType(type: mcdoc.McdocType, current_location: string): {
    type: ts.TypeLiteralNode | ts.TypeReferenceNode | ts.KeywordTypeNode | ts.UnionTypeNode | ts.LiteralTypeNode;
    imports: ts.ImportDeclaration[] | never[];
    modules: (ts.TypeAliasDeclaration | ts.EnumDeclaration)[] | never[];
} | undefined {
    switch (type.kind) {
        case 'struct':
            return createStruct(type, current_location)
        case 'reference':
            const resolved = resolveReference(type, current_location)

            return {
                type: ts.factory.createTypeReferenceNode(resolved.name),
                imports: resolved.import ? [resolved.import] : [],
                modules: resolved.module ? [resolved.module] : []
            }
        case 'boolean': 
            return {
                type: ts.factory.createKeywordTypeNode(ts.SyntaxKind.BooleanKeyword),
                imports: [],
                modules: []
            }
        case 'string':
            return {
                type: ts.factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
                imports: [],
                modules: []
            }
        case 'byte':
            return {
                type: ts.factory.createTypeReferenceNode('NBTByte'),
                imports: [ bindImport('NBTByte', 'sandstone/variables/nbt') ],
                modules: []
            }
        case 'short':
            return {
                type: ts.factory.createTypeReferenceNode('NBTShort'),
                imports: [ bindImport('NBTShort', 'sandstone/variables/nbt') ],
                modules: []
            }
        case 'int':
            return {
                type: ts.factory.createTypeReferenceNode('NBTInt'),
                imports: [ bindImport('NBTInt', 'sandstone/variables/nbt') ],
                modules: []
            }
        case 'long':
            return {
                type: ts.factory.createTypeReferenceNode('NBTLong'),
                imports: [ bindImport('NBTLong', 'sandstone/variables/nbt') ],
                modules: []
            }
        case 'float':
            return {
                type: ts.factory.createTypeReferenceNode('NBTFloat'),
                imports: [ bindImport('NBTFloat', 'sandstone/variables/nbt') ],
                modules: []
            }
        case 'double':
            return {
                type: ts.factory.createTypeReferenceNode('NBTDouble'),
                imports: [ bindImport('NBTDouble', 'sandstone/variables/nbt') ],
                modules: []
            }
        case 'list': {
            const item = resolveValueType(type.item, current_location)!

            if (type.lengthRange) {
                const range = bindRangedInt(type.lengthRange)
                if (range) {
                    return {
                        type: ts.factory.createTypeReferenceNode('FixedLengthArray', [item.type, {
                            ...range,
                            _typeNodeBrand: ''
                        }]),
                        imports: [ bindImport('FixedLengthArray', 'sandstone/utils'), ...item.imports ],
                        modules: item.modules
                    }
                }
            }
            return {
                type: ts.factory.createTypeReferenceNode('Array', [item.type]),
                imports: item.imports,
                modules: item.modules
            }
        }
        case 'byte_array': {
            return {
                type: ts.factory.createTypeReferenceNode('NBTByteArray'),
                imports: [ bindImport('NBTByteArray', 'sandstone/variables/nbt') ],
                modules: []
            }
        }
        case 'int_array': {
            return {
                type: ts.factory.createTypeReferenceNode('NBTIntArray'),
                imports: [ bindImport('NBTIntArray', 'sandstone/variables/nbt') ],
                modules: []
            }
        }
        case 'long_array': {
            return {
                type: ts.factory.createTypeReferenceNode('NBTLongArray'),
                imports: [ bindImport('NBTLongArray', 'sandstone/variables/nbt') ],
                modules: []
            }
        }
        case 'union': {
            const types = type.members.map((type) => resolveValueType(type, current_location)!)

            return {
                type: ts.factory.createUnionTypeNode(types.map((type) => type.type)),
                imports: types.flatMap((type) => type.imports),
                modules: types.flatMap((type) => type.modules)
            }
        }
        case 'enum': {
            const enum_identifier = ts.factory.createIdentifier(`inlineEnum${inline_enum_count++}`) // :husk:

            return {
                type: ts.factory.createTypeReferenceNode(enum_identifier),
                imports: [],
                modules: [ createEnum(enum_identifier, type) ]
            }
        }
        case 'literal': {
            switch (type.value.kind) {
                case 'boolean':
                    return {
                        type: type.value.value ? 
                            ts.factory.createLiteralTypeNode(ts.factory.createTrue()) 
                            : ts.factory.createLiteralTypeNode(ts.factory.createFalse()),
                        imports: [],
                        modules: []
                    }
                case 'string':
                    return {
                        type: ts.factory.createLiteralTypeNode(ts.factory.createStringLiteral(type.value.value)),
                        imports: [],
                        modules: []
                    }
                case 'byte': {
                    return {
                        type: ts.factory.createTypeReferenceNode('NBTByte', [{
                            ...ts.factory.createNumericLiteral(type.value.value),
                            _typeNodeBrand: ''
                        }]),
                        imports: [
                            bindImport('NBTByte', 'sandstone/variables/nbt')
                        ],
                        modules: []
                    }
                }
                case 'short': {
                    return {
                        type: ts.factory.createTypeReferenceNode('NBTShort', [{
                            ...ts.factory.createNumericLiteral(type.value.value),
                            _typeNodeBrand: ''
                        }]),
                        imports: [
                            bindImport('NBTShort', 'sandstone/variables/nbt')
                        ],
                        modules: []
                    }
                }
                case 'float': {
                    return {
                        type: ts.factory.createTypeReferenceNode('NBTFloat', [{
                            ...ts.factory.createNumericLiteral(type.value.value),
                            _typeNodeBrand: ''
                        }]),
                        imports: [
                            bindImport('NBTFloat', 'sandstone/variables/nbt')
                        ],
                        modules: []
                    }
                }
                default: // This is a hack, but it works. `double` is the default decimal SNBT value type, `int` is the default integer SNBT value type.
                    return {
                        type: ts.factory.createLiteralTypeNode(ts.factory.createNumericLiteral(type.value.value)),
                        imports: [],
                        modules: []
                    }
            }
        }
        default:
            return {
                type: ts.factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword),
                imports: [],
                modules: []
            }
    }
}

function createEnum(name: ts.Identifier, _enum: mcdoc.EnumType) {
    if (_enum.enumKind === 'string') {
        return ts.factory.createEnumDeclaration(
            undefined,
            name,
            _enum.values.map((value) => ts.factory.createEnumMember(value.identifier, ts.factory.createStringLiteral(value.value as string))),
        )
    }
    return ts.factory.createEnumDeclaration(
        undefined,
        name,
        _enum.values.map((value) => ts.factory.createEnumMember(value.identifier, ts.factory.createNumericLiteral(value.value as number))),
    )
}

function bindRangedInt(range: mcdoc.NumericRange) {
    const rangeString = mcdoc.NumericRange.toString(range)

    if (/^[0-9]+$/.test(mcdoc.NumericRange.toString(range))) {
        return ts.factory.createNumericLiteral(parseInt(rangeString))
    }

    if (range.min && range.max) {
        if (range.max - range.min > 100) {
            return
        }
        let values = []
        if (mcdoc.RangeKind.isRightExclusive(range.kind)) {
            range.max--
        }
        if (mcdoc.RangeKind.isLeftExclusive(range.kind)) {
            range.min++
        }
        for (let i = range.min; i <= range.max; i++) {
            values.push({
                ...ts.factory.createNumericLiteral(i),
                _typeNodeBrand: ''
            })
        }
        return ts.factory.createUnionTypeNode(values)
    }
}

function bindKey(key: string | mcdoc.McdocType) {
    if (typeof key === 'string') return ts.factory.createIdentifier(key)

    return ts.factory.createComputedPropertyName(ts.factory.createIdentifier('string'))
}

function bindImport(module_name: string, module_path: string) {
    return ts.factory.createImportDeclaration(
        undefined,
        ts.factory.createImportClause(
            true,
            undefined,
            ts.factory.createNamedImports([
                ts.factory.createImportSpecifier(false, undefined, ts.factory.createIdentifier(module_name))
            ])
        ),
        ts.factory.createStringLiteral(module_path)
    )
}

function resolveReference(ref: mcdoc.ReferenceType, current_location: string): (
    { import: false, name: string, module: ts.TypeAliasDeclaration | false } | 
    { import: ts.ImportDeclaration, name: string, module: false }
) {
    const ref_path = ref.path!.split('::').slice(1)
    const ref_name = ref_path.slice(-1)[0]
    const location = ref_path.slice(0, -1).join('/')

    const resolve_module = () => resolveTypes(ref_name, (symbols[ref.path!].data! as any).typeDef as mcdoc.McdocType, current_location)

    if (location === current_location) {
        const module = resolve_module()
        return {
            import: false,
            name: ref_name,
            module: module.type ?? false
        }
    }

    const module_path = `${generated_path}/${location}/${ref_name}.ts`

    const module_import = ts.factory.createImportDeclaration(
        undefined,
        ts.factory.createImportClause(
            true,
            undefined,
            ts.factory.createNamedImports([
                ts.factory.createImportSpecifier(false, undefined, ts.factory.createIdentifier(ref_name))
            ])
        ),
        ts.factory.createStringLiteral(module_path)
    )

    if (resolved_modules.has(location) && resolved_modules.get(location)!.includes(module_path)) return {
        import: module_import,
        name: ref_name,
        module: false
    }
    const module = resolve_module()

    if (!resolved_modules.has(location)) {
        resolved_modules.set(location, [module_path])

        if (module.type !== undefined) {
            module_files.set(location, [module.type])
        }

        return {
            import: module_import,
            name: ref_name,
            module: false
        }
    }

    resolved_modules.get(location)!.push(module_path)

    if (module.type !== undefined) {
        if (!module_files.has(location)) {
            module_files.set(location, [module.type])
        } else {
            module_files.get(location)!.push(module.type)
        }
    }

    return {
        import: module_import,
        name: ref_name,
        module: false
    }
}

// Kill me. This is the reason I didn't want mcdoc/runtime to be a thing. All of this would ideally be resolved statically AoT by the language server.
function resolveDispatcher(dispatcher: mcdoc.DispatcherType, parent_struct: string, parent_key?: mcdoc.StructKeyNode) {
    const index = dispatcher.parallelIndices[0]

    if (index.kind === 'static') {
        const module_import = ts.factory.createImportDeclaration(
            undefined,
            ts.factory.createImportClause(
                true,
                undefined,
                ts.factory.createNamedImports([
                    ts.factory.createImportSpecifier(false, undefined, ts.factory.createIdentifier(index.value))
                ])
            ),
            ts.factory.createStringLiteral(generated_path + `/${dispatcher.registry.split(':')[1]}/${index.value}.ts`)
        )
        return {
            import: module_import,
            name: index.value,
            module: false
        }
    } else {
        if (typeof index.accessor[0] === 'object') {
            if (index.accessor[0].keyword === 'key') {
                const registry = dispatcher.registry.replaceAll('/', '_').split(':')[1]
                const registry_import = ts.factory.createImportDeclaration(
                    undefined,
                    ts.factory.createImportClause(
                        true,
                        undefined,
                        ts.factory.createNamedImports([
                            ts.factory.createImportSpecifier(false, undefined, ts.factory.createIdentifier(registry))
                        ])
                    ),
                    ts.factory.createStringLiteral(generated_path +`/${dispatcher.registry.split(':')[1]}/index.ts`)
                )
                return {
                    import: registry_import,
                    name: false,
                    module: ts.factory.createTypeAliasDeclaration(
                        undefined,
                        ts.factory.createIdentifier(`${parent_struct}_${registry}`),
                        undefined,
                        ts.factory.createMappedTypeNode(
                            undefined,
                            ts.factory.createTypeParameterDeclaration(
                                undefined,
                                ts.factory.createIdentifier('Key'),
                                ts.factory.createTypeOperatorNode(
                                    ts.SyntaxKind.KeyOfKeyword,
                                    ts.factory.createTypeReferenceNode(ts.factory.createIdentifier(registry), undefined)
                                ),
                                undefined
                            ),
                            undefined,
                            ts.factory.createToken(ts.SyntaxKind.QuestionToken),
                            ts.factory.createTypeReferenceNode(ts.factory.createIdentifier(registry), [
                                ts.factory.createTypeReferenceNode(ts.factory.createIdentifier('Key'), undefined)
                            ]),
                            undefined
                        )
                    )
                }
            } else {
                let parentCount = 1

                let path: string[] = []

                for (const accessor of index.accessor.slice(1)) {
                    if (typeof accessor === 'object') {
                        if (accessor.keyword === 'parent') {
                            parentCount++
                        } else {
                            throw new Error('Invalid accessor keyword')
                        }
                    }
                    path.push(accessor as string)
                }

                // Kill me
            }
        }
    }
}
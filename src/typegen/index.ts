import type { Service, SymbolMap } from '@spyglassmc/core'
import * as mcdoc from '@spyglassmc/mcdoc'
import ts from 'typescript'

/**
 * Help:
 * - https://ts-ast-viewer.com/
 * - https://stackoverflow.com/questions/67575784/typescript-ast-factory-how-to-use-comments
 */
const { factory } = ts


export class TypesGenerator {
    private key_dispatcher_count = 0

    private inline_enum_count = 0

    private inner_dispatcher_count = 0

    private resolved_modules = new Map<string, string[]>()

    constructor(private service: Service, private symbols: SymbolMap, private dispatchers: SymbolMap, private module_files: Map<string, ts.TypeAliasDeclaration[]>, private generated_path: string) { }

    last<T extends any[]>(list: T) {
        return list[list.length - 1] as T[number]
    }

    resolveRootTypes(export_name: string, typeDef: mcdoc.McdocType) {
        if (typeDef.kind === 'struct') {
            const result = this.createStruct(typeDef, export_name)

            const types = [factory.createTypeAliasDeclaration(
                [factory.createModifier(ts.SyntaxKind.ExportKeyword)],
                factory.createIdentifier(export_name),
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

    createStruct(typeDef: mcdoc.StructType, parent: string) {
        const anyFallback = factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword)

        type ValueType = NonNullable<ReturnType<TypesGenerator['resolveValueType']>>['type'] | ts.KeywordTypeNode<ts.SyntaxKind.AnyKeyword> | ts.TypeNode

        const member_types: (ts.IndexSignatureDeclaration | ts.PropertySignature)[] = []

        const intersection_types: (ts.TypeLiteralNode | ts.TypeReferenceNode | ts.ParenthesizedTypeNode | ts.IntersectionTypeNode)[] = []

        const imports: ts.ImportDeclaration[] = []

        const modules: (ts.TypeAliasDeclaration | ts.EnumDeclaration)[] = []

        const inner_dispatchers: {
            name: string;
            registry: `${string}:${string}`;
        }[] = []

        for (const field of typeDef.fields) {
            /** Skip all removed fields */
            if (field.attributes !== undefined && field.attributes.includes((attr: mcdoc.Attribute) => attr.name === 'until')) {
                continue
            }

            if (field.kind === 'pair') {
                let key: (value: ValueType) => ts.PropertySignature | ts.IndexSignatureDeclaration
                let value: ValueType = anyFallback

                const optional = field.optional ? factory.createToken(ts.SyntaxKind.QuestionToken) : undefined

                /** Build the pair */

                /** Normal key */
                if (typeof field.key === 'string') {
                    key = (value: ValueType) => factory.createPropertySignature(
                        undefined,
                        this.bindKey(field.key),
                        optional,
                        value
                    )
                    /** Key has dynamic properties to it */
                } else if (field.key.kind === 'string') {
                    /** Key is proceeded by `minecraft:` but isn't derived from a registry or enum, in vanilla-mcdoc is only followed by a struct */
                    if (field.key.attributes && field.key.attributes.includes((attr: mcdoc.Attribute) => attr.name === 'id')) {
                        if (field.type.kind === 'struct') {
                            const struct = this.createStruct(field.type, parent)

                            key = (value: ValueType) => factory.createIndexSignature(
                                undefined,
                                [
                                    factory.createParameterDeclaration(
                                        undefined,
                                        undefined,
                                        factory.createIdentifier('id'),
                                        optional,
                                        factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
                                    )
                                ],
                                value,
                            )

                            value = struct.type

                            if (struct.imports.length > 0) {
                                imports.push(...struct.imports)
                            }
                            if (struct.modules.length > 0) {
                                modules.push(...struct.modules)
                            }
                        }
                        /** Key is an arbitrary string, eg. Advancement Criteria names */
                    } else {
                        key = (value: ValueType) => factory.createIndexSignature(
                            undefined,
                            [
                                factory.createParameterDeclaration(
                                    undefined,
                                    undefined,
                                    factory.createIdentifier('key'),
                                    optional,
                                    factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
                                )
                            ],
                            value,
                        )

                        if (field.type.kind === 'struct') {
                            const struct = this.createStruct(field.type, parent)

                            if (struct.imports.length > 0) {
                                imports.push(...struct.imports)
                            }
                            if (struct.modules.length > 0) {
                                modules.push(...struct.modules)
                            }

                            value = struct.type
                        } else if (field.type.kind === 'reference') {
                            const resolved = this.resolveReference(field.type, parent)

                            value = factory.createTypeReferenceNode(factory.createIdentifier(resolved.name))

                            if (resolved.import) {
                                imports.push(resolved.import)
                            } else if (resolved.module) {
                                modules.push(resolved.module)
                            }
                        }
                    }
                    /** Key is a dispatcher  */
                } else if (field.key.kind === 'dispatcher') {
                    const _value = this.resolveDispatcher(field.key, parent)

                    if (_value) {
                        if (typeof _value.import !== 'boolean') {
                            imports.push(_value.import)
                        }
                        if (typeof _value.module !== 'boolean') {
                            modules.push(_value.module)
                        }

                        if (_value.inner_dispatcher) {
                            inner_dispatchers.push(_value.inner_dispatcher)
                            continue
                        }

                        value = factory.createTypeReferenceNode(
                            typeof _value.name === 'string' ? _value.name : `dispatcher_${this.key_dispatcher_count++}`
                        )

                        key = (value: ValueType) => factory.createPropertySignature(
                            undefined,
                            this.bindKey('dispatcher'),
                            optional,
                            value,
                        )
                    }
                } else {
                    const resolve = this.resolveValueType(field.type, parent)!

                    value = factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword)

                    if (resolve.imports?.length > 0) {
                        imports.push(...resolve.imports)
                    }

                    if (resolve.modules?.length > 0) {
                        modules.push(...resolve.modules)
                    }

                    key = (value) => factory.createIndexSignature(
                        undefined,
                        [
                            factory.createParameterDeclaration(
                                undefined,
                                undefined,
                                factory.createIdentifier(this.last((field.key as mcdoc.ReferenceType).path!.split('::'))),
                                optional,
                                value,
                            )
                        ],
                        resolve.type,
                    )
                }

                /* @ts-ignore */
                if (key !== undefined) {
                    // yeah this is a hack
                    const resolved = this.resolveValueType(field.type, parent) || {
                        type: anyFallback,
                        imports: [],
                        modules: []
                    }
                    if (resolved.imports.length > 0) {
                        imports.push(...resolved.imports)
                    }
                    if (resolved.modules.length > 0) {
                        modules.push(...resolved.modules)
                    }
                    member_types.push(key(resolved.type))
                }
            } else if (field.kind === 'spread') {
                const spread = field as mcdoc.StructTypeSpreadField

                switch (spread.type.kind) {
                    case 'reference': {
                        const reference = this.resolveReference(spread.type, parent)

                        if (reference.import !== false) {
                            imports.push(reference.import)
                        } else if (reference.module !== false) {
                            modules.push(reference.module)
                        }

                        intersection_types.push(factory.createTypeReferenceNode(
                            factory.createIdentifier(reference.name),
                            undefined
                        ))
                    } break
                    case 'struct': {
                        const struct = this.createStruct(spread.type, parent)

                        intersection_types.push(struct.type)

                        if (struct.imports.length > 0) {
                            imports.push(...struct.imports)
                        }
                        if (struct.modules.length > 0) {
                            modules.push(...struct.modules)
                        }
                    } break
                    default: {
                        // TODO
                        //console.log(parent)
                        //console.log(spread.type)
                    }
                }
                
            }
        }

        /* @ts-ignore */
        if (member_types.length === 0) console.log(typeDef.fields[0].key)

        if (inner_dispatchers.length !== 0) {
            if (intersection_types.length !== 0) {
                // yikes
            }
            if (inner_dispatchers.length === 1) {
                return {
                    /* @ts-ignore */ // TODO
                    type: factory.createParenthesizedType(factory.createUnionTypeNode(Object.keys(this.dispatchers[inner_dispatchers[0].registry].members).map((registry_item) => {
                        return factory.createTypeReferenceNode(
                            factory.createIdentifier(inner_dispatchers[0].name),
                            [
                              factory.createLiteralTypeNode(factory.createStringLiteral(registry_item)),
                              /* @ts-ignore */ // TODO: Make sure this is okay
                              factory.createTypeLiteralNode(member_types)
                            ]
                          )
                    }))),
                    imports,
                    modules
                }
            } else {
                // yikes
            }
        }

        if (intersection_types.length !== 0) {
            intersection_types.unshift(factory.createTypeLiteralNode(member_types))

            return {
                type: factory.createIntersectionTypeNode(intersection_types),
                imports,
                modules
            }
        }

        return {
            type: factory.createTypeLiteralNode(member_types),
            imports,
            modules
        }
    }

    bindKey(key: string | mcdoc.McdocType) {
        if (typeof key === 'string') return factory.createIdentifier(key)

        return factory.createComputedPropertyName(factory.createIdentifier('string'))
    }

    resolveReference(ref: mcdoc.ReferenceType, parent?: string): (
        { import: false, name: string, module: ts.TypeAliasDeclaration | false } |
        { import: ts.ImportDeclaration, name: string, module: false }
    ) {
        const ref_path = ref.path!.split('::').slice(2)
        if (ref_path[0] === 'data') {
            ref_path[0] = 'datapack'
        } else if (ref_path[0] === 'assets') {
            ref_path[0] = 'resourcepack'
        } /*else {
            throw new Error(`[TypesGenerator#resolveReference] Unhandled reference path: ${ref.path}`)
        }*/
        const ref_name = ref_path.slice(-1)[0]
        const location = ref_path.slice(0, -1).join('/')

        const resolve_module = () => this.resolveRootTypes(ref_name, (this.symbols[ref.path!].data! as any).typeDef as mcdoc.McdocType)

        /** Determine whether to embed the referenced module in the same file */
        if (location === parent) {
            const module = resolve_module()
            return {
                import: false,
                name: ref_name,
                module: module[0] as ts.TypeAliasDeclaration
            }
        }

        const module_path = `${this.generated_path.split('/').slice(1).join('/')}/${location}/index.ts`

        const module_import = this.bindImport(ref_name, module_path)

        if (this.resolved_modules.has(location) && this.resolved_modules.get(location)!.includes(module_path)) return {
            import: module_import,
            name: ref_name,
            module: false
        }
        const module = resolve_module()

        if (!this.resolved_modules.has(location)) {
            this.resolved_modules.set(location, [module_path])

            if (module[0] !== undefined) {
                this.module_files.set(location, [module[0] as ts.TypeAliasDeclaration])
            }

            return {
                import: module_import,
                name: ref_name,
                module: false
            }
        }

        this.resolved_modules.get(location)!.push(module_path)

        if (module[0] !== undefined) {
            if (!this.module_files.has(location)) {
                this.module_files.set(location, [module[0] as ts.TypeAliasDeclaration])
            } else {
                this.module_files.get(location)!.push(module[0] as ts.TypeAliasDeclaration)
            }
        }

        return {
            import: module_import,
            name: ref_name,
            module: false
        }
    }

    resolveDispatcher(dispatcher: mcdoc.DispatcherType, parent_path?: string) {
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
                ts.factory.createStringLiteral(this.generated_path + `/${dispatcher.registry.split(':')[1]}/${index.value}.ts`)
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
                        ts.factory.createStringLiteral(this.generated_path + `/${dispatcher.registry.split(':')[1]}/index.ts`)
                    )
                    return {
                        import: registry_import,
                        name: false,
                        module: ts.factory.createTypeAliasDeclaration(
                            undefined,
                            ts.factory.createIdentifier(`${parent_path?.split('::').at(-1)}_${registry}`),
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
                    /** Handle dynamic dispatcher */
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

                    const inner_dispatcher = `${parent_path?.split('::').at(-1)}${this.inner_dispatcher_count++}`

                    return {
                        import: false,
                        name: inner_dispatcher,
                        // TODO
                        module: factory.createTypeAliasDeclaration(
                            undefined,
                            factory.createIdentifier(inner_dispatcher),
                            [
                                factory.createTypeParameterDeclaration(
                                    undefined,
                                    factory.createIdentifier("TYPE"),
                                    factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
                                    undefined
                                ),
                                factory.createTypeParameterDeclaration(
                                    undefined,
                                    factory.createIdentifier("VALUES"),
                                    factory.createTypeReferenceNode(
                                        factory.createIdentifier("Record"),
                                        [
                                            factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
                                            factory.createKeywordTypeNode(ts.SyntaxKind.UnknownKeyword)
                                        ]
                                    ),
                                    undefined
                                )
                            ],
                            factory.createIntersectionTypeNode([
                                factory.createTypeLiteralNode([factory.createPropertySignature(
                                    undefined,
                                    factory.createIdentifier("function"),
                                    undefined,
                                    factory.createTypeReferenceNode(
                                        factory.createIdentifier("LiteralUnion"),
                                        [factory.createTypeReferenceNode(
                                            factory.createIdentifier("TYPE"),
                                            undefined
                                        )]
                                    )
                                )]),
                                factory.createTypeReferenceNode(
                                    factory.createIdentifier("VALUES"),
                                    undefined
                                )
                            ])
                        ),
                        inner_dispatcher: {
                            name: inner_dispatcher,
                            registry: dispatcher.registry
                        },
                    }
                }
            }
        }
    }

    /**
     * TODO: Remember to add this to output!!!
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
    resolveValueType(type: mcdoc.McdocType, parent?: string): {
        type: ts.TypeLiteralNode | ts.TypeReferenceNode | ts.KeywordTypeNode | ts.UnionTypeNode | ts.LiteralTypeNode | ts.ParenthesizedTypeNode | ts.IntersectionTypeNode;
        imports: ts.ImportDeclaration[] | never[];
        modules: (ts.TypeAliasDeclaration | ts.EnumDeclaration)[] | never[];
    } | undefined {
        switch (type.kind) {
            case 'struct':
                return this.createStruct(type, parent || '')
            case 'reference':
                const resolved = this.resolveReference(type, parent)

                return {
                    type: factory.createTypeReferenceNode(factory.createIdentifier(resolved.name), undefined),
                    imports: resolved.import ? [resolved.import] : [],
                    modules: resolved.module ? [resolved.module] : []
                }
            case 'boolean':
                return {
                    type: factory.createKeywordTypeNode(ts.SyntaxKind.BooleanKeyword),
                    imports: [],
                    modules: []
                }
            case 'string':
                return {
                    type: factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
                    imports: [],
                    modules: []
                }
            case 'byte':
                return {
                    type: factory.createTypeReferenceNode('NBTByte'),
                    imports: [this.bindImport('NBTByte', 'sandstone/variables/nbt')],
                    modules: []
                }
            case 'short':
                return {
                    type: factory.createTypeReferenceNode('NBTShort'),
                    imports: [this.bindImport('NBTShort', 'sandstone/variables/nbt')],
                    modules: []
                }
            case 'int':
                return {
                    type: factory.createTypeReferenceNode('NBTInt'),
                    imports: [this.bindImport('NBTInt', 'sandstone/variables/nbt')],
                    modules: []
                }
            case 'long':
                return {
                    type: factory.createTypeReferenceNode('NBTLong'),
                    imports: [this.bindImport('NBTLong', 'sandstone/variables/nbt')],
                    modules: []
                }
            case 'float':
                return {
                    type: factory.createTypeReferenceNode('NBTFloat'),
                    imports: [this.bindImport('NBTFloat', 'sandstone/variables/nbt')],
                    modules: []
                }
            case 'double':
                return {
                    type: factory.createTypeReferenceNode('NBTDouble'),
                    imports: [this.bindImport('NBTDouble', 'sandstone/variables/nbt')],
                    modules: []
                }
            case 'list': {
                const item = this.resolveValueType(type.item, parent)!

                if (type.lengthRange) {
                    const range = this.bindRangedInt(type.lengthRange)
                    if (range) {
                        return {
                            type: factory.createTypeReferenceNode('FixedLengthArray', [item.type, {
                                ...range,
                                _typeNodeBrand: ''
                            }]),
                            imports: [this.bindImport('FixedLengthArray', 'sandstone/utils'), ...item.imports],
                            modules: item.modules
                        }
                    }
                }
                return {
                    type: factory.createTypeReferenceNode('Array', [item.type]),
                    imports: item.imports,
                    modules: item.modules
                }
            }
            case 'byte_array': {
                return {
                    type: factory.createTypeReferenceNode('NBTByteArray'),
                    imports: [this.bindImport('NBTByteArray', 'sandstone/variables/nbt')],
                    modules: []
                }
            }
            case 'int_array': {
                return {
                    type: factory.createTypeReferenceNode('NBTIntArray'),
                    imports: [this.bindImport('NBTIntArray', 'sandstone/variables/nbt')],
                    modules: []
                }
            }
            case 'long_array': {
                return {
                    type: factory.createTypeReferenceNode('NBTLongArray'),
                    imports: [this.bindImport('NBTLongArray', 'sandstone/variables/nbt')],
                    modules: []
                }
            }
            case 'union': {
                const types = type.members.map((type) => this.resolveValueType(type, parent)!)

                return {
                    type: factory.createUnionTypeNode(types.map((type) => type.type)),
                    imports: types.flatMap((type) => type.imports),
                    modules: types.flatMap((type) => type.modules)
                }
            }
            case 'enum': {
                const enum_identifier = factory.createIdentifier(`inlineEnum${this.inline_enum_count++}`) // :husk:

                return {
                    type: factory.createTypeReferenceNode(enum_identifier),
                    imports: [],
                    modules: [this.createEnum(enum_identifier, type)]
                }
            }
            
            case 'literal': {
                switch (type.value.kind) {
                    case 'boolean':
                        return {
                            type: type.value.value ?
                                factory.createLiteralTypeNode(factory.createTrue())
                                : factory.createLiteralTypeNode(factory.createFalse()),
                            imports: [],
                            modules: []
                        }
                    case 'string':
                        return {
                            type: factory.createLiteralTypeNode(factory.createStringLiteral(type.value.value)),
                            imports: [],
                            modules: []
                        }
                    case 'byte': {
                        return {
                            type: factory.createTypeReferenceNode('NBTByte', [{
                                ...this.bindNumericLiteral(type.value.value),
                                _typeNodeBrand: ''
                            }]),
                            imports: [
                                this.bindImport('NBTByte', 'sandstone/variables/nbt')
                            ],
                            modules: []
                        }
                    }
                    case 'short': {
                        return {
                            type: factory.createTypeReferenceNode('NBTShort', [{
                                ...this.bindNumericLiteral(type.value.value),
                                _typeNodeBrand: ''
                            }]),
                            imports: [
                                this.bindImport('NBTShort', 'sandstone/variables/nbt')
                            ],
                            modules: []
                        }
                    }
                    case 'float': {
                        return {
                            type: factory.createTypeReferenceNode('NBTFloat', [{
                                ...this.bindNumericLiteral(type.value.value),
                                _typeNodeBrand: ''
                            }]),
                            imports: [
                                this.bindImport('NBTFloat', 'sandstone/variables/nbt')
                            ],
                            modules: []
                        }
                    }
                    default: // This is a hack, but it works. `double` is the default decimal SNBT value type, `int` is the default integer SNBT value type.
                        return {
                            type: factory.createLiteralTypeNode(this.bindNumericLiteral(type.value.value)),
                            imports: [],
                            modules: []
                        }
                }
            }
            case 'dispatcher': {
                const resolved = this.resolveDispatcher(type, parent)

                console.log(resolved)
            } break
            default: {
                return {
                    type: factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword),
                    imports: [],
                    modules: []
                }
            }
        }
    }

    bindImport(module_name: string, module_path: string) {
        return factory.createImportDeclaration(
            undefined,
            factory.createImportClause(
                true,
                undefined,
                factory.createNamedImports([
                    factory.createImportSpecifier(false, undefined, factory.createIdentifier(module_name))
                ])
            ),
            factory.createStringLiteral(module_path)
        )
    }

    bindNumericLiteral(literal: number) {
        if (Math.sign(literal) === -1) {
            return factory.createPrefixUnaryExpression(
                ts.SyntaxKind.MinusToken,
                factory.createNumericLiteral(Math.abs(literal))
            )
        } else {
            return factory.createNumericLiteral(literal)
        }
    }

    bindRangedInt(range: mcdoc.NumericRange) {
        const rangeString = mcdoc.NumericRange.toString(range)

        if (/^[0-9]+$/.test(mcdoc.NumericRange.toString(range))) {
            return this.bindNumericLiteral(parseInt(rangeString))
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
                    ...this.bindNumericLiteral(i),
                    _typeNodeBrand: ''
                })
            }
            return factory.createUnionTypeNode(values)
        }
    }

    createEnum(name: ts.Identifier, _enum: mcdoc.EnumType) {
        if (_enum.enumKind === 'string') {
            return factory.createEnumDeclaration(
                undefined,
                name,
                _enum.values.map((value) => factory.createEnumMember(value.identifier, factory.createStringLiteral(value.value as string))),
            )
        }
        return factory.createEnumDeclaration(
            undefined,
            name,
            _enum.values.map((value) => factory.createEnumMember(value.identifier, factory.createNumericLiteral(value.value as number))),
        )
    }
}
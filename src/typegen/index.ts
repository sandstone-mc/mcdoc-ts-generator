import type { Service, SymbolMap } from '@spyglassmc/core'
import * as mcdoc from '@spyglassmc/mcdoc'
import ts from 'typescript'

/**
 * Help:
 * - https://ts-ast-viewer.com/
 * - https://stackoverflow.com/questions/67575784/typescript-ast-factory-how-to-use-comments
 */
const { factory } = ts

type DispatcherReferenceCounter = {
    locations: Map<string, number>
    location_counts: [string, number][]
}

type ValueType = ts.TypeLiteralNode | ts.TypeReferenceNode | ts.KeywordTypeNode | ts.UnionTypeNode | ts.LiteralTypeNode | ts.ParenthesizedTypeNode | ts.IntersectionTypeNode | ts.KeywordTypeNode<ts.SyntaxKind.AnyKeyword> | ts.TypeNode

type ResolvedValueType = {
    type: ValueType;
    imports: ts.ImportDeclaration[] | never[];
    modules: (ts.TypeAliasDeclaration | ts.EnumDeclaration)[] | never[];
}

function pascal_case(name: string) {
    const words = name.split('_')
    return words
        .map((word) => word[0].toUpperCase() + word.slice(1))
        .join('')
}

export class TypesGenerator {
    private key_dispatcher_count = 0

    private inline_enum_count = 0

    private inner_dispatcher_count = 0

    private resolved_resources = new Set<string>()

    private resolved_modules = new Map<string, string[]>()

    private dispatcher_references = new Map<string, DispatcherReferenceCounter>()

    private resolved_dispatchers = new Set<string>()

    constructor(private service: Service, private symbols: SymbolMap, private dispatchers: SymbolMap, private module_files: Map<string, ts.TypeAliasDeclaration[]>, private generated_path: string) { }

    last<T extends any[]>(list: T) {
        return list[list.length - 1] as T[number]
    }

    emptyObject = factory.createTypeReferenceNode(
        factory.createIdentifier("Record"),
        [
            factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
            factory.createKeywordTypeNode(ts.SyntaxKind.NeverKeyword)
        ]
    )

    resolveRootTypes(export_name: string, original_file: string, typeDef: mcdoc.McdocType) {
        this.resolved_resources.add(original_file)

        if (typeDef.kind === 'struct') {
            if (typeDef.attributes !== undefined && typeDef.attributes.findIndex((attr: mcdoc.Attribute) => attr.name == 'until') !== -1) {
                return []
            }
            const result = this.createStruct(typeDef, original_file)

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

    resolveDispatcherTypes(generic_name: string, dispatcher: string) {
        const original_type_map = this.dispatchers[dispatcher].members!
        
        const original_type_names = Object.keys(original_type_map)

        let locations = new Map<string, number>()

        let location_counts: [string, number][] = []

        for (const location of original_type_names) {
            const typeDef = (original_type_map[location].data! as any).typeDef as mcdoc.McdocType

            if (typeDef.kind === 'reference') {
                if (!locations.has(typeDef.path!)) {
                    locations.set(typeDef.path!, location_counts.length)

                    location_counts.push([typeDef.path!, 1])
                } else {
                    const index = locations.get(typeDef.path!)!
                    location_counts[index][1]++
                }
            } else if (typeDef.kind === 'concrete' && typeDef.typeArgs.length !== 0) {
                const reference = typeDef.typeArgs.find(arg => arg.kind === 'reference') as mcdoc.ReferenceType | undefined

                if (reference) {
                    if (!locations.has(reference.path!)) {
                        locations.set(reference.path!, location_counts.length)

                        location_counts.push([reference.path!, 1])
                    } else {
                        const index = locations.get(reference.path!)!
                        location_counts[index][1]++
                    }
                }
            }
        }
        let locator: string | undefined = undefined

        if (location_counts.length > 1) {
            if (location_counts.length > 2) {
                location_counts.sort((a, b) => b[1] - a[1])
            }
            locator = location_counts[0][0]
        }

        const resolved_imports: ts.ImportDeclaration[] = []

        const resolved_types: (ts.TypeAliasDeclaration | ts.EnumDeclaration)[] = []

        const mapped_types: ts.PropertySignature[] = []

        let parent: string = ''

        for (const original_type_name of original_type_names) {
            if (this.resolved_dispatchers.has(`${dispatcher}:${original_type_name}`)) {
                continue
            }
            this.resolved_dispatchers.add(`${dispatcher}:${original_type_name}`)

            const definition_path = Object.keys(original_type_map[original_type_name])

            const typeDef = (original_type_map[original_type_name].data! as any).typeDef as mcdoc.McdocType

            if (original_type_name.startsWith('%')) {
                // TODO
                continue
            } else if (locator === undefined) {
                const reference_counter = this.dispatcher_references.get(dispatcher)

                if (reference_counter === undefined) {
                    // TODO
                    //console.warn('[TypesGenerator#resolveDispatcherTypes] Unable to find dispatcher reference counter')
                    continue
                }

                if (reference_counter.location_counts.length === 1) {
                    locator = reference_counter.location_counts[0][0]
                } else if (reference_counter.location_counts.length > 1) {
                    reference_counter.location_counts.sort((a, b) => b[1] - a[1])
                    locator = reference_counter.location_counts[0][0]
                } else {
                    throw new Error('[TypesGenerator#resolveDispatcherTypes] Unable to determine locator for dispatcher type generation')
                }
            }

            parent = locator.split('::').slice(-2)[0]

            if (original_type_name.includes(':')) {
                // TODO
                //console.log(original_type_name)
                throw new Error('[TypesGenerator#resolveDispatcherTypes] Non-minecraft dispatcher types are not yet supported')
            }

            const type_name = `${generic_name}${pascal_case(original_type_name.replace('/', '_'))}`

            

            //console.log(parent)

            const value = this.resolveValueType(typeDef, parent)

            if (value === undefined) {
                // TODO
                continue
                throw new Error(`[TypesGenerator#resolveDispatcherTypes] Unable to resolve dispatcher type: ${original_type_name}@${dispatcher}`)
            }

            resolved_types.push(
                factory.createTypeAliasDeclaration(
                    undefined,
                    factory.createIdentifier(`${type_name}Type`),
                    undefined,
                    value.type
                )
            )

            if (value.imports.length > 0) {
                resolved_imports.push(...value.imports)
            }
            if (value.modules.length > 0) {
                resolved_types.push(...value.modules)
            }

            mapped_types.push(
                factory.createPropertySignature(
                    undefined,
                    factory.createStringLiteral(`${type_name}Type`, true),
                    undefined,
                    factory.createTypeReferenceNode(
                        factory.createIdentifier(`${type_name}Type`),
                        undefined
                    )
                )
            )
        }

        resolved_types.push(
            factory.createTypeAliasDeclaration(
                [factory.createModifier(ts.SyntaxKind.ExportKeyword)],
                factory.createIdentifier(`${generic_name}Type`),
                undefined,
                factory.createTypeLiteralNode(mapped_types)
            )
        )

        resolved_imports.push(this.bindImport('GetKeys', 'sandstone/utils'))

        resolved_types.push(
            factory.createTypeAliasDeclaration(
                [factory.createToken(ts.SyntaxKind.ExportKeyword)],
                factory.createIdentifier(`${generic_name}TypeKeys`),
                undefined,
                factory.createTypeReferenceNode(
                    factory.createIdentifier('GetKeys'),
                    [factory.createTypeReferenceNode(
                        factory.createIdentifier(`${generic_name}Type`),
                        undefined
                    )]
                )
            )
        )

        if (this.resolved_resources.has(parent)) {
            return {
                imports: resolved_imports.length !== 0 ? resolved_imports : (false as false),
                types: resolved_types,
                locator
            }
        }
    }

    createStruct(typeDef: mcdoc.StructType, parent: string) {
        const anyFallback = factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword)

        const member_types: (ts.IndexSignatureDeclaration | ts.PropertySignature)[] = []

        const intersection_types: ValueType[] = []

        const imports: ts.ImportDeclaration[] = []

        const modules: (ts.TypeAliasDeclaration | ts.EnumDeclaration)[] = []

        const inner_dispatchers: {
            name: string;
            registry: `${string}:${string}`;
        }[] = []

        for (const field of typeDef.fields) {
            /** Skip all removed fields */
            if (field.attributes !== undefined && field.attributes.findIndex((attr: mcdoc.Attribute) => attr.name == 'until') !== -1) {
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
                        value as ts.TypeNode
                    )
                    /** Key has dynamic properties to it */
                } else if (field.key.kind === 'string') {
                    /** Key is proceeded by `minecraft:` but isn't derived from a registry or enum, in vanilla-mcdoc is only followed by a struct */
                    if (field.key.attributes !== undefined && field.key.attributes.findIndex((attr: mcdoc.Attribute) => attr.name === 'id') !== -1) {
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
                            } else if (resolved.modules) {
                                modules.push(...resolved.modules)
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

                if (spread.attributes !== undefined && spread.attributes.findIndex((attr: mcdoc.Attribute) => attr.name == 'until') !== -1) {
                    continue
                }

                switch (spread.type.kind) {
                    case 'reference': {
                        const reference = this.resolveReference(spread.type, parent)

                        if (reference.import !== false) {
                            imports.push(reference.import)
                        } else if (reference.modules !== false) {
                            modules.push(...reference.modules)
                        }

                        intersection_types.push(factory.createTypeReferenceNode(
                            factory.createIdentifier(reference.name),
                            undefined
                        ))
                    } break
                    case 'struct': {
                        // TODO
                        //console.log(spread)
                        if (spread.type.attributes !== undefined && spread.type.attributes.findIndex((attr: mcdoc.Attribute) => attr.name == 'until') !== -1) {
                            continue
                        }
                        if (spread.type.fields.length === 0) {
                            continue
                        }

                        const struct = this.createStruct(spread.type, parent)

                        if (struct.imports.length > 0) {
                            imports.push(...struct.imports)
                        }
                        if (struct.modules.length > 0) {
                            modules.push(...struct.modules)
                        }
                        if (Object.hasOwn(struct.type, 'members') === true) {
                            const members = (struct.type as any).members as (ts.IndexSignatureDeclaration | ts.PropertySignature)[]
                            member_types.push(...members)
                        } else {
                            intersection_types.push(struct.type)
                        }
                    } break
                    case 'dispatcher': {
                        const _value = this.resolveDispatcher(spread.type, parent)

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

                            intersection_types.push(factory.createTypeReferenceNode(
                                typeof _value.name === 'string' ? _value.name : `dispatcher_${this.key_dispatcher_count++}`,
                                undefined
                            ))
                        }
                    } break
                    default: {
                        // TODO
                        //console.log(parent)
                        // console.log(spread.type)
                    }
                }
                
            }
        }

        /* @ts-ignore */
        if (member_types.length === 0) {
            if (typeDef.fields.length === 0) {
                return {
                    type: this.emptyObject,
                    imports,
                    modules
                }
            } else {
                // TODO
                //console.log(typeDef, parent, '#279')
            }
        }

        if (inner_dispatchers.length !== 0) {
            if (intersection_types.length !== 0) {
                // yikes
            }
            if (inner_dispatchers.length === 1) {
                return {
                    /* @ts-ignore */ // TODO
                    type: factory.createParenthesizedType(factory.createUnionTypeNode(Object.keys(this.dispatchers[inner_dispatchers[0].registry].members).map((registry_item) => {
                        return factory.createTypeReferenceNode(
                            factory.createIdentifier(`${inner_dispatchers[0].name}Joined`),
                            [
                              factory.createLiteralTypeNode(factory.createStringLiteral(registry_item, true)),
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
            if (member_types.length !== 0) {
                intersection_types.unshift(factory.createTypeLiteralNode(member_types))
            }

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
        { import: false, name: string, modules: ts.TypeAliasDeclaration[] | false } |
        { import: ts.ImportDeclaration, name: string, modules: false }
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

        const resolve_module = () => this.resolveRootTypes(ref_name, ref_path[ref_path.length - 2], (this.symbols[ref.path!].data! as any).typeDef as mcdoc.McdocType)

        /** Determine whether to embed the referenced module in the same file */
        
        if (ref_path[ref_path.length - 2] === parent) {
            const module = resolve_module()
            return {
                import: false,
                name: ref_name,
                modules: module as ts.TypeAliasDeclaration[]
            }
        } else {
            // TODO
            //console.log(ref_path[ref_path.length - 2], parent)
        }

        const module_path = `${this.generated_path.split('/').slice(1).join('/')}/${location}/index.ts`

        const module_import = this.bindImport(ref_name, module_path)

        if (this.resolved_modules.has(location) && this.resolved_modules.get(location)!.includes(module_path)) return {
            import: module_import,
            name: ref_name,
            modules: false
        }
        const module = resolve_module()

        if (!this.resolved_modules.has(location)) {
            this.resolved_modules.set(location, [module_path])

            if (module[0] !== undefined) {
                this.module_files.set(location, module as ts.TypeAliasDeclaration[])
            }

            return {
                import: module_import,
                name: ref_name,
                modules: false
            }
        }

        this.resolved_modules.get(location)!.push(module_path)

        if (module[0] !== undefined) {
            if (!this.module_files.has(location)) {
                this.module_files.set(location, module as ts.TypeAliasDeclaration[])
            } else {
                this.module_files.get(location)!.push(...(module as ts.TypeAliasDeclaration[]))
            }
        }

        return {
            import: module_import,
            name: ref_name,
            modules: false
        }
    }

    resolveDispatcher(dispatcher: mcdoc.DispatcherType, parent_path: string) {
        if (this.dispatcher_references.has(dispatcher.registry) === false) {
            this.dispatcher_references.set(dispatcher.registry, {
                locations: new Map<string, number>(),
                location_counts: []
            })
        }
        const dispatcher_counter = this.dispatcher_references.get(dispatcher.registry)!

        if (!dispatcher_counter.locations.has(parent_path)) {
            dispatcher_counter.locations.set(parent_path, dispatcher_counter.location_counts.length)
            dispatcher_counter.location_counts.push([parent_path, 1])
        } else {
            const index = dispatcher_counter.locations.get(parent_path)!
            dispatcher_counter.location_counts[index][1]++
        }
        
        const index = dispatcher.parallelIndices[0]

        if (index.kind === 'static') {
            const module_import = this.bindImport(index.value, this.generated_path + `/${dispatcher.registry.split(':')[1]}/${index.value}.ts`)
            return {
                import: module_import,
                name: index.value,
                module: false
            }
        } else {
            if (typeof index.accessor[0] === 'object') {
                if (index.accessor[0].keyword === 'key') {
                    const registry = dispatcher.registry.replaceAll('/', '_').split(':')[1]
                    const registry_import = this.bindImport(registry, this.generated_path + `/${dispatcher.registry.split(':')[1]}/index.ts`)

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
    resolveValueType(type: mcdoc.McdocType, parent: string): ResolvedValueType | undefined {
        switch (type.kind) {
            case 'struct':
                return this.createStruct(type, parent || '')
            case 'reference':
                const resolved = this.resolveReference(type, parent)

                return {
                    type: factory.createTypeReferenceNode(factory.createIdentifier(resolved.name), undefined),
                    imports: resolved.import ? [resolved.import] : [],
                    modules: resolved.modules ? resolved.modules : []
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
                // TODO: Fix what is getting returned as undefined from resolveValueType
                const item = this.resolveValueType(type.item, parent) || {
                    type: factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword),
                    imports: [],
                    modules: []
                }

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
                const types: ResolvedValueType[] = []
                for (const member_type of type.members) {
                    if (member_type.attributes !== undefined && member_type.attributes.findIndex((attr: mcdoc.Attribute) => attr.name == 'until') !== -1) {
                        continue
                    }
                    const resolved_union_member = this.resolveValueType(member_type, parent)

                    if (resolved_union_member === undefined) {
                        continue
                    }

                    types.push(resolved_union_member)
                }

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
                            type: factory.createLiteralTypeNode(factory.createStringLiteral(type.value.value, true)),
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

                //console.log(resolved)
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
            factory.createStringLiteral(module_path, true)
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
                _enum.values.map((value) => factory.createEnumMember(value.identifier, factory.createStringLiteral(value.value as string, true))),
            )
        }
        return factory.createEnumDeclaration(
            undefined,
            name,
            _enum.values.map((value) => factory.createEnumMember(value.identifier, factory.createNumericLiteral(value.value as number))),
        )
    }
}
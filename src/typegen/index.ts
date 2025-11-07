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
    type: ValueType
    imports: ts.ImportDeclaration[] | never[]
    modules: (ts.TypeAliasDeclaration | ts.EnumDeclaration | ts.ImportDeclaration)[] | never[]
    doc?: string[]
}

type ResourceContent = {
    target_path: string
    types: (ts.TypeAliasDeclaration | ts.ImportDeclaration | ts.EnumDeclaration)[]
}

// fuck you windows
const join = (...paths: string[]) => paths.join('/')

function pascal_case(name: string) {
    const words = name.split('_')
    return words
        .map((word) => word[0].toUpperCase() + word.slice(1))
        .join('')
}

function camel_case(name: string) {
    const words = name.split('_')
    if (words.length === 1) return name
    return words[0] + words
        .slice(1)
        .map((word) => word[0].toUpperCase() + word.slice(1))
        .join('')
}

const reference_meme = new Map<string, number>()

let current_file = ''

export class TypesGenerator {
    private key_dispatcher_count = 0

    private inline_enum_count = 0

    private inner_dispatcher_count = 0

    private readonly resolved_resources = new Set<string>()

    private readonly resolved_references = new Map<string, { name: string, import: ts.ImportDeclaration, path: string }>()

    private readonly dispatcher_references = new Map<string, DispatcherReferenceCounter>()

    private readonly resolved_dispatchers = new Set<string>()

    constructor(
        private service: Service,
        private symbols: SymbolMap,
        private dispatchers: SymbolMap,
        private module_files: Map<string, Record<string, ts.TypeAliasDeclaration | ts.EnumDeclaration | ts.ImportDeclaration>>,
        private generated_path: string,
        private resource_contents: Map<string, ResourceContent>,
        private sub_resource_map: Map<string, string>
    ) { }

    /**
     * Helper to add a key-value pair to an object if the value is not undefined.
     * 
     * Unfortunately TypeScript doesn't properly support empty object types, even with this attempted workaround, we still get `{ (key): (value) | undefined }` instead of `{ (key): (value) } | Record<string, never>`.
     *
     * @returns An object with the key-value pair if the value is not undefined, otherwise an empty object.
     */
    add<K extends string, V extends NonNullable<any>>(key: K, value: V): {[P in K]: V}
    add<K extends string, V extends undefined>(key: K, value: V): Record<string, never>
    add(key: string, value: any) {
        if (value === undefined) {
            return {}
        } else {
            return { [key]: value }
        }
    }

    emptyObject = factory.createTypeReferenceNode(
        factory.createIdentifier("Record"),
        [
            factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
            factory.createKeywordTypeNode(ts.SyntaxKind.NeverKeyword)
        ]
    )

    resolveRootTypes(export_name: string, original_symbol: string, target_path: string, typeDef: mcdoc.McdocType) {
        this.resolved_resources.add(original_symbol)

        if (typeDef.attributes !== undefined && typeDef.attributes.findIndex((attr: mcdoc.Attribute) => attr.name == 'until') !== -1) {
            return []
        }

        switch (typeDef.kind) {
            case 'enum': {
                return [ this.createEnum(factory.createIdentifier(export_name), typeDef)]
            }
            default: {
                const resolved = this.resolveValueType(typeDef, original_symbol, target_path)

                if (resolved === undefined) {
                    return []
                }

                const type_alias = factory.createTypeAliasDeclaration(
                    [factory.createModifier(ts.SyntaxKind.ExportKeyword)],
                    factory.createIdentifier(export_name),
                    undefined,
                    resolved.type,
                )

                if (resolved.modules.length !== 0) {
                    for (const module of resolved.modules) {
                        if (!this.module_files.has(target_path)) {
                            this.module_files.set(target_path, {})
                        }
                        if (ts.isImportDeclaration(module)) {
                            this.module_files.get(target_path)![`${(module.moduleSpecifier as ts.StringLiteral).text.slice(0,-3)}@${(module.importClause!.namedBindings as ts.NamedImports).elements[0]!.name.text}`] = module
                        } else {
                            this.module_files.get(target_path)![module.name.text] = module
                        }
                    }
                }

                return [
                    ...resolved.imports,
                    type_alias,
                ]
            }
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
                const path = typeDef.path!.replace(/\:\:\w+$/, '')
                if (!locations.has(path)) {
                    locations.set(path, location_counts.length)

                    location_counts.push([path, 1])
                } else {
                    const index = locations.get(path)!
                    location_counts[index][1]++
                }
            } else if (typeDef.kind === 'concrete' && typeDef.typeArgs.length !== 0) {
                const reference = typeDef.typeArgs.find(arg => arg.kind === 'reference') as mcdoc.ReferenceType | undefined

                if (reference) {
                    const path = reference.path!.replace(/\:\:\w+$/, '')
                    if (!locations.has(path)) {
                        locations.set(path, location_counts.length)

                        location_counts.push([path, 1])
                    } else {
                        const index = locations.get(path)!
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

        const resolved_types: (ts.TypeAliasDeclaration | ts.EnumDeclaration | ts.ImportDeclaration)[] = []

        const mapped_types: ts.PropertySignature[] = []

        let target_path: string | undefined = undefined

        let parent_module: Record<string, ts.ImportDeclaration | ts.TypeAliasDeclaration | ts.EnumDeclaration> | undefined = undefined

        if (locator === undefined) {
            const reference_counter = this.dispatcher_references.get(dispatcher)

            if (reference_counter !== undefined) {
                if (reference_counter.location_counts.length === 1) {
                    locator = reference_counter.location_counts[0][0]
                } else {
                    reference_counter.location_counts.sort((a, b) => b[1] - a[1])
                    locator = reference_counter.location_counts[0][0]
                }
                const resource = this.resource_contents.get(locator) ?? this.resource_contents.get(this.sub_resource_map.get(locator) ?? '')
                if (resource === undefined) {
                    const reference = this.resolved_references.get(locator)

                    if (reference === undefined) {
                        throw new Error(`[TypesGenerator#resolveDispatcherTypes] Unable to find place for dispatcher locator: ${locator}`)
                    }
                    const module_path = reference.path

                    if (module_path === undefined) {
                        throw new Error(`[TypesGenerator#resolveDispatcherTypes] Unable to find place for dispatcher locator: ${locator}`)
                    } else {
                        parent_module = this.module_files.get(module_path)

                        target_path = module_path
                    }
                } else {
                    target_path = resource.target_path
                }
            } else {
                const [dispatcher_namespace, dispatcher_name] = dispatcher.replaceAll('/', '_').split(':')

                target_path = join('dispatchers', dispatcher_namespace, camel_case(dispatcher_name))

                locator = `::java::dispatchers::${dispatcher_namespace}::${dispatcher_name}::${generic_name}`
            }
        } else {
            const resource = this.resource_contents.get(locator)

            if (resource !== undefined) {
                target_path = resource.target_path
            } else {
                target_path = join(...locator.split('::').slice(2))
            }
        }

        for (const original_type_name of original_type_names) {
            if (this.resolved_dispatchers.has(`${dispatcher}:${original_type_name}`)) {
                continue
            }
            this.resolved_dispatchers.add(`${dispatcher}:${original_type_name}`)

            const typeDef = (original_type_map[original_type_name].data! as any).typeDef as mcdoc.McdocType

            if (original_type_name.startsWith('%')) {
                // TODO
                continue
            }

            if (original_type_name.includes(':')) {
                // TODO
                //console.log(original_type_name)
                throw new Error('[TypesGenerator#resolveDispatcherTypes] Non-minecraft dispatcher types are not yet supported')
            }

            const type_name = `${generic_name}${pascal_case(original_type_name.replace('/', '_'))}`

            const value = this.resolveValueType(typeDef, locator, target_path)

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
                    factory.createStringLiteral(`${original_type_name}`, true),
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

        if (parent_module !== undefined) {
            for (const type of resolved_types) {
                if (ts.isImportDeclaration(type)) {
                    parent_module[`${(type.moduleSpecifier as ts.StringLiteral).text.slice(0,-3)}@${(type.importClause!.namedBindings as ts.NamedImports).elements[0]!.name.text}`] = type
                } else {
                    parent_module[type.name.text] = type
                }
            }

            for (const imp of resolved_imports) {
                parent_module[`${(imp.moduleSpecifier as ts.StringLiteral).text.slice(0,-3)}@${(imp.importClause!.namedBindings as ts.NamedImports).elements[0]!.name.text}`] = imp
            }

            return {
                imports: (false as false),
                types: [],
                target_path
            }
        }

        return {
            imports: resolved_imports,
            types: resolved_types,
            target_path
        }
    }

    createStruct(typeDef: mcdoc.StructType, original_symbol: string, target_path: string) {
        const anyFallback = factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword)

        const member_types: (ts.IndexSignatureDeclaration | ts.PropertySignature)[] = []

        const intersection_types: ValueType[] = []

        const imports: ts.ImportDeclaration[] = []

        const modules: (ts.TypeAliasDeclaration | ts.EnumDeclaration | ts.ImportDeclaration)[] = []

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
                let value: ValueType | undefined = undefined

                const optional = field.optional ? factory.createToken(ts.SyntaxKind.QuestionToken) : undefined

                /** Build the pair */

                if (typeof field.key !== 'string' && field.key.kind === 'union') {
                    const key_options: mcdoc.McdocType[] = []

                    for (const member of field.key.members) {
                        if (member.attributes !== undefined && member.attributes.findIndex((attr: mcdoc.Attribute) => attr.name == 'until') !== -1) {
                            continue
                        }
                        key_options.push(member)
                    }

                    if (key_options.length === 1) {
                        field.key = key_options[0]
                    } else {
                        throw new Error(`Funky key: ${JSON.stringify(key_options, null, 2)}`)
                    }
                }

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
                            const struct = this.createStruct(field.type, original_symbol, target_path)

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
                            const struct = this.createStruct(field.type, original_symbol, target_path)

                            if (struct.imports.length > 0) {
                                imports.push(...struct.imports)
                            }
                            if (struct.modules.length > 0) {
                                modules.push(...struct.modules)
                            }

                            value = struct.type
                        } else if (field.type.kind === 'reference') {
                            const existing = this.resolved_references.get(field.type.path!)
                            if (existing !== undefined) {
                                value = factory.createTypeReferenceNode(factory.createIdentifier(existing.name))

                                if (target_path !== existing.path) {
                                    imports.push(existing.import)
                                }
                            } else {
                                if (original_symbol === undefined) {
                                    console.log('createStruct-valueType', typeDef, field.type, target_path)
                                }
                                const resolved = this.resolveReference(field.type, original_symbol, target_path)

                                value = factory.createTypeReferenceNode(factory.createIdentifier(resolved.name))

                                if (resolved.import) {
                                    imports.push(resolved.import)
                                } else if (resolved.modules) {
                                    modules.push(...resolved.modules)
                                }
                            }
                        }
                    }
                    /** Key is a dispatcher  */
                } else if (field.key.kind === 'dispatcher') {
                    const _value = this.resolveDispatcher(field.key, original_symbol, target_path)

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
                    const resolve = this.resolveValueType(field.type, original_symbol, target_path)!

                    value = factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword)

                    if (resolve.imports?.length > 0) {
                        imports.push(...resolve.imports)
                    }

                    if (resolve.modules?.length > 0) {
                        modules.push(...resolve.modules)
                    }

                    // @ts-ignore
                    if (field.key.path === undefined) {
                        console.log(JSON.stringify(field.key, null, 2))
                        throw new Error('what?')
                    }

                    key = (value) => factory.createIndexSignature(
                        undefined,
                        [
                            factory.createParameterDeclaration(
                                undefined,
                                undefined,
                                factory.createIdentifier((field.key as mcdoc.ReferenceType).path!.split('::').at(-1)!),
                                optional,
                                value,
                            )
                        ],
                        resolve.type,
                    )
                }

                /* @ts-ignore */
                if (key !== undefined) {
                    if (value !== undefined) {
                        member_types.push(this.bindDoc(key(value), field))
                    } else {
                        const resolved = this.resolveValueType(field.type, original_symbol, target_path) || {
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
                        member_types.push(this.bindDoc(key(resolved.type), field))
                    }
                }
            } else if (field.kind === 'spread') {
                const spread = field as mcdoc.StructTypeSpreadField

                if (spread.attributes !== undefined && spread.attributes.findIndex((attr: mcdoc.Attribute) => attr.name == 'until') !== -1) {
                    continue
                }

                switch (spread.type.kind) {
                    case 'reference': {
                        const existing = this.resolved_references.get(spread.type.path!)
                        if (existing !== undefined) {
                            intersection_types.push(factory.createTypeReferenceNode(
                                factory.createIdentifier(existing.name),
                                undefined
                            ))
                            if (target_path !== existing.path) {
                                imports.push(existing.import)
                            }
                        } else {
                            if (original_symbol === undefined) {
                                console.log('createStruct-spread', typeDef, spread.type, target_path)
                            }
                            const resolved = this.resolveReference(spread.type, original_symbol, target_path)

                            if (resolved.import !== false) {
                                imports.push(resolved.import)
                            } else if (resolved.modules !== false) {
                                modules.push(...resolved.modules)
                            }

                            intersection_types.push(factory.createTypeReferenceNode(
                                factory.createIdentifier(resolved.name),
                                undefined
                            ))
                        }
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

                        const struct = this.createStruct(spread.type, original_symbol, target_path)

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
                        const _value = this.resolveDispatcher(spread.type, original_symbol, target_path)

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
                type: factory.createParenthesizedType(factory.createIntersectionTypeNode(intersection_types)),
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

    /** 
     * Warning: Only call if the reference is not available in this.resolved_references!
     */
    resolveReference(ref: mcdoc.ReferenceType, original_symbol: string, target_path: string): (
        { import: false, name: string, modules: (ts.TypeAliasDeclaration | ts.EnumDeclaration | ts.ImportDeclaration)[] | false } |
        { import: ts.ImportDeclaration, name: string, modules: false }
    ) {
        const ref_path = ref.path!.split('::').slice(2)
        if (ref_path[0] === 'data') {
            ref_path[0] = 'datapack'
        } else if (ref_path[0] === 'assets') {
            ref_path[0] = 'resourcepack'
        }
        const ref_name = ref_path.at(-1)!
        /** Determine whether to embed the referenced module in the same file */
        if (original_symbol === undefined) {
            console.log(ref, target_path)
        }
        const embed_module = ref.path?.replace(/\:\:\w+$/, '') === original_symbol.replace(/\:\:\w+$/, '')

        const location = embed_module ? target_path : `${ref_path.slice(0, -2).join('/')}/${camel_case(ref_path.at(-2)!)}`

        const module_path = `${this.generated_path.split('/').slice(1).join('/')}/${location}.ts`

        const module_import = this.bindImport(ref_name,  module_path)

        this.resolved_references.set(ref.path!, {
            import: module_import,
            name: ref_name,
            path: location
        })

        const resolved_module = this.resolveRootTypes(ref_name, ref.path!, location, (this.symbols[ref.path!].data! as any).typeDef as mcdoc.McdocType)

        if (embed_module) {
            return {
                import: false,
                name: ref_name,
                modules: resolved_module as ts.TypeAliasDeclaration[]
            }
        }

        if (resolved_module[0] !== undefined) {
            if (!this.module_files.has(location)) {
                this.module_files.set(location, Object.fromEntries(resolved_module.map((m) => {
                    if (ts.isImportDeclaration(m)) {
                        return [`${(m.moduleSpecifier as ts.StringLiteral).text}@${(m.importClause!.namedBindings as ts.NamedImports).elements[0]!.name.text}`, m]
                    } else {
                        return [m.name.text, m]
                    }
                })))
            } else {
                const existing_modules = this.module_files.get(location)!

                for (const m of resolved_module) {
                    if (ts.isImportDeclaration(m)) {
                        existing_modules[`${(m.moduleSpecifier as ts.StringLiteral).text.slice(0,-3)}@${(m.importClause!.namedBindings as ts.NamedImports).elements[0]!.name.text}`] = m
                    } else {
                        existing_modules[m.name.text] = m
                    }
                }
            }
        }

        return {
            import: module_import,
            name: ref_name,
            modules: false
        }
    }

    resolveDispatcher(dispatcher: mcdoc.DispatcherType, original_symbol: string, target_path: string) {
        if (this.dispatcher_references.has(dispatcher.registry) === false) {
            this.dispatcher_references.set(dispatcher.registry, {
                locations: new Map<string, number>(),
                location_counts: []
            })
        }
        const dispatcher_counter = this.dispatcher_references.get(dispatcher.registry)!

        if (!dispatcher_counter.locations.has(original_symbol)) {
            dispatcher_counter.locations.set(original_symbol, dispatcher_counter.location_counts.length)
            dispatcher_counter.location_counts.push([original_symbol, 1])
        } else {
            const index = dispatcher_counter.locations.get(original_symbol)!
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
                            ts.factory.createIdentifier(`${original_symbol?.split('::').at(-1)}_${registry}`),
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

                    const inner_dispatcher = `${original_symbol?.split('::').at(-1)}${this.inner_dispatcher_count++}`

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
                            factory.createParenthesizedType(factory.createIntersectionTypeNode([
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
                            ]))
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

    resolveValueType(type: mcdoc.McdocType, original_symbol: string, target_path: string): ResolvedValueType {
        let doc_value: string[] = []
        const doc = () => this.add('doc', doc_value.length !== 0 ? doc_value : undefined)

        const meme = reference_meme.get(target_path) ?? 0

        reference_meme.set(target_path, meme + 1)

        //console.log('\n\n')
        /* @ts-ignore */
        //console.log(JSON.stringify(type, null, 2))

        // TODO: implement special case value range handling
        if (Object.hasOwn(type, 'valueRange')) {
            const rangedType = type as (mcdoc.NumericType & { valueRange: mcdoc.NumericRange})

            const beginExclusive = mcdoc.RangeKind.isLeftExclusive(rangedType.valueRange.kind)

            const endExclusive = mcdoc.RangeKind.isRightExclusive(rangedType.valueRange.kind)

            let exceptions: string = ''

            if (beginExclusive && endExclusive) {
                exceptions = ` Excludes minimum & maximum values of ${rangedType.valueRange.min} & ${rangedType.valueRange.max}.`
            } else if (beginExclusive && !endExclusive) {
                exceptions = ` Excludes minimum value of ${rangedType.valueRange.min}.`
            } else if (endExclusive) {
                exceptions = ` Excludes maximum value of ${rangedType.valueRange.max}.`
            }

            doc_value = [
                `Accepts ${pascal_case(rangedType.kind)} values of (${mcdoc.NumericRange.toString(rangedType.valueRange)}).${exceptions}`
            ]
        }

        switch (type.kind) {
            case 'struct':
                return this.createStruct(type, original_symbol, target_path)
            case 'reference': {
                const existing = this.resolved_references.get(type.path!)
                if (existing !== undefined) {
                    if (target_path === existing.path) {
                        return {
                            type: factory.createTypeReferenceNode(factory.createIdentifier(existing.name), undefined),
                            imports: [],
                            modules: []
                        }
                    } else {
                        return {
                            type: factory.createTypeReferenceNode(factory.createIdentifier(existing.name), undefined),
                            imports: [existing.import],
                            modules: []
                        }
                    }
                } else {
                    if (original_symbol === undefined) {
                        console.log('resolveValueType', type, target_path)
                    }
                    const resolved = this.resolveReference(type, original_symbol, target_path)

                    return {
                        type: factory.createTypeReferenceNode(factory.createIdentifier(resolved.name), undefined),
                        imports: resolved.import ? [resolved.import] : [],
                        modules: resolved.modules ? resolved.modules : []
                    }
                }
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
            case 'byte': {
                let _type = factory.createTypeReferenceNode('NBTByte')

                let imports = [this.bindImport('NBTByte', 'sandstone/variables/nbt')]

                if (type.valueRange !== undefined) {
                    const range = this.bindRangedWholeNumber(type.valueRange, 'value')

                    switch (range.type) {
                        case 'closed':
                            _type = factory.createTypeReferenceNode('RangedNBTByte', [
                                factory.createLiteralTypeNode(this.bindNumericLiteral(type.valueRange.min!)),
                                factory.createLiteralTypeNode(this.bindNumericLiteral(type.valueRange.max!))
                            ])
                            imports = [this.bindImport('RangedNBTByte', 'sandstone/variables/nbt')]
                            break
                        case 'non-empty':
                            _type = factory.createTypeReferenceNode('NonZeroNBTByte')
                            imports = [this.bindImport('NonZeroNBTByte', 'sandstone/variables/nbt')]
                            break
                    }
                }
                return {
                    type: _type,
                    imports,
                    modules: [],
                    ...doc()
                }
            }
            case 'short': {
                let _type = factory.createTypeReferenceNode('NBTShort')

                let imports = [this.bindImport('NBTShort', 'sandstone/variables/nbt')]

                if (type.valueRange !== undefined) {
                    const range = this.bindRangedWholeNumber(type.valueRange, 'value')

                    switch (range.type) {
                        case 'closed':
                            _type = factory.createTypeReferenceNode('RangedNBTShort', [
                                factory.createLiteralTypeNode(this.bindNumericLiteral(type.valueRange.min!)),
                                factory.createLiteralTypeNode(this.bindNumericLiteral(type.valueRange.max!))
                            ])
                            imports = [this.bindImport('RangedNBTShort', 'sandstone/variables/nbt')]
                            break
                        case 'non-empty':
                            _type = factory.createTypeReferenceNode('NonZeroNBTShort')
                            imports = [this.bindImport('NonZeroNBTShort', 'sandstone/variables/nbt')]
                            break
                    }
                }
                return {
                    type: _type,
                    imports,
                    modules: [],
                    ...doc()
                }
            }
            case 'int': {
                let _type = factory.createTypeReferenceNode('NBTInt')

                let imports = [this.bindImport('NBTInt', 'sandstone/variables/nbt')]

                if (type.valueRange !== undefined) {
                    const range = this.bindRangedWholeNumber(type.valueRange, 'value')

                    switch (range.type) {
                        case 'closed':
                            _type = factory.createTypeReferenceNode('RangedNBTInt', [
                                factory.createLiteralTypeNode(this.bindNumericLiteral(type.valueRange.min!)),
                                factory.createLiteralTypeNode(this.bindNumericLiteral(type.valueRange.max!))
                            ])
                            imports = [this.bindImport('RangedNBTInt', 'sandstone/variables/nbt')]
                            break
                        case 'non-empty':
                            _type = factory.createTypeReferenceNode('NonZeroNBTInt')
                            imports = [this.bindImport('NonZeroNBTInt', 'sandstone/variables/nbt')]
                            break
                    }
                }
                return {
                    type: _type,
                    imports,
                    modules: [],
                    ...doc()
                }
            }
            case 'long': {
                let _type = factory.createTypeReferenceNode('NBTLong')

                let imports = [this.bindImport('NBTLong', 'sandstone/variables/nbt')]

                if (type.valueRange !== undefined) {
                    const range = this.bindRangedWholeNumber(type.valueRange, 'value')

                    switch (range.type) {
                        case 'closed':
                            _type = factory.createTypeReferenceNode('RangedNBTLong', [
                                factory.createLiteralTypeNode(this.bindNumericLiteral(type.valueRange.min!)),
                                factory.createLiteralTypeNode(this.bindNumericLiteral(type.valueRange.max!))
                            ])
                            imports = [this.bindImport('RangedNBTLong', 'sandstone/variables/nbt')]
                            break
                        case 'non-empty':
                            _type = factory.createTypeReferenceNode('NonZeroNBTLong')
                            imports = [this.bindImport('NonZeroNBTLong', 'sandstone/variables/nbt')]
                            break
                    }
                }
                return {
                    type: _type,
                    imports,
                    modules: [],
                    ...doc()
                }
            }
            case 'float':
                return {
                    type: factory.createTypeReferenceNode('NBTFloat'),
                    imports: [this.bindImport('NBTFloat', 'sandstone/variables/nbt')],
                    modules: [],
                    ...doc()
                }
            case 'double':
                return {
                    type: factory.createTypeReferenceNode('NBTDouble'),
                    imports: [this.bindImport('NBTDouble', 'sandstone/variables/nbt')],
                    modules: [],
                    ...doc()
                }
            case 'list': {
                // TODO: Fix what is getting returned as undefined from resolveValueType (its dispatchers)
                const item = this.resolveValueType(type.item, original_symbol, target_path) || {
                    type: factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword),
                    imports: [],
                    modules: []
                }

                if (type.lengthRange) {
                    const range = this.bindRangedWholeNumber(type.lengthRange, 'list')
                    switch (range.type) {
                        case 'static':
                            return {
                                type: factory.createTypeReferenceNode('FixedLengthList', [
                                    item.type,
                                    factory.createLiteralTypeNode(factory.createNumericLiteral(range.value))
                                ]),
                                imports: [this.bindImport('FixedLengthList', 'sandstone/utils'), ...item.imports],
                                modules: item.modules
                            }
                        case 'closed':
                            return {
                                type: factory.createTypeReferenceNode('RangedList', [
                                    item.type,
                                    factory.createLiteralTypeNode(factory.createNumericLiteral(type.lengthRange.min!)),
                                    factory.createLiteralTypeNode(factory.createNumericLiteral(type.lengthRange.max!))
                                ]),
                                imports: [this.bindImport('RangedList', 'sandstone/utils'), ...item.imports],
                                modules: item.modules
                            }
                        case 'non-empty':
                            return {
                                type: factory.createTypeReferenceNode('NonEmptyList', [item.type]),
                                imports: [this.bindImport('NonEmptyList', 'sandstone/utils'), ...item.imports],
                                modules: item.modules,
                                doc: [range.doc]
                            }
                        case 'unbounded':
                            return {
                                type: factory.createTypeReferenceNode('Array', [item.type]),
                                imports: item.imports,
                                modules: item.modules,
                                doc: [range.doc]
                            }
                    }
                }
                return {
                    type: factory.createTypeReferenceNode('Array', [item.type]),
                    imports: item.imports,
                    modules: item.modules
                }
            }
            // TODO: Implement range/size support for these
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
                const members: ts.TypeNode[] = []
                const imports: ts.ImportDeclaration[] = []
                const modules: (ts.TypeAliasDeclaration | ts.EnumDeclaration | ts.ImportDeclaration)[] = []
                for (const member_type of type.members) {
                    if (member_type.attributes !== undefined && member_type.attributes.findIndex((attr: mcdoc.Attribute) => attr.name == 'until') !== -1) {
                        continue
                    }
                    const resolved_union_member = this.resolveValueType(member_type, original_symbol, target_path)

                    if (resolved_union_member === undefined) {
                        continue
                    }

                    members.push(resolved_union_member.type)
                    if (resolved_union_member.imports.length > 0) {
                        imports.push(...resolved_union_member.imports)
                    }
                    if (resolved_union_member.modules.length > 0) {
                        modules.push(...resolved_union_member.modules)
                    }
                }

                if (members.length === 1) {
                    return {
                        type: members[0],
                        imports,
                        modules
                    }
                }

                if (members.length === 0) {
                    return {
                        type: factory.createKeywordTypeNode(ts.SyntaxKind.NeverKeyword),
                        imports,
                        modules
                    }
                }

                return {
                    type: factory.createParenthesizedType(factory.createUnionTypeNode(members)),
                    imports,
                    modules
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
                // TODO: Add support for literal generic for these NBT primitives in Sandstone
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
            // TODO
            /* case 'dispatcher': {
            } break */
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

    /**
     * TODO: Remember to add these to Sandstone Utils & implement equivalents in NBT types!!!
     * https://discord.com/channels/800035701243772969/800035701751676974/1434784900178903111
     */
    bindRangedWholeNumber(range: mcdoc.NumericRange, type: 'value' | 'list' | 'array'): (
        | { type: 'static'; value: number }
        | { type: 'closed' }
        | { type: 'unbounded'; doc: string }
        | { type: 'non-empty'; doc: string }
    ) {
        const rangeString = mcdoc.NumericRange.toString(range)

        if (/^[0-9]+$/.test(mcdoc.NumericRange.toString(range))) {
            return {
                type: 'static',
                value: parseInt(rangeString)
            }
        }

        if (range.min !== undefined && range.max !== undefined) {
            if (range.max - range.min > 100) {
                return {
                    type: 'non-empty',
                    doc: `${type === 'value' ? 'Integer within ' : `${pascal_case(type)} length within`} range of (${mcdoc.NumericRange.toString(range)}).`
                }
            }
            return {
                type: 'closed'
            }
        } else if (range.min !== undefined) {
            const at_least = `${type === 'value' ? 'Integer of at least ' : `${pascal_case(type)} length of at least`} ${range.min}.`
            return {
                type: 'non-empty',
                doc: range.min === 1 ? (type === 'value' ? 'Integer must be higher than 0.' : `${pascal_case(type)} must not be empty.`) : at_least
            }
        } else {
            return {
                type: 'unbounded',
                doc: `${type === 'value' ? 'Integer' : `${pascal_case(type)} length`} cannot exceed ${range.max} & ${type === 'value' ? 'can be less than 1' : 'can be empty'}.`
            }
        }
    }

    bindDoc<N extends ts.Node>(node: N, doc?: string[] | mcdoc.McdocBaseType): N {
        let _doc: string[] = []
        if (doc === undefined) {
            return node
        }
        if (Array.isArray(doc)) {
            _doc = doc
        } else if (Object.hasOwn(doc, 'desc')) {
            // @ts-ignore
            const desc: string = doc.desc

            // y e s
            _doc = desc.trim().replaceAll('\n\n\n\n ', '@@bad@@').replaceAll('\n\n', '\n').replaceAll('@@bad@@', '\n\n').split('\n')
        } else {
            return node
        }
        return ts.addSyntheticLeadingComment(
            node,
            ts.SyntaxKind.MultiLineCommentTrivia,
            `*\n * ${_doc.join('\n * ')}\n `, 
            true, 
        )
    }

    createEnum(name: ts.Identifier, _enum: mcdoc.EnumType) {
        if (_enum.enumKind === 'string') {
            return factory.createEnumDeclaration(
                [factory.createToken(ts.SyntaxKind.ExportKeyword)],
                name,
                _enum.values.map((value) => factory.createEnumMember(value.identifier, factory.createStringLiteral(value.value as string, true))),
            )
        }
        return factory.createEnumDeclaration(
            [factory.createToken(ts.SyntaxKind.ExportKeyword)],
            name,
            _enum.values.map((value) => factory.createEnumMember(value.identifier, factory.createNumericLiteral(value.value as number))),
        )
    }

    /**
     * Iterate through all types, collapsing imports into a single import declaration per module path
     */
    collapseImports(types: (ts.EnumDeclaration | ts.ImportDeclaration | ts.TypeAliasDeclaration)[]) {
        const importPaths: string[] = []
        const importMap: Record<string, number | undefined> = {} // Map to track module paths and their indices in collapsedImports
        const collapsedImports: ts.ImportDeclaration[] = []
        const nonImportTypes: (ts.EnumDeclaration | ts.TypeAliasDeclaration)[] = []
    
        // First loop: Process types and assemble collapsedImports in sorted order
        for (const type of types) {
            if (ts.isImportDeclaration(type) && type.importClause?.namedBindings && ts.isNamedImports(type.importClause.namedBindings)) {
                const modulePath = (type.moduleSpecifier as ts.StringLiteral).text
                const specifier = type.importClause.namedBindings.elements[0] // Only one specifier per ImportDeclaration
    
                let importIndex = importMap[modulePath]
                if (importIndex === undefined) {
                    // Use binary search to find the correct insertion point for the new module path
                    let left = 0
                    let right = collapsedImports.length
                    while (left < right) {
                        const mid = Math.floor((left + right) / 2)
                        const midPath = (collapsedImports[mid].moduleSpecifier as ts.StringLiteral).text
                        if (modulePath.localeCompare(midPath) < 0) {
                            right = mid
                        } else {
                            left = mid + 1
                        }
                    }
    
                    // Create a new ImportDeclaration and insert it at the correct position
                    const newImport = factory.createImportDeclaration(
                        undefined,
                        factory.createImportClause(false, undefined, factory.createNamedImports([])),
                        factory.createStringLiteral(modulePath, true)
                    );
                    collapsedImports.splice(left, 0, newImport)
                    importPaths.splice(left, 0, modulePath)
                    importMap[modulePath] = left
                    importIndex = left
    
                    // Update indices in the map for all subsequent imports using importPaths as a reference
                    for (let i = left + 1; i < importPaths.length; i++) {
                        importMap[importPaths[i]] = i
                    }
                }
    
                // Add the specifier to the correct ImportDeclaration
                const importClause = collapsedImports[importIndex].importClause!
                const namedImports = importClause.namedBindings! as ts.NamedImports // Imagine using namespaces
                const existingSpecifiers = namedImports.elements as (ts.NodeArray<ts.ImportSpecifier> & { splice: typeof Array['prototype']['splice'] })
    
                // Use binary search to insert the specifier in sorted order
                let left = 0
                let right = existingSpecifiers.length
                let exists = false
                while (left < right) {
                    const mid = Math.floor((left + right) / 2)
                    const comparison = specifier.name.text.localeCompare(existingSpecifiers[mid].name.text)
                    if (comparison === 0) {
                        exists = true // Specifier already exists, no need to insert
                        break
                    } else if (comparison < 0) {
                        right = mid
                    } else {
                        left = mid + 1
                    }
                }
    
                if (!exists) {
                    existingSpecifiers.splice(left, 0, specifier)
                }
            } else {
                nonImportTypes.push(type as ts.EnumDeclaration | ts.TypeAliasDeclaration)
            }
        }
    
        // Combine collapsed imports with non-import types
        return [...collapsedImports, ...nonImportTypes];
    }
}
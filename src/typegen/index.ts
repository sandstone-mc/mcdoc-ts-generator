import type { Service, SymbolMap } from '@spyglassmc/core'
import * as mcdoc from '@spyglassmc/mcdoc'
import ts from 'typescript'
import { collapseImports } from './collapseImports'
import { bindDoc, bindImport, bindNumericLiteral } from './binders'
import { camel_case, join, pascal_case, type ResourceContent, type ValueType } from '../util'
import { resolveValueType } from './resolveValueType'
import { emptyObject } from './static'

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

export class TypesGenerator {
    private key_dispatcher_count = 0

    inline_enum_count = 0

    private inner_dispatcher_count = 0

    private readonly resolved_resources = new Set<string>()

    readonly resolved_references = new Map<string, { name: string, import: ts.ImportDeclaration, path: string }>()

    readonly dispatcher_references = new Map<string, DispatcherReferenceCounter>()

    readonly resolved_dispatchers = new Set<string>()

    constructor(
        private service: Service,
        private symbols: SymbolMap,
        private dispatchers: SymbolMap,
        private module_files: Map<string, Record<string, ts.TypeAliasDeclaration | ts.EnumDeclaration | ts.ImportDeclaration>>,
        private generated_path: string,
        private resource_contents: Map<string, ResourceContent>,
        private sub_resource_map: Map<string, string>
    ) { }

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
                const resolved = resolveValueType(typeDef, original_symbol, target_path, this)

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

            const value = resolveValueType(typeDef, locator, target_path, this)

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

        resolved_types.push(
            factory.createTypeAliasDeclaration(
                [factory.createToken(ts.SyntaxKind.ExportKeyword)],
                factory.createIdentifier(`${generic_name}TypeKeys`),
                undefined,
                factory.createTypeOperatorNode(
                    ts.SyntaxKind.KeyOfKeyword,
                    factory.createTypeReferenceNode(
                        factory.createIdentifier(`${generic_name}Type`),
                        undefined
                    )
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
                    const resolve = resolveValueType(field.type, original_symbol, target_path, this)!

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
                        const resolved = resolveValueType(field.type, original_symbol, target_path, this) || {
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
                    type: emptyObject,
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
                        module: factory.createTypeAliasDeclaration(
                            undefined,
                            factory.createIdentifier(`${original_symbol?.split('::').at(-1)}_${registry}`),
                            undefined,
                            factory.createMappedTypeNode(
                                undefined,
                                factory.createTypeParameterDeclaration(
                                    undefined,
                                    factory.createIdentifier('Key'),
                                    factory.createTypeOperatorNode(
                                        ts.SyntaxKind.KeyOfKeyword,
                                        factory.createTypeReferenceNode(factory.createIdentifier(registry), undefined)
                                    ),
                                    undefined
                                ),
                                undefined,
                                factory.createToken(ts.SyntaxKind.QuestionToken),
                                factory.createTypeReferenceNode(factory.createIdentifier(registry), [
                                    factory.createTypeReferenceNode(factory.createIdentifier('Key'), undefined)
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

    readonly bindImport = bindImport

    readonly bindDoc = bindDoc

    /**
     * Iterate through all types, collapsing imports into a single import declaration per module path
     */
    readonly collapseImports = collapseImports
}
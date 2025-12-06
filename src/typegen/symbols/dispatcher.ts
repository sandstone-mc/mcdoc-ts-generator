import ts from 'typescript'
import type { SymbolMap } from '@spyglassmc/core'
import * as mcdoc from '@spyglassmc/mcdoc'
import { TypeHandlers, type NonEmptyList } from '../mcdoc'
import { merge_imports } from '../mcdoc/utils'

const { factory } = ts

/**
 * Properties describing special behavior of a dispatcher symbol map.
 */
export type DispatcherProperties = {
    /**
     * Whether %unknown is present - allows arbitrary string keys with fallback type
     */
    readonly supports_unknown: boolean
    /**
     * Whether %none is present - allows omitting the dispatcher key
     */
    readonly supports_none: boolean
}

/**
 * Global map of dispatcher names to their properties.
 * Populated during dispatcher_symbol calls.
 */
export const dispatcher_properties_map = new Map<string, DispatcherProperties>()

/**
 * Global map of reference type paths to the dispatcher id they belong to.
 * Populated during dispatcher_symbol calls.
 */
export const reference_dispatcher_map = new Map<string, string>()

/**
 * Global map of dispatcher registry id to symbol name.
 * Populated during dispatcher_symbol calls.
 * e.g., "minecraft:block" -> "Block"
 */
export const dispatcher_registry_map = new Map<string, string>()

export type DispatcherSymbolResult = {
    /**
     * The main exported type: `SymbolName<CASE>`
     */
    readonly type: ts.TypeAliasDeclaration
    /**
     * Supporting type aliases (member types, map, keys, fallback, unknown)
     */
    readonly members: ts.TypeAliasDeclaration[]
    /**
     * Import paths required by this dispatcher
     */
    readonly imports?: {
        readonly ordered: NonEmptyList<string>
        readonly check: Map<string, number>
    }
    /**
     * Properties of this dispatcher (supports %unknown, %none)
     */
    readonly properties: DispatcherProperties
}

type DispatcherMember = { typeDef: mcdoc.McdocType }

/**
 * Generates a dispatcher symbol map with the following structure:
 * ```ts
 * type NameFallbackType<T> = { ... }  // Only if %unknown is present
 * type NameMemberA<T> = { ... }
 * type NameMemberB<T> = { ... }
 * type NameMap<T> = { 'a': NameMemberA<T>, 'b': NameMemberB<T> } & { [key?: string]: NameFallbackType<T> }
 * type NameKeys = keyof NameMap<unknown>
 * type NameFallback<T> = NameMemberA<T> | NameMemberB<T> | NameFallbackType<T>
 * type NameUnknown<T> = NameMemberA<T> & NameMemberB<T> & NameFallbackType<T>
 * export type SymbolName<CASE extends ('map' | 'keys' | '%unknown' | '%fallback') = 'map', T> = ...
 * ```
 *
 * Generic parameters (e.g., `<T>`) are only present if the dispatcher members are template types.
 * When present, generics are extracted from the first member and propagated to all type aliases.
 * CASE always comes before any dispatcher generics in the main Symbol type.
 *
 * Special keys in dispatcher members:
 * - `%unknown`: Defines fallback type for arbitrary string keys not in the map.
 *   When present, adds index signature to Map and includes fallback in Fallback/Unknown types.
 * - `%none`: Indicates the dispatcher key can be omitted. Handled during dispatcher use.
 *
 * Also populates `dispatcherPropertiesMap` with the dispatcher's properties.
 */
function dispatcher_symbol(
    id: string,
    name: string,
    dispatcher: SymbolMap[string],
) {
    const members = dispatcher.members
    if (members === undefined) {
        throw new Error(`[dispatcher_symbol] Dispatcher "${name}" has no members`)
    }

    return (...args: unknown[]): DispatcherSymbolResult => {
        let has_imports = false
        const imports = {
            ordered: [] as unknown as NonEmptyList<string>,
            check: new Map<string, number>(),
        }

        const member_types: ts.TypeAliasDeclaration[] = []
        const map_properties: ts.PropertySignature[] = []
        const member_type_refs: ts.TypeReferenceNode[] = []

        // Check for special keys and resolve their types
        const has_unknown = '%unknown' in members
        const has_none = '%none' in members

        // Check first member for generics (if dispatcher has generics, all members have them)
        const first_member = members[Object.keys(members)[0]]
        const first_type = (first_member.data as DispatcherMember).typeDef

        const has_generics = first_type.kind === 'template'
        const generic_params: ts.TypeParameterDeclaration[] = []
        const generic_names: ts.TypeReferenceNode[] = []

        if (has_generics && first_type.kind === 'template') {
            const template = first_type

            for (const type_param of template.typeParams) {
                // Extract the generic name from the path (last segment)
                const param_name = type_param.path.split('::').pop()!
                generic_params.push(
                    factory.createTypeParameterDeclaration(
                        undefined,
                        factory.createIdentifier(param_name),
                        undefined,
                        undefined
                    )
                )
                generic_names.push(factory.createTypeReferenceNode(param_name))
            }
        }

        let fallback_type_name: ts.TypeReferenceNode | undefined

        // Process %unknown to get the fallback type
        if (has_unknown) {
            let unknown_member = (members['%unknown'].data as DispatcherMember).typeDef!

            // Unwrap template type if present
            if (unknown_member.kind === 'template') {
                unknown_member = unknown_member.child
            }

            const handler = TypeHandlers[unknown_member.kind]
            const result = handler(unknown_member)(...args)

            // Collect imports from fallback type
            if ('imports' in result && result.imports !== undefined) {
                if (!has_imports) {
                    has_imports = true
                    imports.ordered.push(...result.imports.ordered)
                    for (const [key, value] of result.imports.check) {
                        imports.check.set(key, value)
                    }
                } else {
                    merge_imports(imports, result.imports)
                }
            }

            // Create the fallback type alias (with generics if present)
            const fallback_type_alias = factory.createTypeAliasDeclaration(
                undefined,
                factory.createIdentifier(`${name}FallbackType`),
                has_generics ? generic_params : undefined,
                result.type
            )
            member_types.push(fallback_type_alias)
            fallback_type_name = factory.createTypeReferenceNode(
                `${name}FallbackType`,
                has_generics ? generic_names : undefined
            )
        }

        // Store dispatcher properties in global map
        const properties: DispatcherProperties = {
            supports_unknown: has_unknown,
            supports_none: has_none,
        }
        dispatcher_properties_map.set(name, properties)
        dispatcher_registry_map.set(id, name)

        for (const [member_key, member] of Object.entries(members)) {
            // Skip special keys
            if (member_key.startsWith('%')) {
                continue
            }

            let member_type = (member.data as DispatcherMember).typeDef!

            // Unwrap template type if present
            if (member_type.kind === 'template') {
                member_type = member_type.child
            }

            // Track reference paths to dispatcher id
            if (member_type.kind === 'reference' && member_type.path !== undefined) {
                reference_dispatcher_map.set(member_type.path, id)
            }

            const member_name = pascal_case(member_key.replace(/[/:]/g, '_'))
            const member_type_name = `${name}${member_name}`

            // Resolve the member type using the mcdoc type handlers
            const handler = TypeHandlers[member_type.kind]
            const result = handler(member_type)(...args)

            // Collect imports
            if ('imports' in result && result.imports !== undefined) {
                if (!has_imports) {
                    has_imports = true
                    imports.ordered.push(...result.imports.ordered)
                    for (const [key, value] of result.imports.check) {
                        imports.check.set(key, value)
                    }
                } else {
                    merge_imports(imports, result.imports)
                }
            }

            // Create member type alias (with generics if present)
            const member_type_alias = factory.createTypeAliasDeclaration(
                undefined,
                factory.createIdentifier(member_type_name),
                has_generics ? generic_params : undefined,
                result.type
            )
            member_types.push(member_type_alias)

            // Create reference to the member type (with generics if present)
            const member_ref = factory.createTypeReferenceNode(
                member_type_name,
                has_generics ? generic_names : undefined
            )
            member_type_refs.push(member_ref)

            // Create map property
            map_properties.push(
                factory.createPropertySignature(
                    undefined,
                    factory.createStringLiteral(member_key, true),
                    undefined,
                    member_ref
                )
            )
        }

        // Create NameMap type
        // If %unknown is present, intersect with an index signature for arbitrary keys
        let map_type_node: ts.TypeNode
        if (has_unknown && fallback_type_name) {
            const index_signature = factory.createIndexSignature(
                undefined,
                [
                    factory.createParameterDeclaration(
                        undefined,
                        undefined,
                        factory.createIdentifier('key'),
                        factory.createToken(ts.SyntaxKind.QuestionToken),
                        factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword)
                    )
                ],
                fallback_type_name
            )
            map_type_node = factory.createIntersectionTypeNode([
                factory.createTypeLiteralNode(map_properties),
                factory.createTypeLiteralNode([index_signature])
            ])
        } else {
            map_type_node = factory.createTypeLiteralNode(map_properties)
        }

        const map_type = factory.createTypeAliasDeclaration(
            undefined,
            factory.createIdentifier(`${name}Map`),
            has_generics ? generic_params : undefined,
            map_type_node
        )

        // Create NameKeys type (no generics needed - keys don't depend on type params)
        const keys_type = factory.createTypeAliasDeclaration(
            undefined,
            factory.createIdentifier(`${name}Keys`),
            undefined,
            factory.createTypeOperatorNode(
                ts.SyntaxKind.KeyOfKeyword,
                factory.createTypeReferenceNode(
                    `${name}Map`,
                    has_generics ? generic_names.map(() => factory.createKeywordTypeNode(ts.SyntaxKind.UnknownKeyword)) : undefined
                )
            )
        )

        // Create NameFallback type (union of all members + fallback type if present)
        const fallback_union_members = fallback_type_name
            ? [...member_type_refs, fallback_type_name]
            : member_type_refs
        const fallback_type = factory.createTypeAliasDeclaration(
            undefined,
            factory.createIdentifier(`${name}Fallback`),
            has_generics ? generic_params : undefined,
            factory.createParenthesizedType(factory.createUnionTypeNode(fallback_union_members))
        )

        // Create NameUnknown type (intersection of all members + fallback type if present)
        const unknown_intersection_members = fallback_type_name
            ? [...member_type_refs, fallback_type_name]
            : member_type_refs
        const unknown_type = factory.createTypeAliasDeclaration(
            undefined,
            factory.createIdentifier(`${name}Unknown`),
            has_generics ? generic_params : undefined,
            factory.createParenthesizedType(factory.createIntersectionTypeNode(unknown_intersection_members))
        )

        // Create the main Symbol type with CASE generic first, then dispatcher generics
        const case_type_param = factory.createTypeParameterDeclaration(
            undefined,
            factory.createIdentifier('CASE'),
            factory.createUnionTypeNode([
                factory.createLiteralTypeNode(factory.createStringLiteral('map', true)),
                factory.createLiteralTypeNode(factory.createStringLiteral('keys', true)),
                factory.createLiteralTypeNode(factory.createStringLiteral('%unknown', true)),
                factory.createLiteralTypeNode(factory.createStringLiteral('%fallback', true)),
            ]),
            factory.createLiteralTypeNode(factory.createStringLiteral('map', true))
        )

        const symbol_type = factory.createTypeAliasDeclaration(
            [factory.createModifier(ts.SyntaxKind.ExportKeyword)],
            factory.createIdentifier(`Symbol${name}`),
            [case_type_param, ...generic_params],
            factory.createConditionalTypeNode(
                factory.createTypeReferenceNode('CASE'),
                factory.createLiteralTypeNode(factory.createStringLiteral('map', true)),
                factory.createTypeReferenceNode(`${name}Map`, has_generics ? generic_names : undefined),
                factory.createConditionalTypeNode(
                    factory.createTypeReferenceNode('CASE'),
                    factory.createLiteralTypeNode(factory.createStringLiteral('keys', true)),
                    factory.createTypeReferenceNode(`${name}Keys`),
                    factory.createConditionalTypeNode(
                        factory.createTypeReferenceNode('CASE'),
                        factory.createLiteralTypeNode(factory.createStringLiteral('%fallback', true)),
                        factory.createTypeReferenceNode(`${name}Fallback`, has_generics ? generic_names : undefined),
                        factory.createConditionalTypeNode(
                            factory.createTypeReferenceNode('CASE'),
                            factory.createLiteralTypeNode(factory.createStringLiteral('%unknown', true)),
                            factory.createTypeReferenceNode(`${name}Unknown`, has_generics ? generic_names : undefined),
                            factory.createKeywordTypeNode(ts.SyntaxKind.NeverKeyword)
                        )
                    )
                )
            )
        )

        return {
            type: symbol_type,
            members: [
                ...member_types,
                map_type,
                keys_type,
                fallback_type,
                unknown_type,
            ],
            ...(has_imports ? { imports } : {}),
            properties,
        }
    }
}

function pascal_case(name: string): string {
    const words = name.split('_')
    return words
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join('')
}

export const DispatcherSymbol = dispatcher_symbol

import ts from 'typescript'
import type { SymbolMap } from '@spyglassmc/core'
import * as mcdoc from '@spyglassmc/mcdoc'
import { get_type_handler, type NonEmptyList, type TypeHandlerResult } from '.'
import { merge_imports } from './utils'
import { Bind } from './bind'
import { add, pascal_case } from '../../util'

// TODO: Handle naming collision when a dispatcher is named the same as a generated type (e.g., "EnvironmentAttributeMap")
// This causes issues because we generate `${name}Map` which collides with the actual symbol name.

const { factory } = ts

export type DispatcherReferenceCounter = {
    /**
     * Map<path: string, location_counts_index: number>
     */
    locations: Map<string, number>
    location_counts: [path: string, count: number][]
}

export const dispatcher_references = new Map<string, DispatcherReferenceCounter>()

type DispatcherSymbolResult = {
    /**
     * The main exported type `SymbolName<CASE>` and all supporting type aliases (member types, map, keys, fallback, unknown)
     */
    readonly types: (ts.TypeAliasDeclaration | ts.EnumDeclaration)[]
    /**
     * Import paths required by this dispatcher
     */
    readonly imports?: {
        readonly ordered: NonEmptyList<string>
        readonly check: Map<string, number>
    }
    readonly references?: DispatcherReferenceCounter
}

type DispatcherMember = { typeDef: mcdoc.McdocType }

/**
 * Generates a dispatcher symbol map with the following structure:
 * ```ts
 * export type NameFallbackType<T> = { ... }  // Only if %unknown is present
 * type NameNoneType<T> = { ... }  // Only if %none is present
 * type NameMemberA<T> = { ... }
 * type NameMemberB<T> = { ... }
 * type NameMap<T> = { 'a': NameMemberA<T>, 'b': NameMemberB<T> }
 * type NameKeys = keyof NameMap<unknown>
 * type NameFallback<T> = NameMemberA<T> | NameMemberB<T> | NameFallbackType<T>
 * export type SymbolName<T, CASE extends ('map' | 'keys' | '%fallback' | '%none') = 'map'> = ...
 * ```
 *
 * Generic parameters (e.g., `<T>`) are only present if the dispatcher members are template types.
 * When present, generics are extracted from the first member and propagated to all type aliases.
 * CASE always comes after any dispatcher generics in the main Symbol type because required type generics must proceed optional ones.
 *
 * Special keys in dispatcher members:
 * - `%unknown`: Defines fallback type for arbitrary string keys not in the map, doesn't actually work because of TypeScript limitations
 * - `%none`: Indicates the dispatcher key can be omitted. Handled during dispatcher use.
 *
 * Also populates `dispatcherPropertiesMap` with the dispatcher's properties.
 */
export function dispatcher_symbol(
    id: string,
    name: string,
    members: SymbolMap,
    dispatcher_properties: Map<string, { supports_none?: true }>,
    module_map: SymbolMap,
): DispatcherSymbolResult {
    let imports = undefined as unknown as TypeHandlerResult['imports']
    let has_references = false

    const member_types: ts.TypeAliasDeclaration[] = []
    const map_properties: ts.PropertySignature[] = []
    const member_type_refs: ts.TypeReferenceNode[] = []

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

            generic_params.push(factory.createTypeParameterDeclaration(undefined, param_name))
            generic_names.push(factory.createTypeReferenceNode(param_name))
        }
    }

    const add_reference = () => {
        has_references = true
        if (!dispatcher_references.has(id)) {
            dispatcher_references.set(id, {
                locations: new Map(),
                location_counts: []
            })
        }
        return dispatcher_references.get(id)!
    }

    // Check for special keys and resolve their types

    let fallback_type_name: ts.TypeReferenceNode | undefined

    // Process %unknown to get the fallback type
    if ('%unknown' in members) {
        const unknown_member = (members['%unknown'].data as DispatcherMember).typeDef!

        const unknown_type_name = `${name}FallbackType`

        const result = get_type_handler(unknown_member)(unknown_member)({
            root_type: true,
            name: unknown_type_name,
            dispatcher_symbol: add_reference,
            dispatcher_properties,
            module_map,
        })

        // Collect imports from fallback type
        if ('imports' in result) {
            imports = merge_imports(imports, result.imports)
        }

        fallback_type_name = factory.createTypeReferenceNode(
            unknown_type_name,
            has_generics ? generic_names : undefined
        )
        if (ts.isTypeAliasDeclaration(result.type)) {
            member_types.push(result.type)
        } else {
            member_types.push(factory.createTypeAliasDeclaration(
                undefined,
                unknown_type_name,
                undefined,
                result.type as ts.TypeNode
            ))
        }
    }

    const has_none = '%none' in members

    // Process %none to get the none type
    if (has_none) {
        const none_member = (members['%none'].data as DispatcherMember).typeDef!

        const none_type_name = `${name}NoneType`

        const result = get_type_handler(none_member)(none_member)({
            root_type: true,
            name: none_type_name,
            dispatcher_symbol: add_reference,
            dispatcher_properties,
            module_map,
        })

        // Collect imports from none type
        if ('imports' in result) {
            imports = merge_imports(imports, result.imports)
        }

        dispatcher_properties.set(id, {
            supports_none: true,
        })

        if (ts.isTypeAliasDeclaration(result.type)) {
            member_types.push(result.type)
        } else {
            member_types.push(factory.createTypeAliasDeclaration(
                undefined,
                none_type_name,
                undefined,
                result.type as ts.TypeNode
            ))
        }
    }

    for (const member_key of Object.keys(members)) {
        const member = members[member_key]
        // Skip special keys
        if (member_key.startsWith('%')) {
            continue
        }

        const member_type = (member.data as DispatcherMember).typeDef!

        const member_type_name = `${name}${pascal_case(member_key.replace(/[/:]/g, '_'))}`

        // Resolve the member type using the mcdoc type handlers
        const result = get_type_handler(member_type)(member_type)({
            root_type: true,
            name: member_type_name,
            dispatcher_symbol: add_reference,
            dispatcher_properties,
            module_map,
        })

        // Collect imports
        if ('imports' in result) {
            imports = merge_imports(imports, result.imports)
        }

        // Once/if the dispatcher symbol map gets declaration paths we can add these directly to the modules they belong in

        // Create member type alias (with generics if present)
        if (ts.isTypeAliasDeclaration(result.type)) {
            member_types.push(result.type)
        } else {
            member_types.push(factory.createTypeAliasDeclaration(
                undefined,
                member_type_name,
                undefined,
                result.type as ts.TypeNode
            ))
        }

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
    const map_type = factory.createTypeAliasDeclaration(
        undefined,
        `${name}Map`,
        has_generics ? generic_params : undefined,
        factory.createTypeLiteralNode(map_properties)
    )

    // Create NameKeys type (no generics needed - keys don't depend on type params)
    const keys_type = factory.createTypeAliasDeclaration(
        undefined,
        `${name}Keys`,
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
        `${name}Fallback`,
        has_generics ? generic_params : undefined,
        factory.createParenthesizedType(factory.createUnionTypeNode(fallback_union_members))
    )

    // Create the main Symbol type with CASE generic first, then dispatcher generics
    generic_params.push(factory.createTypeParameterDeclaration(
        undefined,
        'CASE',
        factory.createUnionTypeNode([
            Bind.StringLiteral('map'),
            Bind.StringLiteral('keys'),
            Bind.StringLiteral('%fallback'),
            Bind.StringLiteral('%none'),
        ]),
        Bind.StringLiteral('map')
    ))

    const symbol_type = factory.createTypeAliasDeclaration(
        [factory.createModifier(ts.SyntaxKind.ExportKeyword)],
        `Symbol${name}`,
        generic_params,
        factory.createConditionalTypeNode(
            factory.createTypeReferenceNode('CASE'),
            Bind.StringLiteral('map'),
            factory.createTypeReferenceNode(`${name}Map`, has_generics ? generic_names : undefined),
            factory.createConditionalTypeNode(
                factory.createTypeReferenceNode('CASE'),
                Bind.StringLiteral('keys'),
                factory.createTypeReferenceNode(`${name}Keys`),
                factory.createConditionalTypeNode(
                    factory.createTypeReferenceNode('CASE'),
                    Bind.StringLiteral('%fallback'),
                    factory.createTypeReferenceNode(`${name}Fallback`, has_generics ? generic_names : undefined),
                    has_none ? factory.createConditionalTypeNode(
                        factory.createTypeReferenceNode('CASE'),
                        Bind.StringLiteral('%none'),
                        factory.createTypeReferenceNode(`${name}NoneType`, has_generics ? generic_names : undefined),
                        factory.createKeywordTypeNode(ts.SyntaxKind.NeverKeyword)
                    ) : factory.createKeywordTypeNode(ts.SyntaxKind.NeverKeyword)
                )
            )
        )
    )

    return {
        types: [
            map_type,
            keys_type,
            fallback_type,
            ...member_types,
            symbol_type,
        ],
        ...add({imports}),
        ...(has_references ? { references: dispatcher_references.get(id)! } : {} ),
    } as const
}

export const DispatcherSymbol = dispatcher_symbol

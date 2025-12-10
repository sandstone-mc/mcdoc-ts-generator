import ts from 'typescript'
import type { SymbolMap } from '@spyglassmc/core'
import * as mcdoc from '@spyglassmc/mcdoc'
import { TypeHandlers, type NonEmptyList } from '../mcdoc'
import { merge_imports } from '../mcdoc/utils'
import { Assert } from '../mcdoc/assert'
import { Bind } from '../mcdoc/bind'

const { factory } = ts

/**
 * Properties describing special behavior of a dispatcher symbol map.
 */
export type DispatcherProperties = {
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
 * export type SymbolName<CASE extends ('map' | 'keys' | '%fallback' | '%none') = 'map', T> = ...
 * ```
 *
 * Generic parameters (e.g., `<T>`) are only present if the dispatcher members are template types.
 * When present, generics are extracted from the first member and propagated to all type aliases.
 * CASE always comes before any dispatcher generics in the main Symbol type.
 *
 * Special keys in dispatcher members:
 * - `%unknown`: Defines fallback type for arbitrary string keys not in the map, doesn't actually work because of TypeScript limitations
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

    return (args: Record<string, unknown>): DispatcherSymbolResult => {
        let has_imports = false
        const imports = {
            ordered: [] as unknown as NonEmptyList<string>,
            check: new Map<string, number>(),
        }

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

        // Check for special keys and resolve their types

        let fallback_type_name: ts.TypeReferenceNode | undefined

        // Process %unknown to get the fallback type
        if ('%unknown' in members) {
            let unknown_member = (members['%unknown'].data as DispatcherMember).typeDef!

            const result = TypeHandlers[unknown_member.kind](unknown_member)(args)

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
            // This shows up as one of the options in %fallback, and is also available for those wishing to use types that are unrecognized to Sandstone
            member_types.push(factory.createTypeAliasDeclaration(
                [factory.createModifier(ts.SyntaxKind.ExportKeyword)],
                `${name}FallbackType`,
                has_generics ? generic_params : undefined,
                result.type
            ))
            fallback_type_name = factory.createTypeReferenceNode(
                `${name}FallbackType`,
                has_generics ? generic_names : undefined
            )
        }

        const has_none = '%none' in members

        // Process %none to get the none type
        if (has_none) {
            let none_member = (members['%none'].data as DispatcherMember).typeDef!

            const result = TypeHandlers[none_member.kind](none_member)(args)

            // Collect imports from none type
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

            // Create the none type alias (with generics if present)
            const none_type_alias = factory.createTypeAliasDeclaration(
                undefined,
                `${name}NoneType`,
                has_generics ? generic_params : undefined,
                result.type
            )
            member_types.push(none_type_alias)
        }

        // Store dispatcher properties in global map
        dispatcher_properties_map.set(name, {
            supports_none: has_none,
        })
        dispatcher_registry_map.set(id, name)

        for (const [member_key, member] of Object.entries(members)) {
            // Skip special keys
            if (member_key.startsWith('%')) {
                continue
            }

            let member_type = (member.data as DispatcherMember).typeDef!

            // Track reference paths to dispatcher id
            if (member_type.kind === 'reference') {
                Assert.ReferenceType(member_type)
                reference_dispatcher_map.set(member_type.path, id)
            }

            const member_name = pascal_case(member_key.replace(/[/:]/g, '_'))
            const member_type_name = `${name}${member_name}`

            // Resolve the member type using the mcdoc type handlers
            const result = TypeHandlers[member_type.kind](member_type)(args)

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
                member_type_name,
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
        const case_type_param = factory.createTypeParameterDeclaration(
            undefined,
            'CASE',
            factory.createUnionTypeNode([
                Bind.StringLiteral('map'),
                Bind.StringLiteral('keys'),
                Bind.StringLiteral('%fallback'),
                Bind.StringLiteral('%none'),
            ]),
            Bind.StringLiteral('map')
        )

        const symbol_type = factory.createTypeAliasDeclaration(
            [factory.createModifier(ts.SyntaxKind.ExportKeyword)],
            `Symbol${name}`,
            [case_type_param, ...generic_params],
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
                        factory.createConditionalTypeNode(
                            factory.createTypeReferenceNode('CASE'),
                            Bind.StringLiteral('%none'),
                            factory.createTypeReferenceNode(`${name}NoneType`, has_generics ? generic_names : undefined),
                            factory.createKeywordTypeNode(ts.SyntaxKind.NeverKeyword)
                        )
                    )
                )
            )
        )

        return {
            type: symbol_type,
            members: [
                map_type,
                keys_type,
                fallback_type,
                ...member_types,
            ],
            ...(has_imports ? { imports } : {}),
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

import ts from 'typescript'
import * as mcdoc from '@spyglassmc/mcdoc'
import type { NonEmptyList, TypeHandler, TypeHandlerResult } from '..'
import type { DispatcherInfo } from '../..'
import { Assert } from '../assert'
import { Bind } from '../bind'
import { add_import } from '../utils'
import { add } from '../../../util'

const { factory } = ts

const Unknown = Bind.StringLiteral('%unknown')
const RootNBT = factory.createTypeReferenceNode('RootNBT')
const RootNBTImport = 'sandstone::arguments::nbt::RootNBT'

function DispatcherArgs(args: Record<string, unknown>): asserts args is {
    /**
     * Property keys to chain as indexed access types after the dispatcher access.
     * Used by the `indexed` type handler to access nested properties.
     *
     * Example: `['attribute_track']` results in `SymbolX[K]['attribute_track']`
     */
    index_keys?: NonEmptyList<string>

    generic_types?: ts.TypeNode[]

    dispatcher_info?: Map<string, DispatcherInfo>

    root_type?: boolean
} {}

const SimpleKeyIndex = JSON.stringify([{
    kind: 'dynamic',
    accessor: [{
        keyword: 'key'
    }]
}])

const Fallback = Bind.StringLiteral('%fallback')
const None = Bind.StringLiteral('%none')

/**
 * Helper to create `SymbolX<generics..., case>` type reference
 */
function SymbolGeneric(symbol_name: string, generics: ts.TypeNode[], case_arg: ts.TypeNode) {
    return factory.createTypeReferenceNode(symbol_name, [...generics, case_arg])
}

type FallbackInfo = {
    has_fallback_type: boolean
    symbol_name: string
    generics: ts.TypeNode[]
}

/**
 * Helper to create `SymbolX<generics...>[key]` - get map then index
 * If key is dynamic, wraps in a conditional: `(S extends keyof SymbolX ? SymbolX[S] : FallbackType)`
 *
 * Fallback priority:
 * 1. If dispatcher has %unknown → SymbolX<'%unknown'>
 * 2. Otherwise → RootNBT (since this is intersection context)
 */
function SymbolMapIndex(symbol_name: string, key: ts.TypeNode, generics: ts.TypeNode[], fallback_info?: FallbackInfo): { type: ts.TypeNode, needs_import: boolean } {
    const symbol_type = factory.createTypeReferenceNode(symbol_name, generics.length === 0 ? undefined : generics)

    if (key.kind === ts.SyntaxKind.LiteralType) {
        return {
            type: factory.createIndexedAccessTypeNode(
                symbol_type,
                key
            ),
            needs_import: false
        }
    }

    // Determine fallback type
    let fallback_type: ts.TypeNode
    let needs_import = false

    if (fallback_info?.has_fallback_type) {
        // Use SymbolX<generics..., '%unknown'>
        fallback_type = SymbolGeneric(fallback_info.symbol_name, fallback_info.generics, Unknown)
    } else {
        // Use RootNBT (intersection context)
        fallback_type = RootNBT
        needs_import = true
    }

    return {
        type: factory.createParenthesizedType(factory.createConditionalTypeNode(
            key,
            factory.createTypeOperatorNode(
                ts.SyntaxKind.KeyOfKeyword,
                symbol_type
            ),
            factory.createIndexedAccessTypeNode(
                symbol_type,
                key
            ),
            fallback_type
        )),
        needs_import
    }
}

/**
 * Helper to create `(S extends keyof SymbolX ? ('sub_index' extends keyof SymbolX[S] ? SymbolX[S]['sub_index'] : FallbackType) : FallbackType)`
 *
 * Get map, index a member, index within that member
 *
 * Fallback priority:
 * 1. If dispatcher has %unknown → SymbolX<'%unknown'>
 * 2. Otherwise → RootNBT (since this is intersection context)
 */
function SymbolMapSubIndex(symbol_name: string, member_key: ts.TypeNode, generics: ts.TypeNode[], sub_index: NonEmptyList<string>, fallback_info?: FallbackInfo): { type: ts.TypeNode, needs_import: boolean } {
    const symbol_type = factory.createTypeReferenceNode(symbol_name, generics.length === 0 ? undefined : generics)
    const symbol_member: ts.IndexedAccessTypeNode = factory.createIndexedAccessTypeNode(
        symbol_type,
        member_key
    )
    let indexed_symbol: ts.IndexedAccessTypeNode | ts.ParenthesizedTypeNode | undefined = undefined

    // Determine fallback type
    let fallback_type: ts.TypeNode
    let needs_import = false

    if (fallback_info?.has_fallback_type) {
        // Use SymbolX<generics..., '%unknown'>
        fallback_type = SymbolGeneric(fallback_info.symbol_name, fallback_info.generics, Unknown)
    } else {
        // Use RootNBT (intersection context)
        fallback_type = RootNBT
        needs_import = true
    }

    // Assembles the type inside-out
    for (let i = sub_index.length; i > 0; i--) {
        const key = Bind.StringLiteral(sub_index[i - 1])

        let index_stack = symbol_member

        for (let j = 0; j < i - 1; j++) {
            index_stack = factory.createIndexedAccessTypeNode(
                index_stack,
                Bind.StringLiteral(sub_index[j])
            )
        }

        if (indexed_symbol === undefined) {
            indexed_symbol = factory.createIndexedAccessTypeNode(
                index_stack,
                key
            )
        }

        indexed_symbol = factory.createParenthesizedType(factory.createConditionalTypeNode(
            key,
            factory.createTypeOperatorNode(
                ts.SyntaxKind.KeyOfKeyword,
                index_stack
            ),
            indexed_symbol,
            fallback_type
        ))
    }

    return {
        type: factory.createParenthesizedType(factory.createConditionalTypeNode(
            member_key,
            factory.createTypeOperatorNode(
                ts.SyntaxKind.KeyOfKeyword,
                symbol_type
            ),
            indexed_symbol!,
            fallback_type
        )),
        needs_import
    }
}

/**
 * Handles `dispatcher` types which reference a dispatcher symbol map.
 *
 * A dispatcher type has:
 * - `registry`: The dispatcher identifier (e.g., `minecraft:entity_effect`)
 * - `parallelIndices`: How to look up into the dispatcher (static or dynamic)
 *
 * The generated type directly references the Symbol type:
 * - Static index: `SymbolEntityEffect['specific_key']`
 * - Dynamic index: `SymbolEntityEffect[Key]`
 * - Fallback: `SymbolEntityEffect<'%fallback'>`
 * - None: `SymbolEntityEffect<'%none'>`
 */
function mcdoc_dispatcher(type: mcdoc.McdocType) {
    Assert.DispatcherType(type)

    const dispatcher = type
    const registry = dispatcher.registry
    const indices = dispatcher.parallelIndices

    return (args: Record<string, unknown>) => {
        DispatcherArgs(args)

        // Look up the dispatcher symbol info
        const info = args.dispatcher_info?.get(registry)
        if (!info) {
            throw new Error(`[mcdoc_dispatcher] Unknown dispatcher: ${registry}`)
        }

        const { symbol_name, has_fallback_type, supports_none } = info
        const import_path = `::java::dispatcher::${symbol_name}`

        let imports: TypeHandlerResult['imports'] = {
            ordered: [import_path] as NonEmptyList<string>,
            check: new Map([[import_path, 0]]),
        }

        let result_type: ts.TypeNode

        let child_dispatcher: NonEmptyList<[parent_count: number, property: string]> | undefined

        const generics = args.generic_types ?? []

        // Fallback info for conditional types
        const fallback_info: FallbackInfo = {
            has_fallback_type,
            symbol_name,
            generics
        }

        if (indices.length === 1 && indices[0].kind === 'dynamic' && typeof indices[0].accessor.at(-1) === 'string') {
            // If this is a root type, we can't use S (no generic parameter available)
            // Fall back to %fallback instead
            if (args.root_type) {
                // Result: SymbolX<generics..., '%fallback'>
                result_type = SymbolGeneric(symbol_name, generics, Fallback)
            } else {
                child_dispatcher = [[indices[0].accessor.length - 1, indices[0].accessor.at(-1) as string]]

                // Result: (S extends keyof SymbolX ? SymbolX[S] : FallbackType)
                const indexed_result = SymbolMapIndex(symbol_name, factory.createTypeReferenceNode('S'), generics, fallback_info)
                if (indexed_result.needs_import) {
                    imports = add_import(imports, RootNBTImport)
                }

                if (supports_none) {
                    // Result: (S extends undefined ? SymbolX<generics..., '%none'> : (S extends keyof SymbolX ? SymbolX[S] : FallbackType))
                    result_type = factory.createParenthesizedType(factory.createConditionalTypeNode(
                        factory.createTypeReferenceNode('S'),
                        factory.createKeywordTypeNode(ts.SyntaxKind.UndefinedKeyword),
                        SymbolGeneric(symbol_name, generics, None),
                        indexed_result.type
                    ))
                } else {
                    // Result: (S extends keyof SymbolX ? SymbolX[S] : FallbackType)
                    result_type = indexed_result.type
                }
            }
        } else if (indices.length === 1 && indices[0].kind === 'static') {
            if (indices[0].value === '%fallback') {
                // Intentional fallback
                // Result: SymbolX<generics..., '%fallback'>
                result_type = SymbolGeneric(symbol_name, generics, Fallback)
            } else {
                // Result: SymbolX['static_member']
                const static_result = SymbolMapIndex(symbol_name, Bind.StringLiteral(indices[0].value), generics, fallback_info)
                result_type = static_result.type
                // Static access doesn't need fallback import
            }
        } else if (JSON.stringify(indices) === SimpleKeyIndex) {
            if (args.index_keys !== undefined) {
                // Result: (Key extends keyof SymbolX ? ('static_index' extends keyof SymbolX[Key] ? SymbolX[Key]['static_index'] : FallbackType) : FallbackType)
                const sub_result = SymbolMapSubIndex(symbol_name, factory.createTypeReferenceNode('Key'), generics, args.index_keys, fallback_info)
                result_type = sub_result.type
                if (sub_result.needs_import) {
                    imports = add_import(imports, RootNBTImport)
                }
            } else {
                // Result: (Key extends keyof SymbolX ? SymbolX[Key] : FallbackType)
                const key_result = SymbolMapIndex(symbol_name, factory.createTypeReferenceNode('Key'), generics, fallback_info)
                result_type = key_result.type
                if (key_result.needs_import) {
                    imports = add_import(imports, RootNBTImport)
                }
            }
        } else {
            throw new Error(`[mcdoc_dispatcher] Unsupported dispatcher: ${dispatcher}`)
        }

        return {
            type: result_type,
            imports,
            ...add({child_dispatcher})
        } as const
    }
}

export const McdocDispatcher = mcdoc_dispatcher satisfies TypeHandler

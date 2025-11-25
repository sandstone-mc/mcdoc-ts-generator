import ts from 'typescript'
import * as mcdoc from '@spyglassmc/mcdoc'

import { McdocList } from './list/list'
import { McdocAny } from './primitives/any'
import { McdocBoolean } from './primitives/boolean'
import { McdocByte } from './primitives/byte'
import { McdocDouble } from './primitives/double'
import { McdocFloat } from './primitives/float'
import { McdocInt } from './primitives/int'
import { McdocLiteral } from './primitives/literal'
import { McdocLong } from './primitives/long'
import { McdocReference } from './primitives/reference'
import { McdocShort } from './primitives/short'
import { McdocString } from './primitives/string'
import { McdocStruct } from './multi/struct'
import { McdocUnion } from './multi/union'
import { McdocTuple } from './multi/tuple'
import { McdocEnum } from './multi/enum'

export type NonEmptyList<T> = T[] & { 0: T }

export type TypeHandlerResult = {
    readonly type: ts.TypeNode | ts.EnumDeclaration,
    readonly imports?: {
        /**
         * Cannot include duplicates, but uses a list to preserve order.
         */
        readonly ordered: NonEmptyList<string>,
        /**
         * Maps import strings to the the index in `ordered` where they appear.
         */
        readonly check: Map<string, number>,
    },
    readonly docs?: NonEmptyList<string>,
    readonly named?: string,
}

export type TypeHandler<RESULT = TypeHandlerResult> = (type: mcdoc.McdocType, ...args: unknown[]) => (
    (...args: unknown[]) => RESULT
)

type TypeHandlersMeta = Record<mcdoc.McdocType['kind'], TypeHandler>

class TypeHandlersClass {
    static readonly any = McdocAny
    static readonly boolean = McdocBoolean
    /**
     * An `NBTByte`.
     * 
     * Contains a generic with the actual range encoded:
     * ```ts
     * { min?: number; max?: number, leftExclusive?: boolean; rightExclusive?: boolean }
     * ```
     */
    static readonly byte = McdocByte
    static readonly byte_array = McdocAny // TODO
    /**
     * @deprecated deferred.
     * A type reference with generic parameters.
     * 
     * References `template` types or members of a dispatcher that include their own generics.
     */
    static readonly concrete = McdocAny // TODO
    /**
     * `mcdoc.symbol['namespace:...']...`
     * 
     * With no generic defaults to `map`. Can include a generic parameter for special cases.
     * - `map`: The full symbol map.
     * - `keys`: The keys of the symbol map.
     * - `%fallback`: The union of all symbol values.
     * - `%unknown`: The intersection of all symbol values.
     */
    static readonly dispatcher = McdocAny // TODO
    static readonly double = McdocDouble
    /**
     * This uses a type hack because `enum` is never a value, it's only ever a base module type.
     */
    static readonly enum = McdocEnum as unknown as typeof McdocAny
    static readonly float = McdocFloat
    /**
     * A dispatcher with generic parameters.
     * TODO: %parent & %key nonsense.
     */
    static readonly indexed = McdocAny // TODO
    /**
     * An `NBTInt`.
     * 
     * Contains a generic with the actual range encoded:
     * ```ts
     * { min?: number; max?: number, beginExclusive?: boolean; endExclusive?: boolean }
     * ```
     */
    static readonly int = McdocInt
    static readonly int_array = McdocAny // TODO
    /**
     * An `NBTList`.
     */
    static readonly list = McdocList as McdocListType
    static readonly literal = McdocLiteral
    /**
     * An `NBTLong`.
     */
    static readonly long = McdocLong
    static readonly long_array = McdocAny // TODO
    /**
     * @deprecated Unused.
     */
    static readonly mapped = McdocAny
    static readonly reference = McdocReference
    /**
     * An `NBTShort`.
     * 
     * Contains a generic with the actual range encoded:
     * ```ts
     * { min?: number; max?: number, beginExclusive?: boolean; endExclusive?: boolean }
     * ```
     */
    static readonly short = McdocShort
    static readonly string = McdocString
    static readonly struct = McdocStruct as McdocStructType
    /**
     * A type alias with generic parameters.
     * 
     * Is referenced with `concrete` types.
     */
    static readonly template = McdocAny // TODO
    /**
     * Used in a single place, CubicBezier. Lol.
     */
    static readonly tuple = McdocTuple as McdocTupleType
    static readonly union = McdocUnion as McdocUnionType
    /**
     * @deprecated Unused.
     */
    static readonly unsafe = McdocAny
}

export const TypeHandlers = TypeHandlersClass satisfies TypeHandlersMeta

/**
 * Provides all possible TypeHandlerResult keys when exact kind is unknown.
 */
export function getTypeHandler(kind: mcdoc.McdocType['kind']): TypeHandler {
    return TypeHandlers[kind]
}

// Explicit return types for handlers that are circular
type McdocListType = TypeHandler<{
    readonly type: ts.TypeReferenceNode
    readonly imports?: {
        ordered: NonEmptyList<string>
        check: Map<string, number>
    }
    readonly docs?: NonEmptyList<string>
}>

type McdocStructType = TypeHandler<{
    readonly type: ts.TypeLiteralNode | ts.TypeReferenceNode | ts.ParenthesizedTypeNode | ts.KeywordTypeNode<ts.SyntaxKind.UnknownKeyword>
    readonly imports?: {
        readonly ordered: NonEmptyList<string>
        readonly check: Map<string, number>
    }
}>

type McdocTupleType = TypeHandler<{
    readonly type: ts.TupleTypeNode
    readonly imports?: {
        readonly ordered: NonEmptyList<string>
        readonly check: Map<string, number>
    }
}>

type McdocUnionType = TypeHandler<{
    readonly type: ts.ParenthesizedTypeNode
    readonly imports?: {
        readonly ordered: NonEmptyList<string>
        readonly check: Map<string, number>
    }
}>
import ts from 'typescript'
import * as mcdoc from '@spyglassmc/mcdoc'

import {
    McdocList, McdocByteArray, McdocIntArray, McdocLongArray,
} from './list'
import {
    McdocAny, McdocBoolean, McdocByte, McdocConcrete, McdocDouble,
    McdocFloat, McdocInt, McdocLiteral, McdocLong,
    McdocReference, McdocShort, McdocString,
} from './primitives'
import {
    McdocStruct, McdocUnion, McdocTuple, McdocEnum,
} from './multi'
import {
    McdocDispatcher,
    McdocIndexed,
    McdocTemplate,
} from './complex'

export type NonEmptyList<T> = T[] & { 0: T }

export type TypeHandlerResult = {
    readonly type: ts.TypeNode | ts.TypeAliasDeclaration,
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
    readonly docs?: NonEmptyList<string | [string]>,
    readonly child_dispatcher?: NonEmptyList<[parent_count: number, property: string]>
}

export type TypeHandler<RESULT = TypeHandlerResult> = (type: mcdoc.McdocType) => (
    (args: Record<string, unknown>) => RESULT
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
    /**
     * An `NBTByteArray`.
     *
     * Contains a generic with the length range encoded when applicable.
     */
    static readonly byte_array = McdocByteArray
    /**
     * A type reference with generic parameters.
     *
     * References `template` types or members of a dispatcher that include their own generics.
     */
    static readonly concrete = McdocConcrete as McdocConcreteType
    /**
     * `mcdoc.symbol['namespace:...']...`
     *
     * With no generic defaults to `map`. Can include a generic parameter for special cases.
     * - `map`: The full symbol map.
     * - `keys`: The keys of the symbol map.
     * - `%fallback`: The union of all symbol values.
     * - `%unknown`: The intersection of all symbol values.
     */
    static readonly dispatcher = McdocDispatcher
    static readonly double = McdocDouble
    static readonly enum = McdocEnum
    static readonly float = McdocFloat
    /**
     * Indexes into a dispatcher type to access a specific property.
     *
     * Used for accessing nested properties from dispatched types, e.g.:
     * `minecraft:environment_attribute[[%key]][attribute_track]`
     *
     * Generates indexed access types like:
     * `SymbolEnvironmentAttribute[K]['attribute_track']`
     */
    static readonly indexed = McdocIndexed
    /**
     * An `NBTInt`.
     * 
     * Contains a generic with the actual range encoded:
     * ```ts
     * { min?: number; max?: number, beginExclusive?: boolean; endExclusive?: boolean }
     * ```
     */
    static readonly int = McdocInt
    /**
     * An `NBTIntArray`.
     *
     * Contains a generic with the length range encoded when applicable.
     */
    static readonly int_array = McdocIntArray
    /**
     * An `NBTList`.
     */
    static readonly list = McdocList as McdocListType
    static readonly literal = McdocLiteral
    /**
     * An `NBTLong`.
     */
    static readonly long = McdocLong
    /**
     * An `NBTLongArray`.
     *
     * Contains a generic with the length range encoded when applicable.
     */
    static readonly long_array = McdocLongArray
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
    static readonly template = McdocTemplate as McdocTemplateType
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
 * Used to broaden the `type` field in the `TypeHandlerResult` for top-level typegen handling.
 */
export function get_type_handler(type: mcdoc.McdocType) {
    return TypeHandlers[type.kind] as TypeHandler
}

// Explicit return types for handlers that are circular
type McdocListType = TypeHandler<{
    readonly child_dispatcher?: NonEmptyList<[parent_count: number, property: string]>
    readonly type: ts.TypeReferenceNode
    readonly imports?: {
        readonly ordered: NonEmptyList<string>
        readonly check: Map<string, number>
    }
    readonly docs?: NonEmptyList<string>
}>

type McdocStructType = TypeHandler<{
    readonly child_dispatcher?: NonEmptyList<[parent_count: number, property: string]>
    readonly type: ts.TypeLiteralNode | ts.TypeReferenceNode | ts.ParenthesizedTypeNode | ts.KeywordTypeNode<ts.SyntaxKind.UnknownKeyword>
    readonly imports?: {
        readonly ordered: NonEmptyList<string>
        readonly check: Map<string, number>
    }
}>

type McdocTupleType = TypeHandler<{
    readonly docs?: NonEmptyList<string | [string]>;
    readonly child_dispatcher?: NonEmptyList<[parent_count: number, property: string]>;
    readonly imports?: {
        readonly ordered: NonEmptyList<string>;
        readonly check: Map<string, number>;
    };
    readonly type: ts.TupleTypeNode;
}>

type McdocUnionType = TypeHandler<{
    readonly docs?: NonEmptyList<string | [string]>;
    readonly child_dispatcher?: NonEmptyList<[number, string]>;
    readonly imports?: {
        readonly ordered: NonEmptyList<string>;
        readonly check: Map<string, number>;
    };
    readonly type: ts.TypeNode;
}>

type McdocConcreteType = TypeHandler<{
    readonly child_dispatcher?: NonEmptyList<[parent_count: number, property: string]>
    readonly type: ts.TypeReferenceNode | ts.TypeNode
    readonly imports?: {
        readonly ordered: NonEmptyList<string>
        readonly check: Map<string, number>
    }
}>

type McdocTemplateType = TypeHandler<{
    readonly child_dispatcher?: NonEmptyList<[parent_count: number, property: string]>
    readonly type: ts.TypeNode
    readonly imports?: {
        readonly ordered: NonEmptyList<string>
        readonly check: Map<string, number>
    }
}>
import ts from 'typescript'
import * as mcdoc from '@spyglassmc/mcdoc'
import { McdocAny } from './primitives/any'
import { McdocBoolean } from './primitives/boolean'
import { McdocByte } from './primitives/byte'
import { McdocDouble } from './primitives/double'
import { McdocFloat } from './primitives/float'
import { McdocInt } from './primitives/int'
import { McdocLiteral } from './primitives/literal'
import { McdocLong } from './primitives/long'
import { McdocShort } from './primitives/short'
import { McdocString } from './primitives/string'

export type NonEmptyList<T> = readonly T[] & { 0: T }

export type TypeHandlerResult = {
    readonly type: ts.TypeNode,
    readonly imports?: NonEmptyList<string>,
    readonly docs?: NonEmptyList<string>,
    readonly named?: string,
}

export type TypeHandler = (type: mcdoc.McdocType, ...args: unknown[]) => (
    (...args: unknown[]) => TypeHandlerResult
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
     * Contains a generic with 4 possible values:
     * - `['fixed', number]`
     * - `['ranged', number, number]`
     * - `['non-empty']`
     * - `['unbounded']`
     */
    static readonly byte_array = McdocAny
    /**
     * @deprecated deferred.
     * A type reference with generic parameters.
     * 
     * References `template` types or members of a dispatcher that include their own generics.
     */
    static readonly concrete = McdocAny
    /**
     * `mcdoc.symbol['namespace:...']...`
     * 
     * With no generic defaults to `map`. Can include a generic parameter for special cases.
     * - `map`: The full symbol map.
     * - `keys`: The keys of the symbol map.
     * - `%fallback`: The union of all symbol values.
     * - `%unknown`: The intersection of all symbol values.
     */
    static readonly dispatcher = McdocAny
    static readonly double = McdocDouble
    static readonly enum = McdocAny
    static readonly float = McdocFloat
    /**
     * TODO: %parent nonsense.
     */
    static readonly indexed = McdocAny
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
     * Contains a generic with 4 possible values:
     * - `['fixed', number]`
     * - `['ranged', number, number]`
     * - `['non-empty']`
     * - `['unbounded']`
     */
    static readonly int_array = McdocAny
    /**
     * An `NBTList`.
     * 
     * Contains two generics:
     * - `TYPE`: The type of the list elements.
     * - `LENGTH`: One of the following:
     *   - `['fixed', number]`
     *   - `['ranged', number, number]`
     *   - `['non-empty']`
     *   - `['unbounded']`
     */
    static readonly list = McdocAny
    static readonly literal = McdocLiteral
    /**
     * An `NBTLong`.
     */
    static readonly long = McdocLong
    /**
     * An `NBTLongArray`.
     * 
     * Contains a generic with 4 possible values:
     * - `['fixed', number]`
     * - `['ranged', number, number]`
     * - `['non-empty']`
     * - `['unbounded']`
     */
    static readonly long_array = McdocAny
    /**
     * @deprecated Unused.
     */
    static readonly mapped = McdocAny
    /**
     * @deprecated Deferred.
     */
    static readonly reference = McdocAny
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
    static readonly struct = McdocAny
    /**
     * A type alias with generic parameters.
     * 
     * Is referenced with `concrete` types.
     */
    static readonly template = McdocAny
    /**
     * Used in a single place, CubicBezier. Lol.
     */
    static readonly tuple = McdocAny
    static readonly union = McdocAny
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
import type * as mcdoc from '@spyglassmc/mcdoc'
import type { NonEmptyList, TypeHandler } from '..'
import { Assert } from '../assert'
import { McdocDispatcher } from './dispatcher'

/**
 * Handles `indexed` types which access a specific property from a dispatcher type.
 *
 * An indexed type has:
 * - `child`: The type to index into (typically a dispatcher)
 * - `parallelIndices`: The indices to access (static string keys)
 *
 * Example from vanilla-mcdoc:
 * ```mcdoc
 * struct EnvironmentAttributeTrackMap {
 *   [#[id="environment_attribute"] string]: minecraft:environment_attribute[[%key]][attribute_track],
 * }
 * ```
 *
 * The `[attribute_track]` is an indexed access into the dispatcher result.
 * This needs to generate:
 * ```ts
 * SymbolEnvironmentAttribute[K]['attribute_track']
 * ```
 *
 * Symbol structure:
 * ```json
 * {"kind":"indexed","child":{"kind":"dispatcher","parallelIndices":[{"kind":"dynamic","accessor":[{"keyword":"key"}]}],"registry":"minecraft:environment_attribute"},"parallelIndices":[{"kind":"static","value":"attribute_track"}]}
 * ```
 *
 * The index keys are passed through to the dispatcher handler via args.
 */
function mcdoc_indexed(type: mcdoc.McdocType) {
  Assert.IndexedType(type)
  Assert.DispatcherType(type.child)

  const indices = type.parallelIndices as mcdoc.StaticIndex[]

  return (args: Record<string, unknown>) => {
    // Extract static index values - these become the property access keys
    const index_keys = indices.map((index) => index.value) as NonEmptyList<string>

    return McdocDispatcher(type.child)({ index_keys, ...args })
  }
}

export const McdocIndexed = mcdoc_indexed satisfies TypeHandler

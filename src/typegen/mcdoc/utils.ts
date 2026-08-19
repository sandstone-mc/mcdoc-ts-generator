import {
  type SymbolUtil,
  type AssetsFileCategory,
  TaggableResourceLocationCategories,
  type RegistryCategory,
  type NormalFileCategory,
  type WorldgenFileCategory,
  type TaggableResourceLocationCategory,
  NormalFileCategories,
  AssetsFileCategories,
  type TagFileCategory,
} from '@spyglassmc/core'
import type { TypeHandlerResult } from '.'
import { prefix_import_path } from '../prefix'
import { compare_names } from '../../util'

export type NonEmptyList<T> = T[] & { 0: T }

// Thanks TypeScript
export class Set<T> extends globalThis.Set<T> {
  has(value: unknown): value is T {
    return super.has(value as any)
  }
}

export type SetType<T> = T extends Set<infer U> ? U : never

type UnionToIntersection<U> = ((U extends any ? (k: U) => void : never) extends ((k: infer I) => void) ? I : never)

type LastOf<T> = (UnionToIntersection<T extends any ? () => T : never> extends () => (infer R) ? R : never)

type UnionToTuple<T, L = LastOf<T>, N = [T] extends [never] ? true : false> = true extends N ? [] : [...UnionToTuple<Exclude<T, L>>, L]

export type NonTagResource = NormalFileCategory | WorldgenFileCategory | AssetsFileCategory

const NonNormalAssetsResources = new Set([
  'font/otf',
  'font/ttf',
  'font/unihex',
  'gpu_warnlist',
  'lang/deprecated',
  'regional_compliancies',
  'shader',
  'shader/fragment',
  'shader/vertex',
  'sounds',
  'texture_meta',
] as const)

export type NormalNonTagResource = (
  | Exclude<NormalFileCategory,
    | `${string}_variant`
    | 'number_provider'
    | 'dimension'
    | 'dimension_type'
  >
  | Exclude<AssetsFileCategory,
    | `font/${string}`
    | 'gpu_warnlist'
    | 'lang/deprecated'
    | 'regional_compliancies'
    | `shader${string}`
    | 'sounds'
    | 'texture_meta'
  >
)

export const NormalNonTagResources = new Set([
  ...NormalFileCategories.filter(
    (cat) => !cat.endsWith('_variant') && cat !== 'dimension' && cat !== 'dimension_type',
  ),
  ...AssetsFileCategories.filter(
    (cat) => !NonNormalAssetsResources.has(cat),
  ),
] as UnionToTuple<NormalNonTagResource>)

export type NonTagRegistry = RegistryCategory | NormalFileCategory | WorldgenFileCategory | AssetsFileCategory

export const TaggableRegistry = new Set(TaggableResourceLocationCategories)

/**
 * Check if a registry has entries in the symbol table.
 * @param symbols The symbol utility
 * @param registry_id The registry ID (e.g., 'block')
 * @returns true if the registry is non-empty
 */
export function is_valid_registry(symbols: SymbolUtil | undefined, registry_id: NonTagRegistry | TaggableResourceLocationCategory | TagFileCategory): boolean {
  if (symbols === undefined) {
    return false // Fall back to assuming invalid if no symbols available
  }
  const registry = symbols.getVisibleSymbols(registry_id)
  return Object.keys(registry).length > 0
}

/**
 * Returns a fresh `{ ordered, check }` derived from `imports`. Used so that
 * callers which hand us a shared constant (e.g. `NonEmptyStringImports` in
 * string.ts) don't have subsequent merges mutate the caller's object — which
 * would pollute every other handler that returns that same constant.
 *
 * Exported because `list.ts` (and potentially other compound handlers) need
 * to clone an inner type's `imports` before using it as a mutation target —
 * the inner handler may have returned a shared module-level constant
 * (`any`'s `static_value.imports`, `string`'s `static_value.not_empty`,
 * `string`'s `static_value.namespaced`), and any `add_import` after that would
 * leak the new path into every subsequent handler.
 */
export function clone_imports(imports: NonNullable<TypeHandlerResult['imports']>): NonNullable<TypeHandlerResult['imports']> {
  return {
    ordered: [...imports.ordered] as NonEmptyList<string>,
    check: new Map(imports.check),
  }
}

/**
 * Inserts an import path verbatim, without applying `TYPE_PREFIX`.
 *
 * For paths that have already been through `add_import` — notably when
 * `merge_imports` folds one result's imports into another's. Prefixing there
 * would apply `TYPE_PREFIX` a second time.
 */
function add_import_raw(imports: TypeHandlerResult['imports'], import_path: string): NonNullable<TypeHandlerResult['imports']> {
  if (imports === undefined) {
    return {
      ordered: [import_path] as NonEmptyList<string>,
      check: new Map<string, number>([[import_path, 0]]),
    } as const
  }
  if (imports.check.has(import_path)) {
    return imports
  }
  if (imports.ordered.length === 1) {
    // If there's only one import, skip the binary search.
    const existing_import = imports.ordered[0]
    if (compare_names(import_path, existing_import) < 0) {
      imports.ordered.unshift(import_path)
      imports.check.set(import_path, 0)
      imports.check.set(existing_import, 1)
    } else {
      imports.ordered.push(import_path)
      imports.check.set(import_path, 1)
    }
    return imports
  }

  // Use binary search to find the correct insertion point for the new import
  let left = 0
  let right = imports.ordered.length
  while (left < right) {
    const mid = Math.floor((left + right) / 2)
    const mid_path = imports.ordered[mid]
    if (compare_names(import_path, mid_path) < 0) {
      right = mid
    } else {
      left = mid + 1
    }
  }

  imports.ordered.splice(left, 0, import_path)
  imports.check.set(import_path, left)

  // Update indices in the map for all subsequent imports using ordered as a reference
  for (let i = left + 1; i < imports.ordered.length; i++) {
    imports.check.set(imports.ordered[i], i)
  }

  return imports
}

/**
 * Inserts a canonical import path, applying `TYPE_PREFIX` to its type name.
 *
 * This is the single place a `::java::…` path's type name gains the prefix, so
 * every caller may — and must — pass the path exactly as mcdoc spells it.
 * `sandstone::…` paths pass through untouched.
 */
export function add_import(imports: TypeHandlerResult['imports'], import_path: string): NonNullable<TypeHandlerResult['imports']> {
  return add_import_raw(imports, prefix_import_path(import_path))
}

/**
 * Builds an import set from a list of canonical paths.
 *
 * Prefer this over writing an `{ ordered, check }` object literal by hand.
 * `add_import` relies on `ordered` already being sorted to place new entries
 * with a binary search, and on `check` listing every path for dedup - a
 * hand-written literal that gets either wrong silently corrupts the ordering
 * of every import merged in afterwards.
 */
export function make_imports(...import_paths: NonEmptyList<string>): NonNullable<TypeHandlerResult['imports']> {
  let imports = undefined as unknown as TypeHandlerResult['imports']
  for (const import_path of import_paths) {
    imports = add_import(imports, import_path)
  }
  return imports as NonNullable<TypeHandlerResult['imports']>
}

export function merge_imports(
  imports: TypeHandlerResult['imports'],
  new_imports: NonNullable<TypeHandlerResult['imports']>,
  filter?: Set<string>,
): NonNullable<TypeHandlerResult['imports']> {
  // Clone the accumulator so we never mutate the caller's `imports`. Several
  // call sites pass module-level constants (`NonEmptyStringImports`,
  // `NamespacedStringImports`) as the accumulator; without this clone,
  // `add_import` would splice into those shared arrays and pollute every
  // other handler that returns them.
  const accumulator = imports === undefined
    ? { ordered: [] as string[], check: new Map<string, number>() }
    : clone_imports(imports)
  for (const import_path of new_imports.ordered) {
    if (filter?.has(import_path)) {
      continue
    }
    if (!accumulator.check.has(import_path)) {
      add_import_raw(accumulator as NonNullable<TypeHandlerResult['imports']>, import_path)
    }
  }
  return accumulator as unknown as NonNullable<TypeHandlerResult['imports']>
}

export function op(num: number | bigint, op: '+' | '-' | '*', operand: number | bigint): number | bigint {
  if (op === '*') {
    if (typeof num === 'number' && typeof operand === 'number') {
      return num * operand
    }
    return BigInt(num) * BigInt(operand)
  }
  if (op === '+') {
    if (typeof num === 'number' && typeof operand === 'number') {
      return num + operand
    }
    return BigInt(num) + BigInt(operand)
  }
  if (typeof num === 'number' && typeof operand === 'number') {
    return num - operand
  }
  return BigInt(num) - BigInt(operand)
}

export function sign(num: number | bigint) {
  if (typeof num === 'number') {
    return Math.sign(num)
  }
  if (num >= 0n) {
    return 1
  }
  return -1
}

export function abs(num: number | bigint) {
  if (typeof num === 'number') {
    return Math.abs(num)
  }
  if (num >= 0n) {
    return num
  }
  return -1n * num
}
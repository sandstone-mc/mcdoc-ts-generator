import type { SymbolUtil } from '@spyglassmc/core'
import type { TypeHandlerResult } from '.'

export type NonEmptyList<T> = T[] & { 0: T }

/**
 * Check if a registry has entries in the symbol table.
 * @param symbols The symbol utility
 * @param registry_id The registry ID with minecraft: prefix (e.g., 'minecraft:block')
 * @returns true if the registry is non-empty
 */
export function is_valid_registry(symbols: SymbolUtil | undefined, registry_id: string): boolean {
  if (symbols === undefined) {
    return true // Fall back to assuming valid if no symbols available
  }
  // Remove 'minecraft:' prefix to get the registry category name
  const registry_name = registry_id.replace(/^minecraft:/, '')
  const registry = symbols.getVisibleSymbols(registry_name as any)
  return Object.keys(registry).length > 0
}

export function add_import(imports: TypeHandlerResult['imports'], add_import: string): NonNullable<TypeHandlerResult['imports']> {
  if (imports === undefined) {
    return {
      ordered: [add_import] as NonEmptyList<string>,
      check: new Map<string, number>([[add_import, 0]]),
    } as const
  }
  if (imports.check.has(add_import)) {
    return imports
  }
  if (imports.ordered.length === 1) {
    // If there's only one import, skip the binary search.
    const existing_import = imports.ordered[0]
    if (add_import.localeCompare(existing_import) < 0) {
      imports.ordered.unshift(add_import)
      imports.check.set(add_import, 0)
      imports.check.set(existing_import, 1)
    } else {
      imports.ordered.push(add_import)
      imports.check.set(add_import, 1)
    }
    return imports
  }

  // Use binary search to find the correct insertion point for the new import
  let left = 0
  let right = imports.ordered.length
  while (left < right) {
    const mid = Math.floor((left + right) / 2)
    const mid_path = imports.ordered[mid]
    if (add_import.localeCompare(mid_path) < 0) {
      right = mid
    } else {
      left = mid + 1
    }
  }

  imports.ordered.splice(left, 0, add_import)
  imports.check.set(add_import, left)

  // Update indices in the map for all subsequent imports using ordered as a reference
  for (let i = left + 1; i < imports.ordered.length; i++) {
    imports.check.set(imports.ordered[i], i)
  }

  return imports
}

export function merge_imports(
  imports: TypeHandlerResult['imports'],
  new_imports: NonNullable<TypeHandlerResult['imports']>,
  filter?: Set<string>,
): NonNullable<TypeHandlerResult['imports']> {
  if (imports === undefined) {
    if (filter === undefined) {
      return new_imports
    }
  }
  for (const import_path of new_imports.ordered) {
    if (filter?.has(import_path)) {
      continue
    }
    if (imports === undefined || !imports.check.has(import_path)) {
      imports = add_import(imports, import_path)
    }
  }
  return imports!
}

// Thanks TypeScript
export class Set<T> extends global.Set<T> {
  has(value: unknown) {
    return super.has(value as any)
  }
}

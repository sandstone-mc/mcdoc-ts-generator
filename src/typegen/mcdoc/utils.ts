import type { TypeHandlerResult } from '.'

export type NonEmptyList<T> = T[] & { 0: T }

export function add_import(imports: TypeHandlerResult['imports'], add_import: string) {
    if (imports === undefined) {
        imports = {
            ordered: [] as unknown as NonEmptyList<string>,
            check: new Map<string, number>()
        } as const
    }
    if (imports.ordered.length === 1) {
        // If there's only one import, skip the binary search.
        const existingImport = imports.ordered[0]
        if (add_import.localeCompare(existingImport) < 0) {
            imports.ordered.unshift(add_import)
            imports.check.set(add_import, 0)
            imports.check.set(existingImport, 1)
        } else {
            imports.ordered.push(add_import)
            imports.check.set(add_import, 1)
        }
    }

    // Use binary search to find the correct insertion point for the new import
    let left = 0
    let right = imports.ordered.length
    while (left < right) {
        const mid = Math.floor((left + right) / 2)
        const midPath = imports.ordered[mid]
        if (add_import.localeCompare(midPath) < 0) {
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
}

export function merge_imports(
    imports: TypeHandlerResult['imports'],
    new_imports: NonNullable<TypeHandlerResult['imports']>,
) {
    if (imports === undefined) {
        imports = {
            ordered: [] as unknown as NonEmptyList<string>,
            check: new Map<string, number>()
        } as const
    }
    for (const import_path of new_imports.ordered) {
        if (!imports.check.has(import_path)) {
            add_import(imports, import_path)
        }
    }
}

// Thanks TypeScript
type GetConstructorArgs<T> = T extends new (...args: infer U) => any ? U : never
export class Set<T> extends global.Set<T> {
    constructor(...args: GetConstructorArgs<typeof global.Set<T>>) {
        super(...args)
    }
    has(value: unknown) {
        return super.has(value as any)
    }
}
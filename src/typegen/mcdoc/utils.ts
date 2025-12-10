import type { TypeHandlerResult } from '.'

export function add_import(imports: NonNullable<TypeHandlerResult['imports']>, add_import: string) {
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
    imports: NonNullable<TypeHandlerResult['imports']>,
    new_imports: NonNullable<TypeHandlerResult['imports']>,
) {
    for (const import_path of new_imports.ordered) {
        if (!imports.check.has(import_path)) {
            add_import(imports, import_path)
        }
    }
}

export function remove_imports(
    imports: TypeHandlerResult['imports'],
    remove_imports: Set<string>,
) {
    if (imports !== undefined) {
        for (const import_path of remove_imports) {
            const remove_import = imports.check.get(import_path)
            if (remove_import !== undefined) {
                imports.check.delete(import_path)
                imports.ordered.splice(remove_import, 1)
                for (let i = remove_import; i < imports.ordered.length; i++) {
                    imports.check.set(imports.ordered[i], i)
                }
            }
        }
    }
}

// Thanks TypeScript
type GetConstructorArgs<T> = T extends new (...args: infer U) => any ? U : never
export class Set<T> extends global.Set<T> {
    private readonly set: globalThis.Set<T>
    constructor(...args: GetConstructorArgs<typeof global.Set<T>>) {
        super(...args)
        this.set = this
    }
    has(value: unknown) {
        return this.set.has(value as any)
    }
}
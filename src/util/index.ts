import ts from 'typescript'

export function errorMessage(e: unknown): string {
    if (e instanceof Error) return e.message
    return `${e}`
}

// fuck you windows
export const join = (...paths: string[]) => paths.join('/')

export function pascal_case(name: string) {
    const words = name.split('_')
    return words
        .map((word) => word[0].toUpperCase() + word.slice(1))
        .join('')
}

export function camel_case(name: string) {
    const words = name.split('_')
    if (words.length === 1) return name
    return words[0] + words
        .slice(1)
        .map((word) => word[0].toUpperCase() + word.slice(1))
        .join('')
}

export function pluralize(name: string) {
    if (name.endsWith('y')) return name.slice(0, -1) + 'ies'
    if (name.endsWith('s') || name.endsWith('ch') || name.endsWith('sh') || name.endsWith('x') || name.endsWith('z')) return name + 'es'
    return name + 's'
}

/**
 * Helper to add a key-value pair to an object if the value is not undefined.
 * 
 * Unfortunately TypeScript doesn't properly support empty object types, even with this attempted workaround, we still get `{ (key): (value) | undefined }` instead of `{ (key): (value) } | Record<string, never>`.
 *
 * @returns An object with the key-value pair if the value is not undefined, otherwise an empty object.
 */
export function add<K extends string, V extends NonNullable<any>>(key: K, value: V): {[P in K]: V}
export function add<K extends string, V extends undefined>(key: K, value: V): Record<string, never>
export function add(key: string, value: any) {
    if (value === undefined) {
        return {}
    } else {
        return { [key]: value }
    }
}
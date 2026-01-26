export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  return `${e}`
}

// fuck you windows
export const join = (...paths: string[]) => paths.join('/')

export function pascal_case(name: string) {
  const words = name.split(/\/|_/)
  return words
    .map((word) => `${word[0].toUpperCase()}${word.slice(1)}`)
    .join('')
}

export function camel_case(name: string) {
  const words = name.split('_')
  if (words.length === 1) return name
  return `${words[0]}${words
    .slice(1)
    .map((word) => `${word[0].toUpperCase()}${word.slice(1)}`)
    .join('')}`
}

export function pluralize(name: string) {
  if (name.endsWith('ey')) return `${name}s`
  if (name.endsWith('y')) return `${name.slice(0, -1)}ies`
  if (name.endsWith('s') || name.endsWith('ch') || name.endsWith('sh') || name.endsWith('x') || name.endsWith('z')) return `${name}es`
  return `${name}s`
}

// --- 1. Utilities to convert Union to Tuple (Standard TS Magic) ---
type UnionToIntersection<U> =
  (U extends any ? (k: U) => void : never) extends ((k: infer I) => void) ? I : never

type LastOf<T> =
  UnionToIntersection<T extends any ? () => T : never> extends () => (infer R) ? R : never

type Push<T extends any[], V> = [...T, V]

// Recursively moves items from Union T to a Tuple
type UnionToTuple<T, L = LastOf<T>, N = [T] extends [never] ? true : false> =
  true extends N ? [] : Push<UnionToTuple<Exclude<T, L>>, L>

// --- 2. The PowerSet Logic (Linear Recursion) ---
// We iterate over the tuple of keys. For every key, we double the result:
// (Current Results) | (Current Results + New Key)
type PowerSet<T, Keys extends any[] = UnionToTuple<keyof T>> =
  Keys extends [infer Head, ...infer Rest]
  ? PowerSet<T, Rest> | (
    Head extends keyof T
    ? { [K in Head]: NonNullable<T[K]> } & PowerSet<T, Rest>
    : never
  )
  : Record<string, never> // Base case: Empty object

// --- 3. Prettify Helper ---
// Merges intersections ({a:1} & {b:2}) into clean objects ({a:1, b:2})
// and distributes over the union to make tooltips readable.
type Prettify<T> = {
  [K in keyof T]: T[K]
} & {}

/**
 * Helper to add key-value pairs to an object if the values are not undefined.
 *
 * @returns An object with the key-value pairs if the values are not undefined, otherwise an empty object.
 */
export function add<O extends Record<string, any>>(obj: O): Prettify<PowerSet<O>> {
  const filtered = {}

  for (const key of Object.keys(obj)) {
    const value = obj[key]
    if (value !== undefined) {
      // @ts-ignore
      filtered[key] = value
    }
  }

  // @ts-ignore
  return filtered
}

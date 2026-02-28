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
  // Words ending in vowel + y get 's' (e.g., display -> displays, key -> keys)
  if (/[aeiou]y$/i.test(name)) {
    return `${name}s`
  }
  // Words ending in consonant + y get 'ies' (e.g., entity -> entities)
  if (name.endsWith('y')) {
    return `${name.slice(0, -1)}ies`
  }
  // Words ending in common plural consonant + s are likely already plural
  // e.g., methods (ds), patterns (ns), events (ts), fonts (ts), items (ms)
  // Excludes ss, which needs -es (boss -> bosses)
  if (/[bdfgklmnprtvw]s$/i.test(name)) {
    return name
  }
  // Words ending in s, ch, sh, x, z get 'es'
  if (name.endsWith('s') || name.endsWith('ch') || name.endsWith('sh') || name.endsWith('x') || name.endsWith('z')) {
    return `${name}es`
  }
  return `${name}s`
}

export type UnionToIntersection<U> = (
  (U extends any ? (k: U) => void : never) extends ((k: infer I) => void) ? I : never
)

export type LastOf<T> = (
  UnionToIntersection<T extends any ? () => T : never> extends () => (infer R) ? R : never
)

export type Push<T extends any[], V> = [...T, V]

export type UnionToTuple<T, L = LastOf<T>, N = [T] extends [never] ? true : false> = (
  true extends N ? [] : Push<UnionToTuple<Exclude<T, L>>, L>
)

export type PowerSet<T, Keys extends any[] = UnionToTuple<keyof T>> = (
  Keys extends [infer Head, ...infer Rest]
  ? PowerSet<T, Rest> | (
    Head extends keyof T
    ? { [K in Head]: NonNullable<T[K]> } & PowerSet<T, Rest>
    : never
  )
  : Record<string, never>
)

export type Prettify<T> = ({
  [K in keyof T]: T[K]
} & {})

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

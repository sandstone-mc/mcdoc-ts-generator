/**
 * Optional prefix applied to every identifier this generator declares — type
 * aliases, dispatcher `Symbol*` types, and value consts alike.
 *
 * Set with the `MCDOC_TYPE_PREFIX` environment variable, e.g.:
 *   MCDOC_TYPE_PREFIX=Mc bun compile
 *   MCDOC_TYPE_PREFIX=Mc bun update-from-mcdoc
 *
 * Defaults to `''`, which leaves every name untouched. Consumers that pull the
 * generated types in alongside their own declarations can set this to keep the
 * two namespaces from colliding.
 *
 * The prefix is joined verbatim, so separators are the caller's business
 * (`MCDOC_TYPE_PREFIX=Mc_` yields `Mc_Registry`). The one exception is casing:
 * a SCREAMING_CASE name gets an upper-cased prefix so it stays screaming
 * (`BLOCKS` -> `MCBLOCKS`, not `McBLOCKS`).
 *
 * ## Where the prefix is applied
 *
 * Every `::java::…` path string in the generator stays canonical (unprefixed) —
 * they're lookup keys, and mcdoc hands them to us that way. `add_import()` in
 * `mcdoc/utils.ts` is the single place a path's type name gains the prefix.
 * Emitted identifiers gain it at their creation site via `prefix_name`.
 *
 * The prefix always lands at the *front of the complete identifier*
 * (`McSymbolFoo`, never `SymbolMcFoo`) so that "prefix the path's last segment"
 * and "prefix the emitted name" can't disagree.
 */
export const TYPE_PREFIX = process.env['MCDOC_TYPE_PREFIX'] ?? ''

const has_lowercase = /[a-z]/

/**
 * Prefixes a complete generated identifier.
 *
 * Must only be handed names this generator declares. Sandstone exports
 * (`NonEmptyString`, `TagClass`, …) and TypeScript builtins (`Extract`,
 * `Record`, …) are not ours to rename.
 */
export function prefix_name(name: string): string {
  if (TYPE_PREFIX === '') {
    return name
  }
  if (has_lowercase.test(name)) {
    return `${TYPE_PREFIX}${name}`
  }
  return `${TYPE_PREFIX.toUpperCase()}${name}`
}

/**
 * Sandstone types that follow `TYPE_PREFIX` instead of passing through.
 *
 * These are special because their definitions reference *generated* types:
 * `NBTObject` includes `TextObject`, and `RootNBT` / `NBTList` are built on
 * `NBTObject`. A prefixed generation has its own `TextObject`, so it needs its
 * own `NBTObject` to point at - reusing sandstone's would quietly splice the
 * unprefixed surface into the prefixed one.
 *
 * The consumer is expected to declare the prefixed twins (for
 * `MCDOC_TYPE_PREFIX=Json`: `JsonNBTObject`, `JsonRootNBT`, `JsonNBTList`).
 *
 * Every other `sandstone::…` import is a plain runtime or utility type with no
 * tie to generated output, and must NOT be prefixed.
 */
const PREFIXED_SANDSTONE_TYPES = new Set(['NBTObject', 'RootNBT', 'NBTList'])

/**
 * Prefixes a sandstone type name if it is one of the few that follow the
 * prefix, and returns it untouched otherwise.
 *
 * Use this at emission sites that name these types directly, so the set above
 * stays the single source of truth for both the name and its import path.
 */
export function prefix_sandstone_name(name: string): string {
  return PREFIXED_SANDSTONE_TYPES.has(name) ? prefix_name(name) : name
}

/**
 * Prefixes the type name at the end of a `::java::…` import path, leaving the
 * module portion alone. `sandstone::…` paths point at real sandstone exports
 * and pass through untouched, except for `PREFIXED_SANDSTONE_TYPES`.
 */
export function prefix_import_path(path: string): string {
  if (TYPE_PREFIX === '') {
    return path
  }
  const separator = path.lastIndexOf('::')
  const name = path.slice(separator + 2)

  if (path.startsWith('::java::')) {
    return `${path.slice(0, separator + 2)}${prefix_name(name)}`
  }
  if (path.startsWith('sandstone::') && PREFIXED_SANDSTONE_TYPES.has(name)) {
    return `${path.slice(0, separator + 2)}${prefix_name(name)}`
  }
  return path
}

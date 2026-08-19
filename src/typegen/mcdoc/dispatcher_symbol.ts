import ts from 'typescript'
import type { SymbolMap, SymbolUtil } from '@spyglassmc/core'
import type * as mcdoc from '@spyglassmc/mcdoc'
import { get_type_handler, type NonEmptyList, type TypeHandlerResult } from '.'
import type { DispatcherInfo } from '..'
import { add_import, merge_imports, Set } from './utils'
import { Bind } from './bind'
import { add, compare_names, pascal_case } from '../../util'
import { prefix_import_path, prefix_name } from '../prefix'
import { Assert } from './assert'
import { ReleaseVersion, TARGET_VERSION } from './version'

const { factory } = ts

const NBTObject = factory.createTypeReferenceNode('NBTObject')
const NBTObjectImport = 'sandstone::arguments::nbt::NBTObject'

export type DispatcherReferenceCounter = {
  /**
   * Map<path: string, location_counts_index: number>
   */
  locations: Map<string, number>
  location_counts: [path: string, count: number][]
}

export const dispatcher_references = new Map<string, DispatcherReferenceCounter>()

export type DispatcherExportInfo = {
  /** The symbol name without the path (e.g., "SymbolEntityEffect") */
  symbol_name: string
  /** The base name without Symbol prefix (e.g., "EntityEffect") */
  base_name: string
  /** Whether this dispatcher exports a FallbackType */
  has_fallback_type: boolean
}

/**
 * Global map of dispatcher symbol paths to their export info.
 * Populated during `resolve_dispatcher_symbols`.
 */
export const dispatcher_symbol_paths = new Map<string, DispatcherExportInfo>()

type DispatcherSymbolResult = {
  /**
   * The main exported type `SymbolName<CASE>` and all supporting type aliases (member types, map, keys, fallback, unknown)
   */
  readonly types: (ts.TypeAliasDeclaration | ts.EnumDeclaration)[]
  /**
   * Import paths required by this dispatcher
   */
  readonly imports?: {
    readonly ordered: NonEmptyList<string>
    readonly check: Map<string, number>
  }
  readonly references?: DispatcherReferenceCounter
  /**
   * Number of required generic parameters for this dispatcher (excluding CASE).
   * Determined by whether the first member is a template type.
   */
  readonly generic_count: number
}

type DispatcherMember = { typeDef: mcdoc.McdocType }

/**
 * Drops dispatcher members that aren't available in the target Minecraft version.
 *
 * - `since: X` where X > TARGET → not yet added in our target → drop
 * - `until: X` where X <= TARGET → already removed by our target → drop
 *
 * Returns true if the member should be skipped.
 */
function is_dispatcher_member_unsupported(type_def: mcdoc.McdocType): boolean {
  const attrs = type_def.attributes
  if (attrs === undefined) {
    return false
  }
  Assert.Attributes(attrs, true)
  for (const attr of attrs) {
    if (attr.name === 'since' && ReleaseVersion.cmp(attr.value.value.value as ReleaseVersion, TARGET_VERSION) > 0) {
      return true
    }
    if (attr.name === 'until' && ReleaseVersion.cmp(attr.value.value.value as ReleaseVersion, TARGET_VERSION) <= 0) {
      return true
    }
  }
  return false
}

/**
 * Generates a dispatcher symbol map with the following structure:
 * ```ts
 * export type NameFallbackType<T> = { ... }  // Only if %unknown is present
 * type NameNoneType<T> = { ... }  // Only if %none is present
 * type NameMemberA<T> = { ... }
 * type NameMemberB<T> = { ... }
 * type NameMap<T> = { 'a': NameMemberA<T>, 'b': NameMemberB<T> }
 * type NameKeys = keyof NameMap<unknown>
 * type NameFallback<T> = NameMemberA<T> | NameMemberB<T> | NameFallbackType<T>
 * export type SymbolName<T, CASE extends ('map' | 'keys' | '%fallback' | '%none') = 'map'> = ...
 * ```
 *
 * Generic parameters (e.g., `<T>`) are only present if the dispatcher members are template types.
 * When present, generics are extracted from the first member and propagated to all type aliases.
 * CASE always comes after any dispatcher generics in the main Symbol type because required type generics must proceed optional ones.
 *
 * Special keys in dispatcher members:
 * - `%unknown`: Defines fallback type for arbitrary string keys not in the map, doesn't actually work because of TypeScript limitations
 * - `%none`: Indicates the dispatcher key can be omitted. Handled during dispatcher use.
 */
export function dispatcher_symbol(
  id: string,
  name: string,
  members: SymbolMap,
  dispatcher_info: Map<string, DispatcherInfo>,
  module_map: SymbolMap,
  symbols: SymbolUtil,
): DispatcherSymbolResult {
  let imports = undefined as unknown as TypeHandlerResult['imports']
  let has_references = false

  // Every name this dispatcher declares. `name` itself stays canonical - it is
  // only ever a building block here, never emitted on its own.
  const symbol_id = prefix_name(`Symbol${name}`)
  const fallback_type_id = prefix_name(`${name}FallbackType`)
  const none_type_id = prefix_name(`${name}NoneType`)
  const map_id = prefix_name(`${name}DispatcherMap`)
  const keys_id = prefix_name(`${name}Keys`)
  const fallback_id = prefix_name(`${name}Fallback`)

  // Self-import path to filter out to prevent cycles
  const self_import = new Set([prefix_import_path(`::java::dispatcher::Symbol${name}`)])

  const member_types: ts.TypeAliasDeclaration[] = []
  const map_properties: ts.PropertySignature[] = []
  const member_type_refs: ts.TypeReferenceNode[] = []

  // Sorted so the emitted map, member aliases and generics check don't track
  // Spyglass's symbol iteration order, which isn't stable between runs.
  const member_keys = Object.keys(members).sort(compare_names)

  // Check first member for generics (if dispatcher has generics, all members have them).
  // Skip the special keys - `precompute_dispatcher_info` runs the same check against the
  // first non-special member, and the two have to agree on the answer.
  const first_member = members[member_keys.find((key) => !key.startsWith('%')) ?? member_keys[0]]
  const first_type = (first_member.data as DispatcherMember).typeDef

  const has_generics = first_type.kind === 'template'
  const generic_params: ts.TypeParameterDeclaration[] = []
  const generic_names: ts.TypeReferenceNode[] = []

  if (has_generics && first_type.kind === 'template') {
    const template = first_type

    for (const type_param of template.typeParams) {
      // Extract the generic name from the path (last segment)
      const param_name = type_param.path.split('::').pop()!

      generic_params.push(factory.createTypeParameterDeclaration(undefined, param_name, NBTObject))
      generic_names.push(factory.createTypeReferenceNode(param_name))
    }

    // Add NBTObject import for generic constraints
    imports = add_import(imports, NBTObjectImport)
  }

  const add_reference = () => {
    has_references = true
    if (!dispatcher_references.has(id)) {
      dispatcher_references.set(id, {
        locations: new Map(),
        location_counts: [],
      })
    }
    return dispatcher_references.get(id)!
  }

  // Check for special keys and resolve their types

  let fallback_type_name: ts.TypeReferenceNode | undefined

  // Process %unknown to get the fallback type
  if ('%unknown' in members) {
    const unknown_member = (members['%unknown'].data as DispatcherMember).typeDef!

    const result = get_type_handler(unknown_member)(unknown_member)({
      root_type: true,
      name: fallback_type_id,
      dispatcher_symbol: add_reference,
      dispatcher_info,
      module_map,
      symbols,
    })

    // Collect imports from fallback type
    if ('imports' in result) {
      imports = merge_imports(imports, result.imports, self_import)
    }

    fallback_type_name = factory.createTypeReferenceNode(
      fallback_type_id,
      has_generics ? generic_names : undefined,
    )
    if (ts.isTypeAliasDeclaration(result.type)) {
      member_types.push(result.type)
    } else {
      member_types.push(factory.createTypeAliasDeclaration(
        [factory.createModifier(ts.SyntaxKind.ExportKeyword)],
        fallback_type_id,
        undefined,
        result.type as ts.TypeNode,
      ))
    }
  }

  const has_none = '%none' in members

  // Process %none to get the none type
  if (has_none) {
    const none_member = (members['%none'].data as DispatcherMember).typeDef!

    const result = get_type_handler(none_member)(none_member)({
      root_type: true,
      name: none_type_id,
      dispatcher_symbol: add_reference,
      dispatcher_info,
      module_map,
      symbols,
    })

    // Collect imports from none type
    if ('imports' in result) {
      imports = merge_imports(imports, result.imports, self_import)
    }

    if (ts.isTypeAliasDeclaration(result.type)) {
      member_types.push(result.type)
    } else {
      member_types.push(factory.createTypeAliasDeclaration(
        undefined,
        none_type_id,
        undefined,
        result.type as ts.TypeNode,
      ))
    }
  }

  for (const member_key of member_keys) {
    const member = members[member_key]
    // Skip special keys
    if (member_key.startsWith('%')) {
      continue
    }

    const member_type = (member.data as DispatcherMember).typeDef!

    if (is_dispatcher_member_unsupported(member_type)) {
      continue
    }

    const member_type_name = prefix_name(`${name}${pascal_case(member_key.replace(/[/:]/g, '_'))}`)

    // Resolve the member type using the mcdoc type handlers
    const result = get_type_handler(member_type)(member_type)({
      root_type: true,
      name: member_type_name,
      dispatcher_symbol: add_reference,
      dispatcher_info,
      module_map,
      symbols,
    })

    // Collect imports
    if ('imports' in result) {
      imports = merge_imports(imports, result.imports, self_import)
    }

    // Once/if the dispatcher symbol map gets declaration paths we can add these directly to the modules they belong in

    // Create member type alias (with generics if present)
    if (ts.isTypeAliasDeclaration(result.type)) {
      member_types.push(result.type)
    } else {
      member_types.push(factory.createTypeAliasDeclaration(
        undefined,
        member_type_name,
        undefined,
        result.type as ts.TypeNode,
      ))
    }

    // Create reference to the member type (with generics if present)
    const member_ref = factory.createTypeReferenceNode(
      member_type_name,
      has_generics ? generic_names : undefined,
    )
    member_type_refs.push(member_ref)

    // Create map property
    map_properties.push(
      factory.createPropertySignature(
        undefined,
        factory.createStringLiteral(member_key, true),
        undefined,
        member_ref,
      ),
      factory.createPropertySignature(
        undefined,
        factory.createStringLiteral(`minecraft:${member_key}`, true),
        undefined,
        member_ref,
      ),
    )
  }

  // Create NameMap type
  // If %unknown is present, intersect with an index signature for arbitrary keys
  const map_type = factory.createTypeAliasDeclaration(
    undefined,
    map_id,
    has_generics ? generic_params : undefined,
    factory.createTypeLiteralNode(map_properties),
  )

  // Create NameKeys type (no generics needed - keys don't depend on type params)
  const keys_type = factory.createTypeAliasDeclaration(
    undefined,
    keys_id,
    undefined,
    factory.createTypeOperatorNode(
      ts.SyntaxKind.KeyOfKeyword,
      factory.createTypeReferenceNode(
        map_id,
        has_generics ? generic_names.map(() => factory.createTypeReferenceNode('NBTObject')) : undefined,
      ),
    ),
  )

  // Create NameFallback type (union of all members + fallback type if present)
  const fallback_union_members = fallback_type_name
    ? [...member_type_refs, fallback_type_name]
    : member_type_refs
  const fallback_type = factory.createTypeAliasDeclaration(
    undefined,
    fallback_id,
    has_generics ? generic_params : undefined,
    factory.createParenthesizedType(factory.createUnionTypeNode(fallback_union_members)),
  )

  // Create the main Symbol type with CASE generic first, then dispatcher generics
  const has_unknown = fallback_type_name !== undefined

  generic_params.push(factory.createTypeParameterDeclaration(
    undefined,
    'CASE',
    factory.createUnionTypeNode([
      Bind.StringLiteral('map'),
      Bind.StringLiteral('keys'),
      Bind.StringLiteral('%fallback'),
      Bind.StringLiteral('%none'),
      Bind.StringLiteral('%unknown'),
    ]),
    Bind.StringLiteral('map'),
  ))

  // Build conditional chain from innermost to outermost
  // %unknown → %none → %fallback → keys → map
  let innermost_conditional: ts.TypeNode = factory.createKeywordTypeNode(ts.SyntaxKind.NeverKeyword)

  // Add %unknown case if fallback type exists
  if (has_unknown) {
    innermost_conditional = factory.createConditionalTypeNode(
      factory.createTypeReferenceNode('CASE'),
      Bind.StringLiteral('%unknown'),
      factory.createTypeReferenceNode(fallback_type_id, has_generics ? generic_names : undefined),
      innermost_conditional,
    )
  }

  // Add %none case if none type exists
  if (has_none) {
    innermost_conditional = factory.createConditionalTypeNode(
      factory.createTypeReferenceNode('CASE'),
      Bind.StringLiteral('%none'),
      factory.createTypeReferenceNode(none_type_id, has_generics ? generic_names : undefined),
      innermost_conditional,
    )
  }

  const symbol_type = factory.createTypeAliasDeclaration(
    [factory.createModifier(ts.SyntaxKind.ExportKeyword)],
    symbol_id,
    generic_params,
    factory.createConditionalTypeNode(
      factory.createTypeReferenceNode('CASE'),
      Bind.StringLiteral('map'),
      factory.createTypeReferenceNode(map_id, has_generics ? generic_names : undefined),
      factory.createConditionalTypeNode(
        factory.createTypeReferenceNode('CASE'),
        Bind.StringLiteral('keys'),
        factory.createTypeReferenceNode(keys_id),
        factory.createConditionalTypeNode(
          factory.createTypeReferenceNode('CASE'),
          Bind.StringLiteral('%fallback'),
          factory.createTypeReferenceNode(fallback_id, has_generics ? generic_names : undefined),
          innermost_conditional,
        ),
      ),
    ),
  )

  return {
    types: [
      map_type,
      keys_type,
      fallback_type,
      ...member_types,
      symbol_type,
    ],
    ...add({ imports }),
    ...(has_references ? { references: dispatcher_references.get(id)! } : {}),
    generic_count: has_generics && first_type.kind === 'template' ? first_type.typeParams.length : 0,
  } as const
}

export const DispatcherSymbol = dispatcher_symbol

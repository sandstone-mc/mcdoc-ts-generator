import ts from 'typescript'
import * as je from '@spyglassmc/java-edition'
import type { ResolvedSymbol } from '.'
import { Set, type NormalNonTagResource } from './mcdoc/utils'
import { ReleaseVersion, TARGET_VERSION } from './mcdoc/version'
import { prefix_name } from './prefix'

const { factory } = ts

/**
 * Maps Minecraft resource type IDs to their sandstone class names.
 * Used by the string type handler to resolve resource class types.
 */
export const RESOURCE_CLASSES = {
  // Datapack resources
  'advancement': 'AdvancementClass',
  'banner_pattern': 'BannerPatternClass',
  'chat_type': 'ChatTypeClass',
  'damage_type': 'DamageTypeClass',
  'decorated_pot_pattern': 'DecoratedPotPatternClass',
  'dialog': 'DialogClass',
  'enchantment': 'EnchantmentClass',
  'enchantment_provider': 'EnchantmentProviderClass',
  'function': 'MCFunctionClass',
  'instrument': 'InstrumentClass',
  'item_modifier': 'ItemModifierClass',
  'jukebox_song': 'JukeboxSongClass',
  'loot_table': 'LootTableClass',
  'predicate': 'PredicateClass',
  'recipe': 'RecipeClass',
  'slot_source': 'SlotSourceClass',
  'structure': 'StructureClass',
  'sulfur_cube_archetype': 'SulfurCubeArchetypeClass',
  'test_environment': 'TestEnvironmentClass',
  'test_instance': 'TestInstanceClass',
  'timeline': 'TimelineClass',
  'trade_set': 'TradeSetClass',
  'trial_spawner': 'TrialSpawnerClass',
  'trim_material': 'TrimMaterialClass',
  'trim_pattern': 'TrimPatternClass',
  'villager_trade': 'VillagerTradeClass',
  'world_clock': 'WorldClockClass',

  // Resourcepack resources
  'atlas': 'AtlasClass',
  'block_definition': 'BlockStateDefinitionClass',
  'equipment': 'EquipmentClass',
  'font': 'FontClass',
  'item_definition': 'ItemModelDefinitionClass',
  'lang': 'LanguageClass',
  'model': ['ModelClass', 'ModelType'],
  'particle': 'ParticleClass',
  'post_effect': 'PostEffectClass',
  'sound': 'SoundEventClass',
  'texture': ['TextureClass', 'TextureType'],
  'waypoint_style': 'WaypointStyleClass',
} as const satisfies Record<NormalNonTagResource, string | readonly [string, string]>

export type ResourceClassName = typeof RESOURCE_CLASSES[keyof typeof RESOURCE_CLASSES]

/**
 * Returns true when the resource is available in the target Minecraft version.
 *
 * A resource is supported when its `since` (if any) is at or before TARGET
 * AND its `until` (if any) is strictly after TARGET (inclusive `until` would
 * be the last version the resource existed in).
 */
function is_resource_supported(resource: { since?: ReleaseVersion, until?: ReleaseVersion }): boolean {
  if (resource.since !== undefined && ReleaseVersion.cmp(resource.since, TARGET_VERSION) > 0) {
    return false
  }
  if (resource.until !== undefined && ReleaseVersion.cmp(resource.until, TARGET_VERSION) <= 0) {
    return false
  }
  return true
}

/**
 * Builds a set of resource categories from the Spyglass binder that are valid
 * for the target Minecraft version.
 */
function get_supported_resource_categories(): Set<string> {
  const categories = new Set<string>()
  for (const resource of je.binder.getResources()) {
    if (!is_resource_supported(resource)) {
      continue
    }
    categories.add(resource.category)
  }
  return categories
}

/**
 * Collects resource metadata from Spyglass binder, excluding tag/* and worldgen/*
 * entries (which get special handling) and resources that aren't supported in
 * the target Minecraft version. Also appends the synthetic `tag` entry.
 */
function collect_resources() {
  const resources: Array<{
    category: string
    path: string[]
    pack: 'data' | 'assets'
    ext: string
  }> = []

  for (const resource of je.binder.getResources()) {
    if (!is_resource_supported(resource)) {
      continue
    }
    // Skip individual tag/* entries - we add a single tag entry instead
    if (resource.category.startsWith('tag/') || resource.category.startsWith('worldgen/')) {
      continue
    }

    resources.push({
      category: resource.category,
      path: resource.path.split('/'),
      pack: resource.pack,
      ext: resource.ext,
    })
  }

  return resources
}

/**
 * Generates `RESOURCE_PATHS` for `resource-paths.ts`.
 *
 * Maps resource category -> { path, pack, ext }, plus a synthetic `tag` entry.
 */
export function export_resource_paths(): ResolvedSymbol {
  const resources = collect_resources()

  const resource_path_entries = resources.map((r) =>
    factory.createPropertyAssignment(
      factory.createStringLiteral(r.category, true),
      factory.createObjectLiteralExpression([
        factory.createPropertyAssignment('path', factory.createArrayLiteralExpression(
          r.path.length === 1 && r.path[0] === '' ? [] : r.path.map((p) => factory.createStringLiteral(p, true)),
        )),
        factory.createPropertyAssignment('pack', factory.createStringLiteral(r.pack, true)),
        factory.createPropertyAssignment('ext', factory.createStringLiteral(r.ext, true)),
      ], false),
    ),
  )

  // Add special tag entry with path: ['tags', true]
  resource_path_entries.push(factory.createPropertyAssignment(
    factory.createStringLiteral('tag', true),
    factory.createObjectLiteralExpression([
      factory.createPropertyAssignment('path', factory.createArrayLiteralExpression([
        factory.createStringLiteral('tags', true),
        factory.createTrue(),
      ])),
      factory.createPropertyAssignment('pack', factory.createStringLiteral('data', true)),
      factory.createPropertyAssignment('ext', factory.createStringLiteral('.json', true)),
    ], false),
  ))

  const resource_paths_var = factory.createVariableStatement(
    [factory.createToken(ts.SyntaxKind.ExportKeyword)],
    factory.createVariableDeclarationList(
      [factory.createVariableDeclaration(
        prefix_name('RESOURCE_PATHS'),
        undefined,
        undefined,
        factory.createAsExpression(
          factory.createObjectLiteralExpression(resource_path_entries, true),
          factory.createTypeReferenceNode('const'),
        ),
      )],
      ts.NodeFlags.Const,
    ),
  )

  return {
    exports: [resource_paths_var] as ResolvedSymbol['exports'],
    paths: new Set<string>(),
  }
}

/**
 * Generates `RESOURCE_CLASS_TYPES` for `resources.ts`, plus the runtime class
 * import declaration. RESOURCE_PATHS lives in resource-paths.ts now.
 *
 * `RESOURCE_CLASSES` is the full map for type-handler lookups (used by
 * `string.ts`); at generate time we filter out entries whose Spyglass binder
 * resource isn't supported in the target version so we don't emit imports
 * for classes that don't exist on this Minecraft version.
 */
export function export_resources(): ResolvedSymbol {
  const supported_categories = get_supported_resource_categories()

  // --- Filter RESOURCE_CLASSES down to supported categories ---
  const supported_classes = (Object.entries(RESOURCE_CLASSES) as [string, string][])
    .filter(([type_id]) => supported_categories.has(type_id))

  const class_names = [...supported_classes.map(([, entry]) => Array.isArray(entry) ? entry[0] : entry), 'TagClass']
  const class_entries: ts.ArrayLiteralExpression[] = []

  for (const [type_id, entry] of supported_classes) {
    const class_name = Array.isArray(entry) ? entry[0] : entry
    class_entries.push(factory.createArrayLiteralExpression([
      factory.createIdentifier(class_name),
      factory.createStringLiteral(type_id, true),
    ]))
  }

  // Add TagClass (maps to generic tag resource type)
  class_entries.push(factory.createArrayLiteralExpression([
    factory.createIdentifier('TagClass'),
    factory.createStringLiteral('tag', true),
  ]))

  const class_to_resource_type_var = factory.createVariableStatement(
    [factory.createToken(ts.SyntaxKind.ExportKeyword)],
    factory.createVariableDeclarationList(
      [factory.createVariableDeclaration(
        prefix_name('RESOURCE_CLASS_TYPES'),
        undefined,
        undefined,
        factory.createAsExpression(
          factory.createArrayLiteralExpression(class_entries, true),
          factory.createTypeReferenceNode('const'),
        ),
      )],
      ts.NodeFlags.Const,
    ),
  )

  // --- Generate import declaration for class constructors (value import, not type-only) ---
  const class_import = factory.createImportDeclaration(
    undefined,
    factory.createImportClause(
      false, // NOT type-only - we need the actual class constructors at runtime
      undefined,
      factory.createNamedImports(
        class_names.map((name) => factory.createImportSpecifier(false, undefined, factory.createIdentifier(name))),
      ),
    ),
    factory.createStringLiteral('sandstone', true),
  )

  return {
    exports: [
      class_import,
      class_to_resource_type_var,
    ] as ResolvedSymbol['exports'],
    paths: new Set<string>(),
  }
}

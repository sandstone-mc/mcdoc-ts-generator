import ts from 'typescript'
import * as je from '@spyglassmc/java-edition'
import type { ResolvedSymbol } from '.'
import { Set, type NormalNonTagResource } from './mcdoc/utils'

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
  'structure': 'StructureClass',
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
  'block_definition': 'BlockStateClass',
  'equipment': 'EquipmentClass',
  'font': 'FontClass',
  'item_definition': 'ItemModelDefinitionClass',
  'lang': 'LanguageClass',
  'model': 'ModelClass',
  'particle': 'ParticleClass',
  'post_effect': 'PostEffectClass',
  'sound': 'SoundEventClass',
  'texture': 'TextureClass',
  'waypoint_style': 'WaypointStyleClass',
} as const satisfies Record<NormalNonTagResource, string>

export type ResourceClassName = typeof RESOURCE_CLASSES[keyof typeof RESOURCE_CLASSES]

/**
 * Generates resource path mappings from Spyglass binder.
 *
 * Produces:
 * - RESOURCE_PATHS: Map from resource category to path info
 * - RESOURCE_CLASS_TYPES: Object mapping class names to resource type IDs (reversed)
 * - CLASS_TO_RESOURCE_TYPE: Runtime Map with class imports
 */
export function export_resources(): ResolvedSymbol {
  // Collect resources that are valid for the current release (excluding tag/* entries)
  const resources: Array<{
    category: string
    path: string[]
    pack: 'data' | 'assets'
    ext: string
  }> = []

  for (const resource of je.binder.getResources()) {
    if (resource.until !== undefined) {
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

  // --- Generate RESOURCE_PATHS map ---
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
        'RESOURCE_PATHS',
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

  // --- Generate CLASS_TO_RESOURCE_TYPE Map with imports ---
  // Includes: regular resource classes, TagClass
  const class_names = [...Object.values(RESOURCE_CLASSES), 'TagClass']
  const class_entries: ts.ArrayLiteralExpression[] = []

  // Add regular resource classes
  for (const [type_id, class_name] of Object.entries(RESOURCE_CLASSES)) {
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
        'RESOURCE_CLASS_TYPES',
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
      resource_paths_var,
      class_to_resource_type_var,
    ] as ResolvedSymbol['exports'],
    paths: new Set<string>(),
  }
}

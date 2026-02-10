import ts from 'typescript'
import * as je from '@spyglassmc/java-edition'
import { ReleaseVersion } from '@spyglassmc/java-edition/lib/dependency/index.js'
import type { ResolvedSymbol } from '.'

const { factory } = ts

/**
 * Maps Minecraft resource type IDs to their sandstone class names.
 * Used by the string type handler to resolve resource class types.
 */
export const RESOURCE_CLASSES = {
  // Datapack resources
  'minecraft:advancement': 'AdvancementClass',
  'minecraft:banner_pattern': 'BannerPatternClass',
  'minecraft:chat_type': 'ChatTypeClass',
  'minecraft:damage_type': 'DamageTypeClass',
  'minecraft:dialog': 'DialogClass',
  'minecraft:enchantment': 'EnchantmentClass',
  'minecraft:enchantment_provider': 'EnchantmentProviderClass',
  'minecraft:function': 'MCFunctionClass',
  'minecraft:instrument': 'InstrumentClass',
  'minecraft:item_modifier': 'ItemModifierClass',
  'minecraft:jukebox_song': 'JukeboxSongClass',
  'minecraft:loot_table': 'LootTableClass',
  'minecraft:predicate': 'PredicateClass',
  'minecraft:recipe': 'RecipeClass',
  'minecraft:structure': 'StructureClass',
  'minecraft:test_environment': 'TestEnvironmentClass',
  'minecraft:test_instance': 'TestInstanceClass',
  'minecraft:timeline': 'TimelineClass',
  'minecraft:trial_spawner': 'TrialSpawnerClass',
  'minecraft:trim_material': 'TrimMaterialClass',
  'minecraft:trim_pattern': 'TrimPatternClass',
  'minecraft:villager_trade': 'VillagerTradeClass',

  // Resourcepack resources
  'minecraft:atlas': 'AtlasClass',
  'minecraft:block_definition': 'BlockStateClass',
  'minecraft:equipment': 'EquipmentClass',
  'minecraft:font': 'FontClass',
  'minecraft:item_definition': 'ItemModelDefinitionClass',
  'minecraft:lang': 'LanguageClass',
  'minecraft:model': 'ModelClass',
  'minecraft:post_effect': 'PostEffectClass',
  'minecraft:texture': 'TextureClass',

} as const

/**
 * Maps variant resource type IDs to their VariantType string.
 * These use VariantClass<T> where T is the variant type literal.
 */
export const VARIANT_RESOURCES = {
  'minecraft:cat_variant': 'cat',
  'minecraft:chicken_variant': 'chicken',
  'minecraft:cow_variant': 'cow',
  'minecraft:frog_variant': 'frog',
  'minecraft:painting_variant': 'painting',
  'minecraft:pig_variant': 'pig',
  'minecraft:wolf_variant': 'wolf',
  'minecraft:wolf_sound_variant': 'wolf_sound',
  'minecraft:zombie_nautilus_variant': 'zombie_nautilus',
} as const

export type VariantResourceType = keyof typeof VARIANT_RESOURCES
export type VariantType = typeof VARIANT_RESOURCES[VariantResourceType]

export type ResourceClassName = typeof RESOURCE_CLASSES[keyof typeof RESOURCE_CLASSES]

/**
 * Generates resource path mappings from Spyglass binder.
 *
 * Produces:
 * - RESOURCE_PATHS: Map from resource category to path info
 * - RESOURCE_CLASS_TYPES: Object mapping class names to resource type IDs (reversed)
 * - CLASS_TO_RESOURCE_TYPE: Runtime Map with class imports
 */
export function export_resources(release: ReleaseVersion): ResolvedSymbol {
  // Collect resources that are valid for the current release (excluding tag/* entries)
  const resources: Array<{
    category: string
    path: string[]
    pack: 'data' | 'assets'
    ext: string
  }> = []

  for (const resource of je.binder.getResources()) {
    // Filter by version: include if since is undefined OR release >= since
    if (resource.since !== undefined && ReleaseVersion.cmp(release, resource.since) < 0) {
      continue
    }
    // Filter by version: include if until is undefined OR release < until
    if (resource.until !== undefined && ReleaseVersion.cmp(release, resource.until) >= 0) {
      continue
    }
    // Skip individual tag/* entries - we add a single minecraft:tag entry instead
    if (resource.category.startsWith('tag/')) {
      continue
    }

    resources.push({
      category: resource.category,
      path: resource.path.split('/'),
      pack: resource.pack,
      ext: resource.ext,
    })
  }

  // --- Generate RESOURCE_PATHS Map (with minecraft: namespace) ---
  const resource_path_entries = resources.map((r) =>
    factory.createArrayLiteralExpression([
      factory.createStringLiteral(`minecraft:${r.category}`, true),
      factory.createObjectLiteralExpression([
        factory.createPropertyAssignment('path', factory.createArrayLiteralExpression(
          r.path.map((p) => factory.createStringLiteral(p, true)),
        )),
        factory.createPropertyAssignment('pack', factory.createStringLiteral(r.pack, true)),
        factory.createPropertyAssignment('ext', factory.createStringLiteral(r.ext, true)),
      ], false),
    ]),
  )

  // Add special minecraft:tag entry with path: ['tags', true]
  resource_path_entries.push(factory.createArrayLiteralExpression([
    factory.createStringLiteral('minecraft:tag', true),
    factory.createObjectLiteralExpression([
      factory.createPropertyAssignment('path', factory.createArrayLiteralExpression([
        factory.createStringLiteral('tags', true),
        factory.createTrue(),
      ])),
      factory.createPropertyAssignment('pack', factory.createStringLiteral('data', true)),
      factory.createPropertyAssignment('ext', factory.createStringLiteral('.json', true)),
    ], false),
  ]))

  const resource_paths_var = factory.createVariableStatement(
    [factory.createToken(ts.SyntaxKind.ExportKeyword)],
    factory.createVariableDeclarationList(
      [factory.createVariableDeclaration(
        'RESOURCE_PATHS',
        undefined,
        undefined,
        factory.createNewExpression(
          factory.createIdentifier('Map'),
          undefined,
          [factory.createAsExpression(
            factory.createArrayLiteralExpression(resource_path_entries, true),
            factory.createTypeReferenceNode('const'),
          )],
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
    factory.createStringLiteral('minecraft:tag', true),
  ]))

  const class_to_resource_type_var = factory.createVariableStatement(
    [factory.createToken(ts.SyntaxKind.ExportKeyword)],
    factory.createVariableDeclarationList(
      [factory.createVariableDeclaration(
        'CLASS_TO_RESOURCE_TYPE',
        undefined,
        undefined,
        factory.createNewExpression(
          factory.createIdentifier('Map'),
          undefined,
          [factory.createAsExpression(
            factory.createArrayLiteralExpression(class_entries, true),
            factory.createTypeReferenceNode('const'),
          )]
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

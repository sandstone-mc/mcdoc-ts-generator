# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a TypeScript code generator that converts Minecraft mcdoc type definitions into TypeScript types. It uses the Spyglass MC libraries to parse mcdoc schemas from the vanilla-mcdoc API and generates strongly-typed TypeScript definitions for Minecraft datapacks and resourcepacks.

## Build/Run Commands

```bash
# Install dependencies
bun install

# Run the generator (outputs to types/ directory for inspection)
bun compile
# or directly:
bun run ./src/index.ts

# Type check
bun typecheck

# Build the package (for linking to sandstone)
bun dev:build
```

## Updating Sandstone Types

The generator has two output modes:

1. **`bun compile`** - Outputs to local `types/` directory for inspection/testing
2. **In sandstone project: `bun update-from-mcdoc`** - Outputs directly to `sandstone/src/arguments/generated/`

When making changes to type generation:
1. Make changes in this project
2. (Optional) Run `bun compile` to verify changes in local `types/` directory first
3. Run `bun dev:build` to build the generator package
4. In the sandstone project, run `bun update-from-mcdoc` to regenerate types
5. In the sandstone project, run `bun dev:build` to rebuild sandstone

**Tip:** Use `bun compile` to quickly inspect generated output before committing to rebuild sandstone.

If packages are linked via the workspace `bun dev:link`, the sandstone project will use the local version of mcdoc-ts-generator.

## Architecture

### Entry Point
`src/index.ts` - Orchestrates the generation process:
1. Fetches vanilla-mcdoc symbols from Spyglass API
2. Fetches Minecraft registries and block states for the latest version
3. Initializes a Spyglass Service with mcdoc parsers
4. Uses `TypesGenerator` to resolve and convert mcdoc types to TypeScript AST nodes
5. Formats output with ESLint and writes to `types/` directory

### Type Generation (`src/typegen/`)
- `index.ts` - `TypesGenerator` class: Main orchestrator for type resolution. Handles references, dispatchers, and module organization.
- `compile.ts` - Compiles TypeScript AST nodes to formatted source code using ESLint
- `import.ts` - `handle_imports()`: Converts import paths to TypeScript import declarations
- `export.ts` - Generates registry and dispatcher export types
- `resources.ts` - Generates `RESOURCE_CLASS_TYPES` (class constructors + resource-type map) for `resources.ts` and `RESOURCE_PATHS` for `resource-paths.ts`. Both files filter their entries by target Minecraft version via `is_resource_supported`.
- `mcdoc/version.ts` - Exports `TARGET_VERSION` (from `MCDOC_TARGET_VERSION` env var, default `'26.2'`) and re-exports `ReleaseVersion` from `@spyglassmc/java-edition`. All `since`/`until` comparisons in the generator route through `ReleaseVersion.cmp` against this constant.

#### Mcdoc Handlers (`src/typegen/mcdoc/`)
- `index.ts` - `TypeHandlers`: Registry mapping mcdoc type kinds to handler functions
- `utils.ts` - `add_import()`, `merge_imports()`, `NonEmptyList` type, custom `Set` class
- `bind.ts` - Helpers for creating TypeScript AST nodes (docs, literals, type references)
- `assert.ts` - Type assertion utilities for mcdoc types
- `dispatcher_symbol.ts` - Generates dispatcher symbol types; filters members by `since`/`until` against `TARGET_VERSION`
- `version.ts` - `TARGET_VERSION` constant + `ReleaseVersion` re-export

Handler subdirectories:
- `primitives/` - boolean, string, int, byte, float, double, long, short, literal, reference, any, concrete
- `multi/` - struct, union, tuple, enum — each filters fields/items by `since`/`until` against `TARGET_VERSION`
- `list/` - list, and `array/` subfolder for byte_array, int_array, long_array
- `complex/` - dispatcher, template, indexed

### Utilities (`src/util/`)
- `index.ts` - String utilities (pascal_case, camel_case, pluralize), path joining, `add()` helper
- `fetch.ts` - HTTP fetch with caching
- `config.ts` - Configuration handling

### Key Dependencies
- `@spyglassmc/core`, `@spyglassmc/java-edition`, `@spyglassmc/mcdoc` - Mcdoc parsing and Minecraft data
- `typescript` - AST generation for output types
- `eslint`, `@stylistic/eslint-plugin` - Code formatting
- `ts-pattern` - Pattern matching (used in type handlers)

### Import Path Convention
Import strings use `::` as separator and are converted to file paths:
- `sandstone::TypeName` → imports from `sandstone`
- `sandstone::arguments::TypeName` → imports from `sandstone/arguments`
- `java::*` → imports from `sandstone/arguments/generated/*`

Note: Mcdoc module paths have a leading `::` (e.g., `::java::data::advancement`). The first empty segment and `java` namespace are stripped when generating output paths.

The `add_import()` function handles deduplication internally.

### Output Structure
Generated files go to `types/`:
```
types/
├── registry.ts          # Central Registry type (all registry unions)
├── dispatcher.ts        # Central Dispatcher type
├── pack.ts, util.ts     # Pack metadata and utilities
├── _builtin/            # Built-in types (block_states, fluid_states, etc.)
├── _dispatcher/         # Dispatcher symbol maps
├── _registry/           # Individual registry types
│   ├── tag/             # Tag registries
│   └── worldgen/        # Worldgen registries
├── assets/              # Resourcepack types (atlas, font, model, sounds, etc.)
├── data/                # Datapack types (advancement, enchantment, loot, recipe, etc.)
│   ├── worldgen/        # World generation types
│   └── variants/        # Mob variant types
├── util/                # Utility types (text, color, particle, etc.)
└── world/               # World types
    ├── block/           # Block entity types
    ├── component/       # Data component types
    ├── entity/          # Entity types with mob/ and projectile/ subfolders
    └── item/            # Item types
```

### Type Handler Pattern
Each mcdoc type kind has a handler in `src/typegen/mcdoc/` that:
1. Takes an mcdoc type definition
2. Returns a function that produces `TypeHandlerResult` with:
   - `type`: TypeScript AST node
   - `imports`: Required import statements (uses `add_import()` for deduplication)
   - `docs`: JSDoc comments
   - `child_dispatcher`: Optional dispatcher inheritance info
   - `unresolved`: `true` if a child reference could not be resolved (see Unresolved References below)

### Unresolved References
Some mcdoc types declare `struct`s that reference generic placeholders (e.g. `T`) without wrapping them in `template`. Without a generic parameter declaration these references don't bind to anything and produce broken TypeScript output (e.g. `type ExplicitInclusiveRange = { min_inclusive: T }`).

The `reference` primitive handler (`src/typegen/mcdoc/primitives/reference.ts`) flags these by setting `unresolved: true` on its result when:
- `import_path` is not in `args.module_map` (the path doesn't resolve to any registered mcdoc symbol), AND
- `import_path` is not in `args.generics` (not a declared template parameter)

The flag propagates upward: each compound handler (`struct`, `union`, `tuple`, `template`) checks every child result and sets `unresolved: true` on its own output if any child was unresolved. `TypesGenerator.resolve_module_symbols` skips top-level symbols whose final result is `unresolved: true` and logs a warning — the alias never reaches the output.

`::java::registry::Registry` and similar synthetic paths are NOT in the vanilla-mcdoc symbol table and are added directly to imports by `resolve_registry_symbols` without going through the reference handler, so they don't trip this check.

### Target Version Filtering

The generator targets a single Minecraft version, declared in `src/typegen/mcdoc/version.ts`:

```ts
export const TARGET_VERSION: ReleaseVersion = (process.env['MCDOC_TARGET_VERSION'] ?? '26.2') as ReleaseVersion
```

Default is `'26.2'` (sandstone 1.1.x). Override at runtime:

```bash
MCDOC_TARGET_VERSION=26.3 bun update-from-mcdoc
```

`vanilla-mcdoc` may include entries for versions newer than the target. Three places filter them out using `ReleaseVersion.cmp` against `TARGET_VERSION`:

| Location | Drops |
|----------|-------|
| `mcdoc/multi/{struct,union,tuple}.ts` field/item loop | `since > TARGET` (added after target) or `until < TARGET` (removed before target) |
| `mcdoc/dispatcher_symbol.ts` member loop | same |
| `resources.ts` `is_resource_supported` | Spyglass binder resources with `since > TARGET` or `until < TARGET`. Used by both `RESOURCE_PATHS` (`resource-paths.ts`) and `RESOURCE_CLASS_TYPES` (`resources.ts`). |

A mcdoc type alias dropped by these filters never reaches the generated output — it would either be missing or produce an import for a class that doesn't exist on the target version (e.g. `DecoratedPotPatternClass`, `SlotSourceClass` are mc 26.3-only and not exported by sandstone 1.1.x).

### Indexed-Access on Dispatcher Key Unions

When `mcdoc/multi/struct.ts` builds the dispatcher indexed-access pattern (`{ [S in K]?: ... }[K]`), the key `K` is often a union containing non-string members like `TagClass<'entity_type'>` (a class constructor). Using the full union in both the mapped type and the indexed-access index produces TS2538 at consumers.

The handler wraps `K` with `Extract<K, string>` in both positions — constraining the mapped key set to string-keyed branches and using the same narrowed set for the indexed-access index. This matches the existing pattern at generated `predicate.ts:396` (`[S in Extract<EntityTypePredicate, string>]?:`).

## Code Style

### Control Flow
Always use braces for if statements, even for single-line bodies:
```ts
// Preferred
if (condition) {
    do_something()
}

// Avoid
if (condition) do_something()
```

### TypeScript AST Generation
When creating TypeScript AST nodes, use plain strings instead of `factory.createIdentifier()`:
```ts
// Preferred
factory.createTypeReferenceNode('Record', [...])
factory.createTypeParameterDeclaration(undefined, 'T', ...)

// Avoid
factory.createTypeReferenceNode(factory.createIdentifier('Record'), [...])
factory.createTypeParameterDeclaration(undefined, factory.createIdentifier('T'), ...)
```

### Naming Conventions
- `PascalCase`: Classes, types, static class members, effectively-static variables, type handler exports
- `snake_case`: Functions, methods, most variables
- Exception: Utility classes like `Assert` and `Bind`, and functions similar in nature to their methods, use PascalCase

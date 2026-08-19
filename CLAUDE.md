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
2. Fetches Minecraft registries and block states for `TARGET_VERSION` (falling back to the latest release if that version isn't in the Spyglass version list)
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
- `utils.ts` - `add_import()`, `make_imports()`, `merge_imports()`, `NonEmptyList` type, custom `Set` class
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
- `index.ts` - String utilities (pascal_case, camel_case, pluralize, compare_names), path joining, `add()` helper
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
| `mcdoc/multi/{struct,union,tuple}.ts` field/item loop | `since > TARGET` (added after target) or `until <= TARGET` (removed by target, inclusive) |
| `mcdoc/dispatcher_symbol.ts` member loop | same |
| `resources.ts` `is_resource_supported` | Spyglass binder resources with `since > TARGET` or `until <= TARGET`. Used by both `RESOURCE_PATHS` (`resource-paths.ts`) and `RESOURCE_CLASS_TYPES` (`resources.ts`). |

`TARGET_VERSION` additionally selects which Minecraft version `initialize` (`src/index.ts`) loads registries, block states and the mcmeta summary for — it looks for the matching entry in the Spyglass version list and only falls back to the latest release (with a warning) when the target isn't found. Without this, a pinned build would filter mcdoc correctly but still emit the *latest* release's registry unions.

A mcdoc type alias dropped by these filters never reaches the generated output — it would either be missing or produce an import for a class that doesn't exist on the target version (e.g. `DecoratedPotPatternClass`, `SlotSourceClass` are mc 26.3-only and not exported by sandstone 1.1.x).

### Type Name Prefixing

Every identifier the generator declares — type aliases, dispatcher `Symbol*` types, and value consts (`BLOCKS_SET`, `REGISTRIES_SET`, `RESOURCE_PATHS`, `RESOURCE_CLASS_TYPES`) — can be prefixed via `MCDOC_TYPE_PREFIX` (`src/typegen/prefix.ts`):

```bash
MCDOC_TYPE_PREFIX=Mc bun compile   # McRegistry, McSymbolDataComponent, MCBLOCKS
```

Defaults to `''`, which leaves every name untouched. Use it when the generated types are consumed alongside declarations that would otherwise collide. Sandstone exports (`NonEmptyString`, `TagClass`, …) and TypeScript builtins are never prefixed.

The prefix is joined verbatim, so separators are the caller's business (`Mc_` → `Mc_Registry`). The one exception is casing: a SCREAMING_CASE name gets an upper-cased prefix so it stays screaming (`BLOCKS` → `MCBLOCKS`).

**The invariant that makes this tractable:** every `::java::…` path string stays *canonical* (unprefixed) — they're lookup keys, and mcdoc hands them to us that way. `add_import()` (`mcdoc/utils.ts`) is the single place a path's type name gains the prefix; `merge_imports()` uses the private `add_import_raw()` so already-prefixed paths aren't prefixed twice. Emitted identifiers gain it at their creation site via `prefix_name()`. The prefix always lands at the *front of the complete identifier* (`McSymbolFoo`, never `SymbolMcFoo`) so the two rules can't disagree.

Consequences when editing the generator:

- New `::java::…` import? Pass the canonical path to `add_import`, or use `make_imports()` — never hand-write the `{ ordered, check }` object. (`sandstone::…` paths pass through untouched.)
- New reference to a generated type? Wrap the name in `prefix_name()`.
- New string compared against a *stored* import path? Run it through `prefix_import_path()` — see the dispatcher self-import filters in `typegen/index.ts` and `dispatcher_symbol.ts`.

Enabling the prefix reorders import *lines* in some files: `add_import` sorts by the full path, and a prefixed type name can sort either side of a submodule's types. The import sets are unchanged.

### Deterministic Output

Generated output is a pure function of its input. Spyglass's `getVisibleSymbols()` iteration order is **not** stable between runs, so anything derived from it is sorted before emission with `compare_names()` (`src/util/index.ts`) — a locale-independent comparator, since `localeCompare` varies with the host's ICU collation:

| Sorted | Why |
|--------|-----|
| `Object.keys(dispatchers)` in `precompute_dispatcher_info` / `resolve_dispatcher_symbols` | decides `dispatcher.ts` export order and where in-module dispatcher types land |
| `Object.keys(members)` in `dispatcher_symbol.ts` | dispatcher map key order, and which member the generics check inspects |
| registry contents in `resolve_registry_symbols` | emitted verbatim as `BLOCKS_SET` etc. |
| `dispatcher_symbol_paths` in `export_dispatchers` | `dispatcher.ts` re-export order |

**`getVisibleSymbols('mcdoc')` is deliberately NOT sorted** — declaration order within each generated file follows mcdoc's own order, which is stable (it comes from `symbols.json` key order).

Import order is kept canonical by `add_import` inserting in sorted position. That only holds if `ordered` is genuinely sorted and `check` lists every path, so build import sets with `make_imports()` rather than object literals — a literal that gets either wrong silently corrupts the ordering of everything merged in afterwards.

### Skipping Formatting

`MCDOC_SKIP_FORMAT=1` skips the ESLint pass in `typegen/compile.ts` and emits the TypeScript printer's raw output. The wrap plugin reflows on line length, so a rename-only change produces sprawling formatting-only diffs; unformatted output is stable under renames, which makes it the right mode for diffing two generations against each other. Not for producing real output.

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

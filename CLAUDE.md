# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a TypeScript code generator that converts Minecraft mcdoc type definitions into TypeScript types. It uses the Spyglass MC libraries to parse mcdoc schemas from the vanilla-mcdoc API and generates strongly-typed TypeScript definitions for Minecraft datapacks and resourcepacks.

## Build/Run Commands

```bash
# Install dependencies
bun install

# Run the generator (outputs to types/ directory)
bun run compile
# or directly:
bun run ./src/index.ts

# Type check
bun tsc --noEmit
```

## Architecture

### Entry Point
`src/index.ts` - Orchestrates the generation process:
1. Fetches vanilla-mcdoc symbols from Spyglass API
2. Fetches Minecraft registries and block states for the latest version
3. Initializes a Spyglass Service with mcdoc parsers
4. Uses `TypesGenerator` to resolve and convert mcdoc types to TypeScript AST nodes
5. Formats output with Biome and writes to `types/` directory

### Type Generation (`src/typegen/`)
- `index.ts` - `TypesGenerator` class: Main orchestrator for type resolution. Handles references, dispatchers, and module organization.
- `compile.ts` - Compiles TypeScript AST nodes to formatted source code using Biome
- `import.ts` - `handle_imports()`: Converts import paths to TypeScript import declarations
- `export.ts` - Generates registry and dispatcher export types

#### Mcdoc Handlers (`src/typegen/mcdoc/`)
- `index.ts` - `TypeHandlers`: Registry mapping mcdoc type kinds to handler functions
- `utils.ts` - `add_import()`, `merge_imports()`, `NonEmptyList` type, custom `Set` class
- `bind.ts` - Helpers for creating TypeScript AST nodes (docs, literals, type references)
- `assert.ts` - Type assertion utilities for mcdoc types
- `dispatcher_symbol.ts` - Generates dispatcher symbol types

Handler subdirectories:
- `primitives/` - boolean, string, int, byte, float, double, long, short, literal, reference, any, concrete
- `multi/` - struct, union, tuple, enum
- `list/` - list, and `array/` subfolder for byte_array, int_array, long_array
- `complex/` - dispatcher, template, indexed

### Utilities (`src/util/`)
- `index.ts` - String utilities (pascal_case, camel_case, pluralize), path joining, `add()` helper
- `fetch.ts` - HTTP fetch with caching
- `config.ts` - Configuration handling

### Key Dependencies
- `@spyglassmc/core`, `@spyglassmc/java-edition`, `@spyglassmc/mcdoc` - Mcdoc parsing and Minecraft data
- `typescript` - AST generation for output types
- `@biomejs/biome` - Code formatting
- `ts-pattern` - Pattern matching (used in type handlers)

### Import Path Convention
Import strings use `::` as separator and are converted to file paths:
- `sandstone::TypeName` → imports from `sandstone`
- `sandstone::arguments::TypeName` → imports from `sandstone/arguments`
- `java::*` → imports from `sandstone/generated/*`

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

## Remaining Issues

Generated types have **95 errors** when type-checked with `bun tsc --noEmit -p types/tsconfig.json`.

### Error Summary

| Code | Count | Description |
|------|-------|-------------|
| TS2339 | 64 | Property does not exist on `Registry` |
| TS2559 | 10 | Type has no properties in common |
| TS2440 | 7 | Import conflicts with local declaration |
| TS2307 | 7 | Cannot find module |
| TS2538 | 4 | Cannot be used as an index type |
| TS2395 | 2 | Merged declaration export mismatch |
| TS6059 | 1 | rootDir configuration issue |

### Root Causes

**1. TS2339 - Missing registry entries**

The `Registry` type is missing keys that are referenced in generated code. Run type check and grep for specific missing keys to identify gaps.

Dev Note: these, like `minecraft:function`, should not attempt to use `Registry`. There's TODOs in the string type handler for this. 

**2. TS2440 - Import/local declaration conflicts**

Files import a type then re-declare it locally with the same name:
- `types/util.ts`: `BlockState`, `DyeColor`, `DyeColorByte`, `DyeColorInt`, `EffectId`
- `types/data/enchantment.ts`: `LevelBasedValue`

Dev Note: these are import-to-export type aliases from upstream, they break enum doc propagation and are annoying.
this should be fixed in two parts:
- if a reference peek returns another reference, peek that reference and update the import
- skip root type references when resolving the module map

**3. TS2538 (4 remaining) - Invalid index types in mapped type pattern**

Affects `BlockPredicate` and `EntityTypePredicate` in `types/data/advancement/predicate.ts`.

The generator creates mapped types with `Extract<Union, string>` for keys but uses the unfiltered union for the indexed access:
```ts
type BlockPredicate = ({
    [S in Extract<(Registry['minecraft:block'] | TagClass<'block'> | Array<...>), string>]?: { ... };
}[(Registry['minecraft:block'] | TagClass<'block'> | Array<...>)])  // ← TagClass and Array are not valid index types
```

Dev Note: the `Extract` here is actually a bug because we need the value where `S` is defined to support the class/array types.
we need to make `S` actually be a type generic initialized to `undefined`, and leave the value where `S` would have been defined alone.
to do this, the string type handler has to somehow pass the info that "hey, this contains stuff that isn't a literal nor literal union, don't touch this".
probably want to do another hacky `Object.assign` thing for this.
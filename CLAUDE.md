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
    doSomething()
}

// Avoid
if (condition) doSomething()
```

### TypeScript AST Generation
When creating TypeScript AST nodes, use plain strings instead of `factory.createIdentifier()`:
```ts
// Preferred
factory.createTypeReferenceNode('Record', [...])
factory.createTypeParameterDeclaration(undefined, 'K', ...)

// Avoid
factory.createTypeReferenceNode(factory.createIdentifier('Record'), [...])
factory.createTypeParameterDeclaration(undefined, factory.createIdentifier('K'), ...)
```

### Naming Conventions
- `PascalCase`: Classes, types, static class members, effectively-static variables, type handler exports
- `snake_case`: Functions, methods, most variables
- Exception: Utility classes like `Assert` and `Bind`, and functions similar in nature to their methods, use PascalCase
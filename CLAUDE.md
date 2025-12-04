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
4. Iterates through all resource types (datapacks/resourcepacks) and dispatchers
5. Uses TypesGenerator to convert mcdoc types to TypeScript AST nodes
6. Formats output with Biome and writes to `types/` directory

### Type Generation (`src/typegen/`)
- `index.ts` - `TypesGenerator` class: Main orchestrator for type resolution. Handles references, dispatchers, and module organization.
- `mcdoc/index.ts` - Type handler registry mapping mcdoc type kinds (struct, union, enum, list, etc.) to handler functions
- `mcdoc/primitives/` - Handlers for primitive types (boolean, string, int, byte, float, double, long, short, literal, reference)
- `mcdoc/multi/` - Handlers for compound types (struct, union, tuple, enum)
- `mcdoc/list/` - Handlers for list and array types (list, byte_array, int_array, long_array)
- `mcdoc/complex/` - Handlers for complex types (dispatcher, template, indexed)
- `collapseImports.ts` - Deduplicates and organizes imports across generated modules
- `binders.ts` - Helpers for creating TypeScript AST nodes (imports, docs, literals)

### Utilities (`src/util/`)
- `index.ts` - String utilities (pascal_case, camel_case, pluralize), path joining, and shared types
- `fetch.ts` - HTTP fetch with caching
- `config.ts` - Configuration handling

### Key Dependencies
- `@spyglassmc/core`, `@spyglassmc/java-edition`, `@spyglassmc/mcdoc` - Mcdoc parsing and Minecraft data
- `typescript` - AST generation for output types
- `@biomejs/biome` - Code formatting
- `ts-pattern` - Pattern matching (used in type handlers)

### Output Structure
Generated files go to `types/`:
- `types/registries/` - Registry type unions (e.g., all block IDs)
- `types/resources/datapack/` - Datapack resource types
- `types/resources/resourcepack/` - Resourcepack resource types
- `types/resources/dispatchers/` - Dispatcher type maps

### Type Handler Pattern
Each mcdoc type kind has a handler in `src/typegen/mcdoc/` that:
1. Takes an mcdoc type definition
2. Returns a function that produces `TypeHandlerResult` with:
   - `type`: TypeScript AST node
   - `imports`: Required import statements
   - `docs`: JSDoc comments

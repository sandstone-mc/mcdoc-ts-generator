import ts from 'typescript'
import type { NonEmptyList } from './mcdoc/utils'

const { factory } = ts

/**
 * Module specifier root that generated `::java::…` imports resolve against.
 *
 * Override with `MCDOC_IMPORT_ROOT` when generating a second set of types that
 * lives beside the first, so its cross-module imports point at its own
 * directory rather than the default one:
 *
 *   MCDOC_IMPORT_ROOT=sandstone/arguments/generated/_json bun update-from-mcdoc -o src/arguments/generated/_json
 *
 * This is separate from the output directory (`-o`), which only decides where
 * files are written. Getting them out of sync emits imports that resolve to a
 * sibling generation - and since that sibling exports different names (see
 * `MCDOC_TYPE_PREFIX`), every cross-module reference breaks.
 */
export const IMPORT_ROOT = (process.env['MCDOC_IMPORT_ROOT'] ?? 'sandstone/arguments/generated').replace(/\/+$/, '')

function BindImports(module_path: string, modules: string[], is_type_only = true) {
  return factory.createImportDeclaration(
    undefined,
    factory.createImportClause(
      is_type_only,
      undefined,
      factory.createNamedImports(
        modules.map((name) => factory.createImportSpecifier(false, undefined, factory.createIdentifier(name))),
      ),
    ),
    factory.createStringLiteral(module_path, true),
  )
}

export function handle_imports(imports?: { readonly ordered: NonEmptyList<string>, readonly check: Map<string, number> }) {
  if (!imports) return []

  const grouped = new Map<string, string[]>()

  for (const import_path of imports.ordered) {
    const parts = import_path.split('::')
    const type_name = parts.at(-1)!
    const path = parts.slice(0, -1)

    let file: string
    if (path.length === 0) {
      throw new Error(`[mcdoc_import] Import path has no module prefix: "${import_path}"`)
    } else if (path[1] === 'java') {
      // java::* → <IMPORT_ROOT>/*
      file = `${IMPORT_ROOT}/${path.slice(2).join('/')}.ts`
    } else if (path[0] === 'sandstone') {
      // sandstone::* → sandstone/*
      if (path.length === 1) {
        file = 'sandstone'
      } else if (path[1] === 'arguments' && path.length === 2) {
        file = 'sandstone/arguments'
      } else if (path[1] === 'variables' && path.length === 2) {
        file = 'sandstone/variables'
      } else {
        file = `${path.join('/')}.ts`
      }
    } else {
      throw new Error(`[mcdoc_import] Unsupported import location "${path[0]}" in "${import_path}"`)
    }

    const existing = grouped.get(file)
    if (existing) {
      existing.push(type_name)
    } else {
      grouped.set(file, [type_name])
    }
  }

  // Create import declarations
  const declarations: ts.ImportDeclaration[] = []
  for (const [file, names] of grouped) {
    // Handle non-type import of `Set` from `sandstone`
    if (file === 'sandstone') {
      const set_index = names.indexOf('Set')
      if (set_index !== -1) {
        names.splice(set_index, 1)
        declarations.push(BindImports(file, ['Set'], false))
      }
      if (names.length === 0) {
        continue
      }
    }
    declarations.push(BindImports(file, names))
  }

  return declarations
}

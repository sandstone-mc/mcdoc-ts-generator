import ts from 'typescript'
import type { NonEmptyList } from './mcdoc/utils'

const { factory } = ts

function BindImports(module_path: string, modules: string[], is_type_only = true) {
    return factory.createImportDeclaration(
        undefined,
        factory.createImportClause(
            is_type_only,
            undefined,
            factory.createNamedImports(
                modules.map((name) => factory.createImportSpecifier(false, undefined, factory.createIdentifier(name)))
            )
        ),
        factory.createStringLiteral(module_path, true)
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
            // java::* → sandstone/arguments/generated/*
            file = `sandstone/arguments/generated/${path.slice(2).join('/')}.js`
        } else if (path[0] === 'sandstone') {
            // sandstone::* → sandstone/*
            file = `${path.join('/')}.js`
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
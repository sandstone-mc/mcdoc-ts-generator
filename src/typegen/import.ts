import ts from 'typescript'
import type { NonEmptyList } from './mcdoc/utils'

const { factory } = ts

function BindImports(module_path: string, modules: string[]) {
    return factory.createImportDeclaration(
        undefined,
        factory.createImportClause(
            true,
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
        if (parts[0] === '') parts.shift()
        const type_name = parts.at(-1)!
        const path = parts.slice(0, -1)

        let file: string
        if (path.length === 0) {
            throw new Error(`[mcdoc_import] Import path has no module prefix: "${import_path}"`)
        } else if (path[0] === 'java') {
            // java::* → sandstone/generated/*
            file = `sandstone/generated/${path.slice(1).join('/')}`
        } else if (path[0] === 'sandstone') {
            // sandstone::* → sandstone/*
            file = path.join('/')
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
        declarations.push(BindImports(file, names))
    }

    return declarations
}
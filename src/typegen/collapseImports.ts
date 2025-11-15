import ts from 'typescript'

const { factory } = ts

export function collapseImports(types: (ts.EnumDeclaration | ts.ImportDeclaration | ts.TypeAliasDeclaration)[]) {
    const importPaths: string[] = []
    const importMap: Record<string, number | undefined> = {} // Map to track module paths and their indices in collapsedImports
    const collapsedImports: ts.ImportDeclaration[] = []
    const nonImportTypes: (ts.EnumDeclaration | ts.TypeAliasDeclaration)[] = []

    let found_an_import = false

    // First loop: Process types and assemble collapsedImports in sorted order
    for (const type of types) {
        if (ts.isImportDeclaration(type) && type.importClause?.namedBindings !== undefined && ts.isNamedImports(type.importClause.namedBindings)) {
            found_an_import = true
            const modulePath = (type.moduleSpecifier as ts.StringLiteral).text
            const specifier = type.importClause.namedBindings.elements[0] // Only one specifier per ImportDeclaration

            let importIndex = importMap[modulePath]
            if (importIndex === undefined) {
                // Use binary search to find the correct insertion point for the new module path
                let left = 0
                let right = collapsedImports.length
                while (left < right) {
                    const mid = Math.floor((left + right) / 2)
                    const midPath = (collapsedImports[mid].moduleSpecifier as ts.StringLiteral).text
                    if (modulePath.localeCompare(midPath) < 0) {
                        right = mid
                    } else {
                        left = mid + 1
                    }
                }

                // Create a new ImportDeclaration and insert it at the correct position
                const newImport = factory.createImportDeclaration(
                    undefined,
                    factory.createImportClause(false, undefined, factory.createNamedImports([])),
                    factory.createStringLiteral(modulePath, true)
                );
                collapsedImports.splice(left, 0, newImport)
                importPaths.splice(left, 0, modulePath)
                importMap[modulePath] = left
                importIndex = left

                // Update indices in the map for all subsequent imports using importPaths as a reference
                for (let i = left + 1; i < importPaths.length; i++) {
                    importMap[importPaths[i]] = i
                }
            }

            // Add the specifier to the correct ImportDeclaration
            const importClause = collapsedImports[importIndex].importClause!
            const namedImports = importClause.namedBindings! as ts.NamedImports // Imagine using namespaces
            const existingSpecifiers = namedImports.elements as (ts.NodeArray<ts.ImportSpecifier> & { splice: typeof Array['prototype']['splice'] })

            // Use binary search to insert the specifier in sorted order
            let left = 0
            let right = existingSpecifiers.length
            let exists = false
            while (left < right) {
                const mid = Math.floor((left + right) / 2)
                const comparison = specifier.name.text.localeCompare(existingSpecifiers[mid].name.text)
                if (comparison === 0) {
                    exists = true // Specifier already exists, no need to insert
                    break
                } else if (comparison < 0) {
                    right = mid
                } else {
                    left = mid + 1
                }
            }

            if (!exists) {
                existingSpecifiers.splice(left, 0, specifier)
            }

            // if (existingSpecifiers.length > 4) {
            //     importClause.
            // }
        } else {
            nonImportTypes.push(type as ts.EnumDeclaration | ts.TypeAliasDeclaration)
        }
    }

    // Combine collapsed imports with non-import types
    return [...collapsedImports, ...nonImportTypes];
}
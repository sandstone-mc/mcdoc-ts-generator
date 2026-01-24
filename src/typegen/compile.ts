import ts from 'typescript'

export function compile_types(nodes: ts.Node[], file = 'code.ts') {
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed, omitTrailingSemicolon: true })

  return printer.printList(
    ts.ListFormat.MultiLine,
    ts.factory.createNodeArray(nodes),
    ts.createSourceFile(
      file,
      '',
      ts.ScriptTarget.Latest,
      false,
      ts.ScriptKind.TS,
    ),
  )
}

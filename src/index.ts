import {
  LanguageSupport,
  LRLanguage,
  delimitedIndent,
  foldInside,
  foldNodeProp,
  indentNodeProp,
} from "@codemirror/language"
import {styleTags, tags as t} from "@lezer/highlight"
// The Rollup Lezer plugin turns this grammar into an LRParser module.
// @ts-expect-error TypeScript does not resolve generated grammar modules.
import {parser} from "./cedar.grammar"
import {cedarCompletion} from "./complete.js"
import {cedarHighlightStyle} from "./highlight.js"
import {cedarLinter} from "./linter.js"

const defaultCompletion = cedarCompletion()

/** The Cedar parser and editor metadata, without an opinionated color theme. */
export const cedarLanguage = LRLanguage.define({
  parser: parser.configure({
    props: [
      indentNodeProp.add({
        PolicyScope: delimitedIndent({closing: ")", align: false}),
        ConditionBlock: delimitedIndent({closing: "}", align: false}),
        ActionEntitySet: delimitedIndent({closing: "]", align: false}),
        SetExpression: delimitedIndent({closing: "]", align: false}),
        RecordExpression: delimitedIndent({closing: "}", align: false}),
        ParenthesizedExpression: delimitedIndent({closing: ")", align: false}),
        CallArguments: delimitedIndent({closing: ")", align: false}),
      }),
      foldNodeProp.add({
        PolicyScope: foldInside,
        ConditionBlock: foldInside,
        ActionEntitySet: foldInside,
        SetExpression: foldInside,
        RecordExpression: foldInside,
        ParenthesizedExpression: foldInside,
        CallArguments: foldInside,
      }),
      styleTags({
        "Permit Forbid When Unless If Then Else In Like Has Is": t.keyword,
        "True False": [t.bool, t.keyword],
        "Principal Action Resource Context PrincipalSlot ResourceSlot":
          t.special(t.variableName),
        "EntityType/Identifier EntityLiteral/Identifier EntityLiteralContinuation/Identifier":
          t.typeName,
        "ExtensionCall/Identifier ExtensionCallContinuation/Identifier":
          t.function(t.variableName),
        "MemberProperty/Identifier PropertyPath/PropertyName/Identifier RecordKey/Identifier":
          t.propertyName,
        Annotation: t.meta,
        AnnotationName: t.attributeName,
        "String PatternString": t.string,
        Integer: t.integer,
        LineComment: t.lineComment,
        "CompareOperator AddOperator MultiplyOperator UnaryOperator OrOperator AndOperator":
          t.operator,
        "( )": t.paren,
        "[ ]": t.squareBracket,
        "{ }": t.brace,
        ", ; : . ::": t.punctuation,
      }),
    ],
  }),
  languageData: {
    commentTokens: {line: "//"},
    closeBrackets: {brackets: ["(", "[", "{", '"']},
    autocomplete: defaultCompletion,
  },
})

/** Add Cedar language parsing and language data to a CodeMirror editor. */
export function cedar(): LanguageSupport {
  return new LanguageSupport(cedarLanguage)
}

export {cedarCompletion, cedarHighlightStyle, cedarLinter}
export type {CedarCompletionConfig} from "./complete.js"
export type {CedarDiagnosticLike, CedarLinterConfig} from "./linter.js"
export type {
  CedarDetailedError,
  CedarSchema,
  CedarSourceLocation,
  CedarWasmModule,
} from "./cedar-wasm.js"

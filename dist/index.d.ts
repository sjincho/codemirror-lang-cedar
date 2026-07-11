import { LanguageSupport, LRLanguage } from "@codemirror/language";
import { cedarCompletion } from "./complete.js";
import { cedarHighlightStyle } from "./highlight.js";
import { cedarLinter } from "./linter.js";
/** The Cedar parser and editor metadata, without an opinionated color theme. */
export declare const cedarLanguage: LRLanguage;
/** Add Cedar language parsing and language data to a CodeMirror editor. */
export declare function cedar(): LanguageSupport;
export { cedarCompletion, cedarHighlightStyle, cedarLinter };
export type { CedarCompletionConfig } from "./complete.js";
export type { CedarDiagnosticLike, CedarLinterConfig } from "./linter.js";
export type { CedarDetailedError, CedarSchema, CedarSourceLocation, CedarWasmModule, } from "./cedar-wasm.js";
//# sourceMappingURL=index.d.ts.map
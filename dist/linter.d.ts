import type { Diagnostic } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import type { CedarSchema, CedarWasmModule } from "./cedar-wasm.js";
/** A CodeMirror diagnostic returned by a custom Cedar validation backend. */
export interface CedarDiagnosticLike extends Diagnostic {
}
/** Configuration for Cedar parsing and schema validation. */
export interface CedarLinterConfig {
    cedar?: CedarWasmModule;
    schema?: CedarSchema;
    validate?: (source: string) => Promise<readonly CedarDiagnosticLike[]> | readonly CedarDiagnosticLike[];
    delay?: number;
}
/** Add debounced Cedar syntax and strict schema validation to an editor. */
export declare function cedarLinter(config?: CedarLinterConfig): Extension;
//# sourceMappingURL=linter.d.ts.map
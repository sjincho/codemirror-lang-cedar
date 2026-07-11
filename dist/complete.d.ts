import type { CompletionSource } from "@codemirror/autocomplete";
import { type CedarSchema, type CedarWasmModule } from "./cedar-wasm.js";
/** Configuration for Cedar policy completions. */
export interface CedarCompletionConfig {
    schema?: CedarSchema;
    cedar?: CedarWasmModule;
}
/**
 * Create a Cedar completion source. Schema conversion is lazy and cached for
 * this source. Missing or malformed schema data never prevents basic Cedar
 * keyword completion.
 */
export declare function cedarCompletion(config?: CedarCompletionConfig): CompletionSource;
//# sourceMappingURL=complete.d.ts.map
import type { CedarDetailedError, CedarPolicySetInput, CedarWasmModule } from "./cedar-wasm.js";
export interface CedarPolicyOrigin {
    kind: "static" | "template";
    from: number;
    to: number;
    text: string;
}
export type PreparedCedarPolicySet = {
    type: "failure";
    errors: CedarDetailedError[];
} | {
    type: "success";
    policySet: CedarPolicySetInput;
    origins: Map<string, CedarPolicyOrigin>;
};
/** Prepare exact policy source slices for Cedar parsing and validation. */
export declare function prepareCedarPolicySet(cedar: CedarWasmModule, source: string): Promise<PreparedCedarPolicySet>;
//# sourceMappingURL=policy-set.d.ts.map
type CedarAnnotations = Record<string, string>;
type CedarEntityReference = {
    __entity: {
        type: string;
        id: string;
    };
};
type CedarExtensionValue = {
    fn: string;
    arg: CedarJsonValue;
} | {
    fn: string;
    args: CedarJsonValue[];
};
type CedarJsonValue = CedarEntityReference | {
    __extn: CedarExtensionValue;
} | boolean | number | string | CedarJsonValue[] | {
    [key: string]: CedarJsonValue;
} | null;
type CedarSchemaTypeVariant = {
    type: "String";
} | {
    type: "Long";
} | {
    type: "Boolean";
} | {
    type: "Set";
    element: CedarSchemaType;
} | {
    type: "Record";
    attributes: Record<string, CedarSchemaAttribute>;
    additionalAttributes?: boolean;
} | {
    type: "Entity";
    name: string;
} | {
    type: "EntityOrCommon";
    name: string;
} | {
    type: "Extension";
    name: string;
};
type CedarSchemaType = CedarSchemaTypeVariant | {
    type: string;
};
type CedarSchemaAttribute = CedarSchemaType & {
    required?: boolean;
};
type CedarCommonType = CedarSchemaType & {
    annotations?: CedarAnnotations;
};
type CedarEntityType = ({
    memberOfTypes?: string[];
    shape?: CedarSchemaType;
    tags?: CedarSchemaType;
} | {
    enum: string[];
}) & {
    annotations?: CedarAnnotations;
};
type CedarActionType = {
    attributes?: Record<string, CedarJsonValue>;
    appliesTo?: {
        resourceTypes: string[];
        principalTypes: string[];
        context?: CedarSchemaType;
    };
    memberOf?: Array<{
        id: string;
        type?: string;
    }>;
    annotations?: CedarAnnotations;
};
type CedarSchemaNamespace = {
    commonTypes?: Record<string, CedarCommonType>;
    entityTypes: Record<string, CedarEntityType>;
    actions: Record<string, CedarActionType>;
    annotations?: CedarAnnotations;
};
type CedarSchemaJson = Record<string, CedarSchemaNamespace>;
type CedarSchemaToJsonAnswer = {
    type: "success";
    json: CedarSchemaJson;
    warnings: CedarDetailedError[];
} | {
    type: "failure";
    errors: CedarDetailedError[];
};
/** A schema in either Cedar's human-readable format or its JSON format. */
export type CedarSchema = string | CedarSchemaJson;
/** A source range reported by Cedar. */
export interface CedarSourceLocation {
    /** Inclusive UTF-8 byte offset in the Cedar source. */
    start: number;
    /** Exclusive UTF-8 byte offset in the Cedar source. */
    end: number;
    label: string | null;
}
/** The diagnostic shape returned by Cedar WASM. */
export interface CedarDetailedError {
    message: string;
    help: string | null;
    code: string | null;
    url: string | null;
    severity: "advice" | "warning" | "error" | null;
    sourceLocations?: CedarSourceLocation[];
    related?: CedarDetailedError[];
}
/** A structured Cedar policy set accepted by the WASM API. */
export interface CedarPolicySetInput {
    staticPolicies?: Record<string, string>;
    templates?: Record<string, string>;
}
/**
 * The dependency-injected subset of a Cedar WASM namespace used by this
 * package. Both the `/nodejs` and `/web` namespace objects satisfy this shape.
 */
export interface CedarWasmModule {
    default?(): Promise<unknown>;
    policySetTextToParts?(source: string): unknown;
    checkParsePolicySet?(policies: CedarPolicySetInput): unknown;
    validate?(call: {
        validationSettings: {
            mode: "strict";
        };
        schema: CedarSchema;
        policies: CedarPolicySetInput;
    }): unknown;
    schemaToJson?(schema: CedarSchema): CedarSchemaToJsonAnswer;
}
/** Initialize a browser Cedar namespace at most once; Node namespaces are ready. */
export declare function ensureCedarInitialized(cedar: CedarWasmModule): Promise<void>;
/** Split a textual Cedar policy set into static policies and templates. */
export declare function splitCedarPolicySet(cedar: CedarWasmModule, source: string): Promise<unknown>;
/** Check the syntax of a structured Cedar policy set. */
export declare function checkCedarParse(cedar: CedarWasmModule, policySet: CedarPolicySetInput): Promise<unknown>;
/** Strictly validate a Cedar policy set against a schema. */
export declare function validateCedarPolicySet(cedar: CedarWasmModule, schema: CedarSchema, policySet: CedarPolicySetInput): Promise<unknown>;
/** Convert either Cedar schema format into ordinary JavaScript JSON data. */
export declare function cedarSchemaToJson(cedar: CedarWasmModule, schema: CedarSchema): Promise<unknown>;
export {};
//# sourceMappingURL=cedar-wasm.d.ts.map
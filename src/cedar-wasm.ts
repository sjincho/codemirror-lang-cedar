type CedarAnnotations = Record<string, string>

type CedarEntityReference = {
  __entity: {type: string; id: string}
}

type CedarExtensionValue =
  | {fn: string; arg: CedarJsonValue}
  | {fn: string; args: CedarJsonValue[]}

type CedarJsonValue =
  | CedarEntityReference
  | {__extn: CedarExtensionValue}
  | boolean
  | number
  | string
  | CedarJsonValue[]
  | {[key: string]: CedarJsonValue}
  | null

type CedarSchemaTypeVariant =
  | {type: "String"}
  | {type: "Long"}
  | {type: "Boolean"}
  | {type: "Set"; element: CedarSchemaType}
  | {
      type: "Record"
      attributes: Record<string, CedarSchemaAttribute>
      additionalAttributes?: boolean
    }
  | {type: "Entity"; name: string}
  | {type: "EntityOrCommon"; name: string}
  | {type: "Extension"; name: string}

type CedarSchemaType = CedarSchemaTypeVariant | {type: string}
type CedarSchemaAttribute = CedarSchemaType & {required?: boolean}
type CedarCommonType = CedarSchemaType & {annotations?: CedarAnnotations}

type CedarEntityType = (
  | {
      memberOfTypes?: string[]
      shape?: CedarSchemaType
      tags?: CedarSchemaType
    }
  | {enum: string[]}
) & {annotations?: CedarAnnotations}

type CedarActionType = {
  attributes?: Record<string, CedarJsonValue>
  appliesTo?: {
    resourceTypes: string[]
    principalTypes: string[]
    context?: CedarSchemaType
  }
  memberOf?: Array<{id: string; type?: string}>
  annotations?: CedarAnnotations
}

type CedarSchemaNamespace = {
  commonTypes?: Record<string, CedarCommonType>
  entityTypes: Record<string, CedarEntityType>
  actions: Record<string, CedarActionType>
  annotations?: CedarAnnotations
}

type CedarSchemaJson = Record<string, CedarSchemaNamespace>

type CedarSchemaToJsonAnswer =
  | {
      type: "success"
      json: CedarSchemaJson
      warnings: CedarDetailedError[]
    }
  | {
      type: "failure"
      errors: CedarDetailedError[]
    }

/** A schema in either Cedar's human-readable format or its JSON format. */
export type CedarSchema = string | CedarSchemaJson

/** A source range reported by Cedar. */
export interface CedarSourceLocation {
  /** Inclusive UTF-8 byte offset in the Cedar source. */
  start: number
  /** Exclusive UTF-8 byte offset in the Cedar source. */
  end: number
  label: string | null
}

/** The diagnostic shape returned by Cedar WASM. */
export interface CedarDetailedError {
  message: string
  help: string | null
  code: string | null
  url: string | null
  severity: "advice" | "warning" | "error" | null
  sourceLocations?: CedarSourceLocation[]
  related?: CedarDetailedError[]
}

/** A structured Cedar policy set accepted by the WASM API. */
export interface CedarPolicySetInput {
  staticPolicies?: Record<string, string>
  templates?: Record<string, string>
}

/**
 * The dependency-injected subset of a Cedar WASM namespace used by this
 * package. Both the `/nodejs` and `/web` namespace objects satisfy this shape.
 */
export interface CedarWasmModule {
  default?(): Promise<unknown>
  policySetTextToParts?(source: string): unknown
  checkParsePolicySet?(policies: CedarPolicySetInput): unknown
  validate?(call: {
    validationSettings: {mode: "strict"}
    schema: CedarSchema
    policies: CedarPolicySetInput
  }): unknown
  schemaToJson?(schema: CedarSchema): CedarSchemaToJsonAnswer
}

const initializationByModule = new WeakMap<object, Promise<void>>()

/** Initialize a browser Cedar namespace at most once; Node namespaces are ready. */
export function ensureCedarInitialized(
  cedar: CedarWasmModule,
): Promise<void> {
  const cached = initializationByModule.get(cedar)
  if (cached) return cached

  const initializer = cedar.default
  const initialization =
    typeof initializer === "function"
      ? Promise.resolve()
          .then(() => initializer.call(cedar))
          .then(() => undefined)
      : Promise.resolve()

  initializationByModule.set(cedar, initialization)
  return initialization
}

function missingMethod(name: string): Error {
  return new Error(`The injected Cedar WASM module does not provide ${name}()`)
}

/** Split a textual Cedar policy set into static policies and templates. */
export async function splitCedarPolicySet(
  cedar: CedarWasmModule,
  source: string,
): Promise<unknown> {
  await ensureCedarInitialized(cedar)

  const policySetTextToParts = cedar.policySetTextToParts
  if (typeof policySetTextToParts !== "function") {
    throw missingMethod("policySetTextToParts")
  }

  return policySetTextToParts.call(cedar, source)
}

/** Check the syntax of a structured Cedar policy set. */
export async function checkCedarParse(
  cedar: CedarWasmModule,
  policySet: CedarPolicySetInput,
): Promise<unknown> {
  await ensureCedarInitialized(cedar)

  const checkParsePolicySet = cedar.checkParsePolicySet
  if (typeof checkParsePolicySet !== "function") {
    throw missingMethod("checkParsePolicySet")
  }

  return checkParsePolicySet.call(cedar, policySet)
}

/** Strictly validate a Cedar policy set against a schema. */
export async function validateCedarPolicySet(
  cedar: CedarWasmModule,
  schema: CedarSchema,
  policySet: CedarPolicySetInput,
): Promise<unknown> {
  await ensureCedarInitialized(cedar)

  const validate = cedar.validate
  if (typeof validate !== "function") throw missingMethod("validate")

  return validate.call(cedar, {
    validationSettings: {mode: "strict"},
    schema,
    policies: policySet,
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function failureMessage(errors: unknown): string {
  if (!Array.isArray(errors)) return ""

  const messages: string[] = []
  for (const error of errors) {
    if (isRecord(error) && typeof error.message === "string") {
      messages.push(error.message)
    }
  }
  return messages.length ? `: ${messages.join("; ")}` : ""
}

function decodeSchemaJson(value: unknown): Record<string, unknown> {
  let decoded = value
  if (typeof value === "string") {
    try {
      decoded = JSON.parse(value)
    } catch {
      throw new Error("Cedar WASM schemaToJson() returned malformed JSON")
    }
  }

  if (!isRecord(decoded)) {
    throw new Error("Cedar WASM schemaToJson() returned an invalid schema")
  }
  return decoded
}

/** Convert either Cedar schema format into ordinary JavaScript JSON data. */
export async function cedarSchemaToJson(
  cedar: CedarWasmModule,
  schema: CedarSchema,
): Promise<unknown> {
  await ensureCedarInitialized(cedar)

  const schemaToJson = cedar.schemaToJson
  if (typeof schemaToJson !== "function") throw missingMethod("schemaToJson")

  const answer: unknown = schemaToJson.call(cedar, schema)
  if (!isRecord(answer) || typeof answer.type !== "string") {
    throw new Error("Cedar WASM schemaToJson() returned an invalid answer")
  }
  if (answer.type === "failure") {
    throw new Error(
      `Cedar WASM schema conversion failed${failureMessage(answer.errors)}`,
    )
  }
  if (answer.type !== "success" || !("json" in answer)) {
    throw new Error("Cedar WASM schemaToJson() returned an invalid answer")
  }

  return decodeSchemaJson(answer.json)
}

import type {
  Completion,
  CompletionContext,
  CompletionResult,
  CompletionSource,
} from "@codemirror/autocomplete"
import { syntaxTree } from "@codemirror/language"
import type { SyntaxNode } from "@lezer/common"
import {
  cedarSchemaToJson,
  type CedarSchema,
  type CedarWasmModule,
} from "./cedar-wasm.js"

/** Configuration for Cedar policy completions. */
export interface CedarCompletionConfig {
  schema?: CedarSchema
  cedar?: CedarWasmModule
}

const word = (
  label: string,
  detail: string,
  boost: number,
  type = "keyword",
): Completion => ({label, type, detail, boost})

const cedarWords: readonly Completion[] = [
  word("permit", "allow policy", 100),
  word("forbid", "deny policy", 100),
  word("when", "condition clause", 90),
  word("unless", "negated condition clause", 90),
  word("principal", "request principal", 85, "variable"),
  word("action", "request action", 85, "variable"),
  word("resource", "request resource", 85, "variable"),
  word("context", "request context", 80, "variable"),
  word("in", "membership relation", 75),
  word("is", "entity type relation", 75),
  word("like", "string pattern relation", 70),
  word("has", "attribute presence relation", 70),
  word("if", "conditional expression", 65),
  word("then", "conditional branch", 65),
  word("else", "conditional branch", 65),
  word("true", "boolean literal", 60, "bool"),
  word("false", "boolean literal", 60, "bool"),
  word("==", "equality", 45, "operator"),
  word("!=", "inequality", 45, "operator"),
  word("&&", "logical and", 40, "operator"),
  word("||", "logical or", 40, "operator"),
  word("!", "logical not", 40, "operator"),
  word("<", "less than", 35, "operator"),
  word("<=", "less than or equal", 35, "operator"),
  word(">", "greater than", 35, "operator"),
  word(">=", "greater than or equal", 35, "operator"),
]

interface AttributeInfo {
  name: string
  required: boolean | undefined
}

interface EntityInfo {
  name: string
  attributes: readonly AttributeInfo[]
}

interface ActionInfo {
  id: string
  reference: string
  principalTypes: readonly string[]
  resourceTypes: readonly string[]
}

interface NormalizedSchema {
  entities: readonly EntityInfo[]
  actions: readonly ActionInfo[]
}

interface SchemaModule {
  namespace: string
  value: Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function recordField(
  value: Record<string, unknown>,
  name: string,
): Record<string, unknown> | undefined {
  const field = value[name]
  return isRecord(field) ? field : undefined
}

function qualified(namespace: string, name: string): string {
  return !namespace || name.includes("::") ? name : `${namespace}::${name}`
}

function collectModules(value: unknown): SchemaModule[] {
  if (isRecord(value) && value.type === "success" && "json" in value) {
    value = value.json
  }
  if (!isRecord(value)) return []

  const modules: SchemaModule[] = []
  const seen = new WeakSet<object>()
  const wrappers = new Set(["json", "schema", "namespaces", "modules", "result", "value"])

  const visit = (candidate: unknown, namespace: string): void => {
    if (!isRecord(candidate) || seen.has(candidate)) return
    seen.add(candidate)

    if (
      isRecord(candidate.entityTypes) ||
      isRecord(candidate.actions) ||
      isRecord(candidate.commonTypes)
    ) {
      modules.push({namespace, value: candidate})
      return
    }

    for (const [name, child] of Object.entries(candidate)) {
      if (!isRecord(child)) continue
      const childNamespace = wrappers.has(name)
        ? namespace
        : qualified(namespace, name)
      visit(child, childNamespace)
    }
  }

  visit(value, "")
  return modules
}

function normalizeSchema(value: unknown): NormalizedSchema {
  const modules = collectModules(value)
  if (!modules.length) throw new Error("Invalid Cedar schema JSON")
  const commonTypes = new Map<string, unknown>()

  for (const module of modules) {
    const common = recordField(module.value, "commonTypes")
    if (!common) continue
    for (const [name, definition] of Object.entries(common)) {
      commonTypes.set(qualified(module.namespace, name), definition)
      if (!module.namespace) commonTypes.set(name, definition)
    }
  }

  const resolveCommon = (
    candidate: unknown,
    namespace: string,
    visited: Set<unknown>,
  ): Record<string, unknown> | undefined => {
    if (!isRecord(candidate) || visited.has(candidate)) return undefined
    visited.add(candidate)

    if (candidate.type === "Record" && isRecord(candidate.attributes)) {
      return candidate.attributes
    }

    if (isRecord(candidate.shape)) {
      const shape = resolveCommon(candidate.shape, namespace, visited)
      if (shape) return shape
    }

    const typeName =
      typeof candidate.type === "string" &&
      ![
        "String",
        "Long",
        "Boolean",
        "Set",
        "Record",
        "Entity",
        "EntityOrCommon",
        "CommonType",
        "Extension",
      ].includes(candidate.type)
        ? candidate.type
        : typeof candidate.name === "string" &&
            (candidate.type === "EntityOrCommon" || candidate.type === "CommonType")
          ? candidate.name
          : undefined
    if (!typeName) return undefined

    const definition =
      commonTypes.get(typeName) ?? commonTypes.get(qualified(namespace, typeName))
    return resolveCommon(definition, namespace, visited)
  }

  const entities: EntityInfo[] = []
  const actions: ActionInfo[] = []

  for (const module of modules) {
    const entityTypes = recordField(module.value, "entityTypes")
    if (entityTypes) {
      for (const [name, definition] of Object.entries(entityTypes)) {
        const attributes = resolveCommon(definition, module.namespace, new Set())
        const normalizedAttributes: AttributeInfo[] = []
        if (attributes) {
          for (const [attributeName, attribute] of Object.entries(attributes)) {
            normalizedAttributes.push({
              name: attributeName,
              required: isRecord(attribute) && typeof attribute.required === "boolean"
                ? attribute.required
                : undefined,
            })
          }
        }
        entities.push({
          name: qualified(module.namespace, name),
          attributes: normalizedAttributes,
        })
      }
    }

    const schemaActions = recordField(module.value, "actions")
    if (!schemaActions) continue
    for (const [id, definition] of Object.entries(schemaActions)) {
      const action = isRecord(definition) ? definition : {}
      const appliesTo = isRecord(action.appliesTo) ? action.appliesTo : {}
      const typeNames = (field: "principalTypes" | "resourceTypes"): string[] => {
        const alternate = field === "principalTypes" ? "principal_types" : "resource_types"
        const values = Array.isArray(appliesTo[field])
          ? appliesTo[field]
          : Array.isArray(appliesTo[alternate])
            ? appliesTo[alternate]
            : []
        return values.flatMap(value =>
          typeof value === "string"
            ? [qualified(module.namespace, value)]
            : [],
        )
      }
      const reference = id.includes("Action::\"")
        ? id
        : `${module.namespace ? `${module.namespace}::` : ""}Action::"${escapeString(id)}"`
      actions.push({
        id: actionId(id),
        reference,
        principalTypes: typeNames("principalTypes"),
        resourceTypes: typeNames("resourceTypes"),
      })
    }
  }

  return {
    entities: uniqueBy(entities, entity => entity.name),
    actions: uniqueBy(actions, action => action.reference),
  }
}

function uniqueBy<T>(values: readonly T[], key: (value: T) => string): T[] {
  const found = new Map<string, T>()
  for (const value of values) if (!found.has(key(value))) found.set(key(value), value)
  return [...found.values()]
}

function escapeString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

function actionId(value: string): string {
  const match = /Action::"((?:[^"\\]|\\.)*)"/.exec(value)
  return match ? match[1].replace(/\\([\\"])/g, "$1") : value
}

function entityOptions(schema: NormalizedSchema): readonly Completion[] {
  return schema.entities.map(entity => ({
    label: entity.name,
    type: "type",
    detail: "Cedar entity type",
    boost: 95,
  }))
}

function actionOptions(
  schema: NormalizedSchema,
  insideString: boolean,
): readonly Completion[] {
  return schema.actions.map(action => ({
    label: action.reference,
    filterText: insideString ? action.id : undefined,
    apply: insideString ? `${escapeString(action.id)}"` : action.reference,
    type: "enum",
    detail: "Cedar action",
    boost: 100,
  }))
}

function findEntity(
  schema: NormalizedSchema,
  typeName: string,
): EntityInfo | undefined {
  const exact = schema.entities.find(entity => entity.name === typeName)
  if (exact) return exact
  const suffix = schema.entities.filter(entity => entity.name.endsWith(`::${typeName}`))
  return suffix.length === 1 ? suffix[0] : undefined
}

function inferredScopeType(document: string, variable: string): string | undefined {
  const identifier = "[A-Za-z_][\\w]*(?:::[A-Za-z_][\\w]*)*"
  const patterns = [
    new RegExp(`\\b${variable}\\s+is\\s+(${identifier})`, "g"),
    new RegExp(`\\b${variable}\\s*(?:==|in)\\s*(${identifier})::\"`, "g"),
  ]
  let latest: {index: number; type: string} | undefined
  for (const pattern of patterns) {
    for (let match; (match = pattern.exec(document)); ) {
      if (!latest || match.index > latest.index) {
        latest = {index: match.index, type: match[1]}
      }
    }
  }
  return latest?.type
}

function inferredActionType(
  document: string,
  variable: "principal" | "resource",
  schema: NormalizedSchema,
): string | undefined {
  const references = new Set<string>()
  const pattern = /(?:(?:[A-Za-z_][\w]*::)*Action)::"((?:[^"\\]|\\.)*)"/g
  for (let match; (match = pattern.exec(document)); ) {
    references.add(match[0])
  }
  if (references.size !== 1) return undefined

  const reference = [...references][0]
  const id = actionId(reference)
  const matches = schema.actions.filter(action =>
    action.reference === reference || action.id === id,
  )
  if (matches.length !== 1) return undefined
  const types = variable === "principal"
    ? matches[0].principalTypes
    : matches[0].resourceTypes
  return types.length === 1 ? types[0] : undefined
}

/**
 * True when the caret sits inside a string literal or a line comment. Keyword,
 * operator, and identifier completions are noise there. The one meaningful
 * in-string case — an `Action::"…"` id — is handled by its own branch before
 * this guard runs.
 */
function insideStringOrComment(context: CompletionContext): boolean {
  const {state, pos} = context
  for (
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1);
    node;
    node = node.parent
  ) {
    if (node.name === "String" || node.name === "LineComment") return true
  }
  // A string still being typed has no closing quote yet, so the strict `String`
  // token never matches and the tree can't see it. Walk the document counting
  // unescaped quotes; an odd count means the caret is inside an open string.
  const before = state.doc.sliceString(0, pos)
  let open = false
  for (let i = 0; i < before.length; i++) {
    const code = before.charCodeAt(i)
    if (code === 92 /* \ */) {
      i++
      continue
    }
    if (code === 34 /* " */) open = !open
  }
  return open
}

function completeWithSchema(
  context: CompletionContext,
  schema: NormalizedSchema | null,
): CompletionResult | null {
  const actionString = context.matchBefore(
    /(?:(?:[A-Za-z_][\w]*::)*Action)::"(?:[^"\\]|\\.)*$/,
  )
  if (actionString) {
    const quote = actionString.text.indexOf('"')
    const from = actionString.from + quote + 1
    return {
      from,
      to: context.state.doc.sliceString(context.pos, context.pos + 1) === '"'
        ? context.pos + 1
        : context.pos,
      options: schema?.actions.length ? actionOptions(schema, true) : cedarWords,
      validFor: /^(?:[^"\\]|\\.)*"?$/,
    }
  }

  // Past the intentional in-string action-id branch, suppress everything else
  // when the caret is inside a string literal or comment.
  if (insideStringOrComment(context)) return null

  const attribute = context.matchBefore(
    /(?:(?:[A-Za-z_][\w]*::)*[A-Za-z_][\w]*::"(?:[^"\\]|\\.)*"|principal|resource|action|context)\.[A-Za-z_][\w]*$|(?:(?:[A-Za-z_][\w]*::)*[A-Za-z_][\w]*::"(?:[^"\\]|\\.)*"|principal|resource|action|context)\.$/,
  )
  if (attribute) {
    const dot = attribute.text.lastIndexOf(".")
    const receiver = attribute.text.slice(0, dot)
    const typed = attribute.text.slice(dot + 1)
    if (!schema) {
      return {
        from: attribute.to - typed.length,
        options: cedarWords,
        validFor: /^(?:[A-Za-z_][\w]*)?$/,
      }
    }
    let typeName: string | undefined
    const literal = /^((?:[A-Za-z_][\w]*::)*[A-Za-z_][\w]*)::"/.exec(receiver)
    if (literal) {
      typeName = literal[1]
    } else if (receiver === "principal" || receiver === "resource") {
      const document = context.state.doc.toString()
      const before = document.slice(0, context.pos)
      const policyStart = Math.max(
        before.lastIndexOf(";"),
        before.lastIndexOf("permit"),
        before.lastIndexOf("forbid"),
      )
      const nearbyPolicy = before.slice(Math.max(0, policyStart))
      typeName = inferredScopeType(nearbyPolicy, receiver) ??
        inferredActionType(nearbyPolicy, receiver, schema)
    }
    if (!typeName) return null

    const entity = findEntity(schema, typeName)
    if (!entity) return null
    return {
      from: attribute.to - typed.length,
      options: entity.attributes.map(item => ({
        label: item.name,
        type: "property",
        detail: item.required === false ? "optional Cedar attribute" : "Cedar attribute",
        boost: 100,
      })),
      validFor: /^(?:[A-Za-z_][\w]*)?$/,
    }
  }

  const actionOperand = context.matchBefore(
    /\baction\s*(?:==|in)\s*(?:\[\s*)?(?:[A-Za-z_][\w:]*)?$/,
  )
  if (actionOperand) {
    const token = /[A-Za-z_][\w:]*$/.exec(actionOperand.text)
    return {
      from: token ? actionOperand.to - token[0].length : actionOperand.to,
      options: schema?.actions.length ? actionOptions(schema, false) : cedarWords,
      validFor: /^(?:[A-Za-z_][\w:]*(?:"[^"\\]*)?)?$/,
    }
  }

  const entityOperand = context.matchBefore(
    /(?:\b(?:principal|resource)\s*(?:==|in)\s*|\bis\s+)(?:[A-Za-z_][\w:]*)?$/,
  )
  if (entityOperand) {
    const token = /[A-Za-z_][\w:]*$/.exec(entityOperand.text)
    return {
      from: token ? entityOperand.to - token[0].length : entityOperand.to,
      options: schema?.entities.length ? entityOptions(schema) : cedarWords,
      validFor: /^(?:[A-Za-z_][\w:]*)?$/,
    }
  }

  const qualifiedType = context.matchBefore(
    /(?:[A-Za-z_][\w]*::)+(?:[A-Za-z_][\w]*)?$/,
  )
  if (qualifiedType && schema?.entities.length) {
    return {
      from: qualifiedType.from,
      options: entityOptions(schema),
      validFor: /^(?:[A-Za-z_][\w:]*)?$/,
    }
  }

  const identifier = context.matchBefore(/[A-Za-z_][\w]*$/)
  if (identifier) {
    return {
      from: identifier.from,
      options: cedarWords,
      validFor: /^(?:[A-Za-z_][\w]*)?$/,
    }
  }
  const operator = context.matchBefore(/[!<>=&|]+$/)
  if (operator) {
    return {
      from: operator.from,
      options: cedarWords.filter(option => option.type === "operator"),
      validFor: /^[!<>=&|]*$/,
    }
  }
  if (!context.explicit) return null
  return {from: context.pos, options: cedarWords}
}

/**
 * Create a Cedar completion source. Schema conversion is lazy and cached for
 * this source. Missing or malformed schema data never prevents basic Cedar
 * keyword completion.
 */
export function cedarCompletion(
  config: CedarCompletionConfig = {},
): CompletionSource {
  let schemaPromise: Promise<NormalizedSchema | null> | undefined

  const loadSchema = (): Promise<NormalizedSchema | null> => {
    if (config.schema === undefined || config.cedar === undefined) {
      return Promise.resolve(null)
    }
    if (!schemaPromise) {
      schemaPromise = cedarSchemaToJson(config.cedar, config.schema)
        .then(normalizeSchema)
        .catch(() => null)
    }
    return schemaPromise
  }

  return async context => completeWithSchema(context, await loadSchema())
}

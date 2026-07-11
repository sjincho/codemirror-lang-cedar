import type {SyntaxNode, SyntaxNodeRef} from "@lezer/common"
// The Rollup Lezer plugin turns this grammar into an LRParser module.
// @ts-expect-error TypeScript does not resolve generated grammar modules.
import {parser} from "./cedar.grammar"
import {splitCedarPolicySet} from "./cedar-wasm.js"
import type {
  CedarDetailedError,
  CedarPolicySetInput,
  CedarWasmModule,
} from "./cedar-wasm.js"

export interface CedarPolicyOrigin {
  kind: "static" | "template"
  from: number
  to: number
  text: string
}

export type PreparedCedarPolicySet =
  | {type: "failure"; errors: CedarDetailedError[]}
  | {
      type: "success"
      policySet: CedarPolicySetInput
      origins: Map<string, CedarPolicyOrigin>
    }

type SplitSuccess = {
  type: "success"
  policies: string[]
  policy_templates: string[]
}

type PolicySpan = CedarPolicyOrigin & {index: number}
type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: UnknownRecord, keys: readonly string[]): boolean {
  const expected = new Set(keys)
  return Object.keys(value).every(key => expected.has(key)) &&
    keys.every(key => key in value)
}

function isDetailedError(value: unknown): value is CedarDetailedError {
  return isRecord(value) && typeof value.message === "string"
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === "string")
}

function decodeSplitAnswer(answer: unknown):
  | SplitSuccess
  | {type: "failure"; errors: CedarDetailedError[]} {
  if (!isRecord(answer) || typeof answer.type !== "string") {
    throw new Error("Cedar WASM returned an invalid policy-set split answer")
  }

  if (answer.type === "success") {
    if (
      !hasOnlyKeys(answer, ["type", "policies", "policy_templates"]) ||
      !stringArray(answer.policies) ||
      !stringArray(answer.policy_templates)
    ) {
      throw new Error("Cedar WASM returned an invalid policy-set split answer")
    }
    return {
      type: "success",
      policies: answer.policies,
      policy_templates: answer.policy_templates,
    }
  }

  if (answer.type === "failure") {
    if (
      !hasOnlyKeys(answer, ["type", "errors"]) ||
      !Array.isArray(answer.errors) ||
      !answer.errors.every(isDetailedError)
    ) {
      throw new Error("Cedar WASM returned an invalid policy-set split answer")
    }
    return {type: "failure", errors: answer.errors}
  }

  throw new Error("Cedar WASM returned an invalid policy-set split answer")
}

function containsSlot(node: SyntaxNode): boolean {
  const cursor = node.cursor()
  let depth = 0

  for (;;) {
    if (cursor.name === "PrincipalSlot" || cursor.name === "ResourceSlot") {
      return true
    }
    if (cursor.firstChild()) {
      depth++
      continue
    }

    for (;;) {
      if (cursor.nextSibling()) break
      if (depth === 0 || !cursor.parent()) return false
      depth--
      if (depth === 0) return false
    }
  }
}

function policySpans(source: string): PolicySpan[] {
  const tree = parser.parse(source)
  let hasRecoveryNode = false
  tree.iterate({
    enter(node: SyntaxNodeRef) {
      if (node.type.isError) hasRecoveryNode = true
    },
  })
  if (hasRecoveryNode) {
    throw new Error(
      "Lezer could not classify a policy set that Cedar accepted",
    )
  }

  const spans: PolicySpan[] = []
  for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
    if (node.name !== "Policy") continue
    spans.push({
      index: spans.length,
      kind: containsSlot(node) ? "template" : "static",
      from: node.from,
      to: node.to,
      text: source.slice(node.from, node.to),
    })
  }

  if (source.trim().length && !spans.length) {
    throw new Error(
      "Lezer found no policies in a nonempty policy set that Cedar accepted",
    )
  }
  return spans
}

/** Prepare exact policy source slices for Cedar parsing and validation. */
export async function prepareCedarPolicySet(
  cedar: CedarWasmModule,
  source: string,
): Promise<PreparedCedarPolicySet> {
  const split = decodeSplitAnswer(await splitCedarPolicySet(cedar, source))
  if (split.type === "failure") return split

  const spans = policySpans(source)
  const staticCount = spans.filter(span => span.kind === "static").length
  const templateCount = spans.length - staticCount
  if (
    staticCount !== split.policies.length ||
    templateCount !== split.policy_templates.length
  ) {
    throw new Error(
      "Lezer policy classification did not match Cedar's policy-set split",
    )
  }

  const staticPolicies: Record<string, string> = {}
  const templates: Record<string, string> = {}
  const origins = new Map<string, CedarPolicyOrigin>()

  for (const {index, kind, from, to, text} of spans) {
    const id = `cm_${kind}_${index}`
    if (kind === "template") templates[id] = text
    else staticPolicies[id] = text
    origins.set(id, {kind, from, to, text})
  }

  const policySet: CedarPolicySetInput = {}
  if (staticCount) policySet.staticPolicies = staticPolicies
  if (templateCount) policySet.templates = templates
  return {type: "success", policySet, origins}
}

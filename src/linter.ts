import {linter} from "@codemirror/lint"
import type {Diagnostic, LintSource} from "@codemirror/lint"
import type {Extension} from "@codemirror/state"
import {
  checkCedarParse,
  validateCedarPolicySet,
} from "./cedar-wasm.js"
import type {
  CedarDetailedError,
  CedarSchema,
  CedarSourceLocation,
  CedarWasmModule,
} from "./cedar-wasm.js"
import {prepareCedarPolicySet} from "./policy-set.js"
import type {CedarPolicyOrigin} from "./policy-set.js"

/** A CodeMirror diagnostic returned by a custom Cedar validation backend. */
export interface CedarDiagnosticLike extends Diagnostic {}

/** Configuration for Cedar parsing and schema validation. */
export interface CedarLinterConfig {
  cedar?: CedarWasmModule
  schema?: CedarSchema
  validate?: (
    source: string,
  ) =>
    | Promise<readonly CedarDiagnosticLike[]>
    | readonly CedarDiagnosticLike[]
  delay?: number
}

type UnknownRecord = Record<string, unknown>
type ValidationErrorEntry = {policyId: string; error: CedarDetailedError}
type MappedError = {
  error: CedarDetailedError
  origin?: CedarPolicyOrigin
  wholeDocument?: boolean
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isDetailedError(value: unknown): value is CedarDetailedError {
  return isRecord(value) && typeof value.message === "string"
}

function detailedErrors(value: unknown): CedarDetailedError[] {
  return Array.isArray(value) ? value.filter(isDetailedError) : []
}

function parseErrors(answer: unknown): CedarDetailedError[] | null {
  if (!isRecord(answer)) {
    throw new Error("Cedar WASM returned an invalid parse answer")
  }
  if (answer.type === "success") return null
  if (answer.type === "failure") return detailedErrors(answer.errors)
  throw new Error("Cedar WASM returned an invalid parse answer")
}

function errorMessages(errors: unknown): string {
  const messages = detailedErrors(errors).map(error => error.message)
  return messages.length ? `: ${messages.join("; ")}` : ""
}

function validationErrors(answer: unknown): ValidationErrorEntry[] {
  if (!isRecord(answer)) {
    throw new Error("Cedar WASM returned an invalid validation answer")
  }
  if (answer.type === "failure") {
    // A failure means Cedar couldn't perform validation (for example, because
    // the schema is malformed). Its source locations refer to the schema, not
    // the policy document, so they must never become policy error ranges.
    throw new Error(
      `Cedar WASM validation failed${errorMessages(answer.errors)}`,
    )
  }
  if (answer.type !== "success" || !Array.isArray(answer.validationErrors)) {
    throw new Error("Cedar WASM returned an invalid validation answer")
  }

  const entries: ValidationErrorEntry[] = []
  for (const entry of answer.validationErrors) {
    if (
      !isRecord(entry) ||
      typeof entry.policyId !== "string" ||
      !isDetailedError(entry.error)
    ) {
      throw new Error("Cedar WASM returned an invalid validation answer")
    }
    entries.push({policyId: entry.policyId, error: entry.error})
  }
  return entries
}

function cedarOffsetToDocumentPosition(
  source: string,
  position: number,
): number {
  if (!Number.isFinite(position)) return 0
  const target = Math.max(0, Math.trunc(position))
  let byteOffset = 0
  let documentPosition = 0

  for (const character of source) {
    const codePoint = character.codePointAt(0)!
    const byteLength = codePoint <= 0x7f
      ? 1
      : codePoint <= 0x7ff
        ? 2
        : codePoint <= 0xffff
          ? 3
          : 4
    const nextByteOffset = byteOffset + byteLength
    if (target < nextByteOffset) return documentPosition

    byteOffset = nextByteOffset
    documentPosition += character.length
    if (target === byteOffset) return documentPosition
  }

  return source.length
}

function isSourceLocation(value: unknown): value is CedarSourceLocation {
  return (
    isRecord(value) &&
    typeof value.start === "number" &&
    typeof value.end === "number"
  )
}

function diagnosticMessage(
  error: CedarDetailedError,
  location?: CedarSourceLocation,
): string {
  let message = error.message
  if (location?.label) message += `: ${location.label}`
  if (error.help) message += `\n${error.help}`
  return message
}

function diagnosticSeverity(error: CedarDetailedError): Diagnostic["severity"] {
  if (error.severity === "warning") return "warning"
  if (error.severity === "advice") return "info"
  return "error"
}

function cedarDiagnostics(
  errors: readonly MappedError[],
  source: string,
): Diagnostic[] {
  const documentLength = source.length
  const diagnostics: Diagnostic[] = []
  const seen = new Set<string>()

  const add = (diagnostic: Diagnostic) => {
    const key = JSON.stringify([
      diagnostic.from,
      diagnostic.to,
      diagnostic.severity,
      diagnostic.message,
    ])
    if (seen.has(key)) return
    seen.add(key)
    diagnostics.push(diagnostic)
  }

  for (const {error, origin, wholeDocument} of errors) {
    const locations = Array.isArray(error.sourceLocations)
      ? error.sourceLocations.filter(isSourceLocation)
      : []
    const severity = diagnosticSeverity(error)

    if (!locations.length) {
      add({
        from: 0,
        to: documentLength,
        severity,
        source: "Cedar",
        message: diagnosticMessage(error),
      })
      continue
    }
    if (wholeDocument) {
      for (const location of locations) {
        add({
          from: 0,
          to: documentLength,
          severity,
          source: "Cedar",
          message: diagnosticMessage(error, location),
        })
      }
      continue
    }

    for (const location of locations) {
      // Cedar reports UTF-8 byte offsets, while CodeMirror uses UTF-16 positions.
      let from: number
      let to: number
      if (origin) {
        const localFrom = cedarOffsetToDocumentPosition(origin.text, location.start)
        const localTo = cedarOffsetToDocumentPosition(origin.text, location.end)
        from = Math.min(origin.to, Math.max(origin.from, origin.from + localFrom))
        to = Math.min(origin.to, Math.max(origin.from, origin.from + localTo))
      } else {
        from = cedarOffsetToDocumentPosition(source, location.start)
        to = cedarOffsetToDocumentPosition(source, location.end)
      }
      add({
        from,
        to: Math.max(from, to),
        severity,
        source: "Cedar",
        message: diagnosticMessage(error, location),
      })
    }
  }

  return diagnostics
}

function unavailableDiagnostic(error: unknown, documentLength: number): Diagnostic {
  const detail =
    error instanceof Error && error.message
      ? error.message
      : typeof error === "string" && error
        ? error
        : "unknown error"
  return {
    from: 0,
    to: documentLength,
    severity: "warning",
    source: "Cedar",
    message: `Cedar validation unavailable: ${detail}`,
  }
}

/** Add debounced Cedar syntax and strict schema validation to an editor. */
export function cedarLinter(config: CedarLinterConfig = {}): Extension {
  const delay = config.delay ?? 400

  const source: LintSource = async view => {
    const text = view.state.doc.toString()

    try {
      if (config.validate) {
        return await Promise.resolve(config.validate(text))
      }
      if (!config.cedar) return []

      const prepared = await prepareCedarPolicySet(config.cedar, text)
      if (prepared.type === "failure") {
        return cedarDiagnostics(
          prepared.errors.map(error => ({error})),
          text,
        )
      }
      if (!prepared.origins.size) return []

      const parseAnswer = await checkCedarParse(
        config.cedar,
        prepared.policySet,
      )
      const failures = parseErrors(parseAnswer)
      if (failures) {
        throw new Error(
          `Cedar WASM rejected the prepared policy set${errorMessages(failures)}`,
        )
      }
      if (config.schema === undefined) return []

      const validationAnswer = await validateCedarPolicySet(
        config.cedar,
        config.schema,
        prepared.policySet,
      )
      const mapped = validationErrors(validationAnswer).map(({policyId, error}) => {
        const origin = prepared.origins.get(policyId)
        return {error, origin, wholeDocument: !origin}
      })
      return cedarDiagnostics(mapped, text)
    } catch (error) {
      return [unavailableDiagnostic(error, text.length)]
    }
  }

  return linter(source, {delay})
}

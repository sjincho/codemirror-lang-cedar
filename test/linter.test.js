import assert from "node:assert/strict"
import * as cedarWasm from "@cedar-policy/cedar-wasm/nodejs"
import {
  diagnosticCount,
  forceLinting,
  forEachDiagnostic,
} from "@codemirror/lint"
import {EditorView} from "@codemirror/view"
import {JSDOM} from "jsdom"
import {cedar, cedarLinter} from "../dist/index.js"

const schema = `namespace PhotoApp {
  entity User;
  entity Photo {
    owner: User
  };
  action "view" appliesTo {
    principal: User,
    resource: Photo,
    context: {}
  };
}`

const invalidPolicy = `permit(
  principal,
  action == PhotoApp::Action::"view",
  resource
) when {
  resource.owner == "not an entity"
};`

const validPolicy = `permit(
  principal,
  action == PhotoApp::Action::"view",
  resource
) when {
  resource.owner == principal
};`

const validTemplate = `permit(
  principal == ?principal,
  action == PhotoApp::Action::"view",
  resource == ?resource
);`

const invalidTemplate = `permit(
  principal == ?principal,
  action == PhotoApp::Action::"view",
  resource == ?resource
) when {
  resource.owner == "not an entity"
};`

const views = []
let dom
const originalGlobals = new Map()

function installGlobal(name, value) {
  originalGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  })
}

function restoreGlobals() {
  for (const [name, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else delete globalThis[name]
  }
  originalGlobals.clear()
}

function createView(doc, config) {
  const parent = document.body.appendChild(document.createElement("div"))
  const view = new EditorView({
    doc,
    extensions: [cedar(), cedarLinter({delay: 0, ...config})],
    parent,
  })
  views.push(view)
  return view
}

function readDiagnostics(view) {
  const diagnostics = []
  forEachDiagnostic(view.state, (diagnostic, from, to) => {
    diagnostics.push({...diagnostic, from, to})
  })
  return diagnostics
}

async function lint(view, expectedCount, timeout = 2000) {
  forceLinting(view)
  const started = Date.now()
  let diagnostics = []

  while (Date.now() - started < timeout) {
    await new Promise(resolve => setTimeout(resolve, 10))
    diagnostics = readDiagnostics(view)
    if (
      diagnosticCount(view.state) === expectedCount &&
      Date.now() - started >= 50
    ) {
      return diagnostics
    }
  }

  assert.equal(
    diagnosticCount(view.state),
    expectedCount,
    `lint did not settle: ${JSON.stringify(diagnostics)}`,
  )
  return diagnostics
}

describe("cedarLinter", () => {
  before(() => {
    dom = new JSDOM("<!doctype html><html><body></body></html>", {
      pretendToBeVisual: true,
    })
    installGlobal("window", dom.window)
    installGlobal("document", dom.window.document)
    installGlobal("navigator", dom.window.navigator)
    installGlobal("Window", dom.window.Window)
    installGlobal("MutationObserver", dom.window.MutationObserver)
    installGlobal("requestAnimationFrame", dom.window.requestAnimationFrame.bind(dom.window))
    installGlobal("cancelAnimationFrame", dom.window.cancelAnimationFrame.bind(dom.window))
  })

  afterEach(() => {
    while (views.length) views.pop().destroy()
    document.body.replaceChildren()
  })

  after(() => {
    dom.window.close()
    restoreGlobals()
  })

  it("maps a real Cedar parse failure to its source range", async () => {
    const source = "permit(principal,, action, resource);"
    const diagnostics = await lint(
      createView(source, {cedar: cedarWasm}),
      1,
    )

    assert.equal(diagnostics[0].from, 17)
    assert.equal(diagnostics[0].to, 18)
    assert.equal(diagnostics[0].severity, "error")
    assert.match(diagnostics[0].message, /unexpected token/)
    assert.match(diagnostics[0].message, /expected `\)` or identifier/)
  })

  it("converts Cedar UTF-8 offsets to CodeMirror document positions", async () => {
    const source = 'permit(principal, action, resource) when { "😀" == };'
    const diagnostics = await lint(createView(source, {cedar: cedarWasm}), 1)
    const closingBrace = source.indexOf("}")

    assert.equal(diagnostics[0].from, closingBrace)
    assert.equal(diagnostics[0].to, closingBrace + 1)
  })

  it("runs strict validation against a human-format schema", async () => {
    const diagnostics = await lint(
      createView(invalidPolicy, {cedar: cedarWasm, schema}),
      1,
    )

    assert.equal(diagnostics[0].severity, "error")
    assert.match(diagnostics[0].message, /types String and PhotoApp::User/)
    assert.match(diagnostics[0].message, /both operands to a `==` expression/)
  })

  it("returns no diagnostics for a valid policy", async () => {
    const diagnostics = await lint(
      createView(validPolicy, {cedar: cedarWasm, schema}),
      0,
    )
    assert.deepEqual(diagnostics, [])
  })

  it("returns no diagnostics for a valid template without a schema", async () => {
    const diagnostics = await lint(
      createView(validTemplate, {cedar: cedarWasm}),
      0,
    )
    assert.deepEqual(diagnostics, [])
  })

  it("strictly validates a valid template against a schema", async () => {
    const diagnostics = await lint(
      createView(validTemplate, {cedar: cedarWasm, schema}),
      0,
    )
    assert.deepEqual(diagnostics, [])
  })

  it("maps a template validation error to its exact expression", async () => {
    const diagnostics = await lint(
      createView(invalidTemplate, {cedar: cedarWasm, schema}),
      1,
    )

    assert.equal(diagnostics[0].from, 108)
    assert.equal(diagnostics[0].to, 141)
    assert.match(diagnostics[0].message, /types String and PhotoApp::User/)
  })

  it("validates a mixed static policy and template document", async () => {
    const source = `${validPolicy}\n\n${validTemplate}`
    const diagnostics = await lint(
      createView(source, {cedar: cedarWasm, schema}),
      0,
    )
    assert.deepEqual(diagnostics, [])
  })

  it("maps a second-policy template error to document coordinates", async () => {
    const source = `${validPolicy}\n\n${invalidTemplate}`
    const diagnostics = await lint(
      createView(source, {cedar: cedarWasm, schema}),
      1,
    )

    assert.equal(diagnostics[0].from, 221)
    assert.equal(diagnostics[0].to, 254)
    assert.match(diagnostics[0].message, /types String and PhotoApp::User/)
  })

  it("reports malformed schemas as validation-unavailable warnings", async () => {
    const source =
      "permit(principal, action, resource) when { resource.x == 1 };"
    const malformedSchema = "namespace Bad { entity User {{{ "
    const diagnostics = await lint(
      createView(source, {cedar: cedarWasm, schema: malformedSchema}),
      1,
    )

    assert.equal(diagnostics[0].from, 0)
    assert.equal(diagnostics[0].to, source.length)
    assert.equal(diagnostics[0].severity, "warning")
    assert.match(diagnostics[0].message, /^Cedar validation unavailable:/)
    assert.match(diagnostics[0].message, /failed to parse schema from string/)
  })

  it("uses the whole document for a locationless splitter failure", async () => {
    const source = "permit(principal, action, resource);"
    const fakeCedar = {
      policySetTextToParts() {
        return {
          type: "failure",
          errors: [{message: "locationless parse failure", help: null}],
        }
      },
    }
    const diagnostics = await lint(createView(source, {cedar: fakeCedar}), 1)

    assert.equal(diagnostics[0].from, 0)
    assert.equal(diagnostics[0].to, source.length)
    assert.equal(diagnostics[0].message, "locationless parse failure")
  })

  it("warns when Lezer classification disagrees with the splitter", async () => {
    const source = "permit(principal, action, resource);"
    const fakeCedar = {
      policySetTextToParts() {
        return {
          type: "success",
          policies: [],
          policy_templates: [source],
        }
      },
    }
    const diagnostics = await lint(createView(source, {cedar: fakeCedar}), 1)

    assert.equal(diagnostics[0].from, 0)
    assert.equal(diagnostics[0].to, source.length)
    assert.equal(diagnostics[0].severity, "warning")
    assert.match(diagnostics[0].message, /^Cedar validation unavailable:/)
    assert.match(diagnostics[0].message, /classification did not match/)
  })

  it("uses the whole document for an unknown validation policy ID", async () => {
    const source = "permit(principal, action, resource);"
    const fakeCedar = {
      policySetTextToParts() {
        return {type: "success", policies: [source], policy_templates: []}
      },
      checkParsePolicySet() {
        return {type: "success"}
      },
      validate() {
        return {
          type: "success",
          validationErrors: [{
            policyId: "unknown",
            error: {
              message: "unknown policy origin",
              help: null,
              severity: "error",
              sourceLocations: [{start: 1, end: 2, label: "bad expression"}],
            },
          }],
        }
      },
    }
    const diagnostics = await lint(
      createView(source, {cedar: fakeCedar, schema: {}}),
      1,
    )

    assert.equal(diagnostics[0].from, 0)
    assert.equal(diagnostics[0].to, source.length)
    assert.equal(diagnostics[0].message, "unknown policy origin: bad expression")
  })

  it("does not crash when Cedar is absent or throws", async () => {
    assert.deepEqual(await lint(createView(validPolicy, {}), 0), [])

    const thrown = await lint(createView(validPolicy, {
      cedar: {
        policySetTextToParts() {
          throw new Error("WASM failed to initialize")
        },
      },
    }), 1)
    assert.equal(thrown[0].severity, "warning")
    assert.match(thrown[0].message, /^Cedar validation unavailable:/)
    assert.match(thrown[0].message, /WASM failed to initialize/)
  })

  it("gives a custom validator precedence over Cedar WASM", async () => {
    let wasmCalls = 0
    const diagnostics = await lint(createView(validPolicy, {
      cedar: {
        checkParsePolicySet() {
          wasmCalls++
          throw new Error("must not run")
        },
      },
      validate(source) {
        assert.equal(source, validPolicy)
        return [{from: 2, to: 8, severity: "warning", message: "server result"}]
      },
    }), 1)

    assert.equal(wasmCalls, 0)
    assert.equal(diagnostics[0].message, "server result")
    assert.equal(diagnostics[0].from, 2)
    assert.equal(diagnostics[0].to, 8)
  })
})

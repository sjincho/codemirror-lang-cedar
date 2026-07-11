import assert from "node:assert/strict"
import {CompletionContext} from "@codemirror/autocomplete"
import {EditorState} from "@codemirror/state"
import {cedarCompletion} from "../dist/index.js"

function context(document, explicit = true, position = document.length) {
  const state = EditorState.create({doc: document})
  return new CompletionContext(state, position, explicit)
}

async function run(source, document, explicit = true) {
  return await source(context(document, explicit))
}

async function runAt(source, document, position, explicit = true) {
  return await source(context(document, explicit, position))
}

function labels(result) {
  assert.ok(result)
  return result.options.map(option => option.label)
}

describe("cedarCompletion", () => {
  it("completes Cedar words without a schema or WASM module", async () => {
    const result = await run(cedarCompletion(), "pri", false)

    assert.ok(result)
    assert.equal(result.from, 0)
    assert.ok(labels(result).includes("principal"))
    assert.ok(labels(result).includes("permit"))
    assert.ok(labels(result).includes("=="))
  })

  it("suppresses keyword completion inside a string literal", async () => {
    const document =
      'permit(principal, action, resource) when { resource.name == "foo'
    const result = await run(cedarCompletion(), document)

    assert.equal(result, null)
  })

  it("adds namespaced entities, actions, and known entity attributes", async () => {
    let conversions = 0
    const schema = "namespace Store { entity User; }"
    const cedar = {
      schemaToJson(received) {
        conversions++
        assert.equal(received, schema)
        return {
          type: "success",
          warnings: [],
          json: {
            Store: {
              commonTypes: {
                Profile: {
                  type: "Record",
                  attributes: {
                    displayName: {type: "String", required: true},
                    nickname: {type: "String", required: false},
                  },
                },
              },
              entityTypes: {
                User: {
                  memberOfTypes: [],
                  shape: {type: "Profile"},
                },
                Document: {
                  memberOfTypes: [],
                  shape: {
                    type: "Record",
                    attributes: {
                      owner: {
                        type: "Entity",
                        name: "Store::User",
                        required: true,
                      },
                    },
                  },
                },
              },
              actions: {},
            },
            "": {
              entityTypes: {},
              actions: {
                view: {
                  appliesTo: {
                    principalTypes: ["Store::User"],
                    resourceTypes: ["Store::Document"],
                    context: {type: "Record", attributes: {}},
                  },
                },
              },
            },
          },
        }
      },
    }
    const source = cedarCompletion({schema, cedar})

    const entity = await run(source, "permit(principal is Sto")
    assert.ok(labels(entity).includes("Store::User"))

    const actionDocument = 'permit(principal, action == Action::"vi'
    const action = await run(source, actionDocument)
    assert.ok(labels(action).includes('Action::"view"'))
    assert.equal(action.from, actionDocument.lastIndexOf('"') + 1)
    const view = action.options.find(option => option.label === 'Action::"view"')
    assert.equal(view.apply, 'view"')

    const closedActionDocument = 'permit(principal, action == Action::"vi", resource)'
    const closedAction = await runAt(
      source,
      closedActionDocument,
      closedActionDocument.indexOf('vi"') + 2,
    )
    assert.equal(closedAction.to, closedActionDocument.indexOf('vi"') + 3)

    const attributeDocument = 'Store::User::"alice".nick'
    const attribute = await run(source, attributeDocument)
    assert.ok(labels(attribute).includes("nickname"))
    assert.equal(attribute.from, attributeDocument.lastIndexOf(".") + 1)

    const inferred = await run(
      source,
      'permit(principal, action == Action::"view", resource) when { principal.nick',
    )
    assert.ok(labels(inferred).includes("nickname"))

    await run(source, "res", false)
    assert.equal(conversions, 1, "a completion source converts its schema once")
  })

  it("keeps keyword completion for malformed converted schema data", async () => {
    const source = cedarCompletion({
      schema: "entity User;",
      cedar: {
        schemaToJson() {
          return {type: "success", warnings: [], json: {unexpected: 42}}
        },
      },
    })

    const result = await run(source, "per", false)
    assert.ok(labels(result).includes("permit"))
  })

  it("keeps keyword completion when schema conversion fails", async () => {
    let conversions = 0
    const source = cedarCompletion({
      schema: "not a schema",
      cedar: {
        schemaToJson() {
          conversions++
          throw new Error("conversion failed")
        },
      },
    })

    const first = await run(source, "for", false)
    const second = await run(source, "pri", false)
    assert.ok(labels(first).includes("forbid"))
    assert.ok(labels(second).includes("principal"))
    assert.equal(conversions, 1)
  })

  it("returns null for idle implicit completion", async () => {
    assert.equal(await run(cedarCompletion(), "", false), null)
  })
})

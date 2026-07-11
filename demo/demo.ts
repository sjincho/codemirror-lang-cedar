import {autocompletion, completionKeymap} from "@codemirror/autocomplete"
import {defaultKeymap, history, historyKeymap} from "@codemirror/commands"
import {syntaxHighlighting} from "@codemirror/language"
import {lintGutter, lintKeymap} from "@codemirror/lint"
import {EditorState} from "@codemirror/state"
import {EditorView, keymap, lineNumbers} from "@codemirror/view"
import initCedarWasm, * as cedarWasm from "@cedar-policy/cedar-wasm/web"
import {
  cedar,
  cedarCompletion,
  cedarHighlightStyle,
  cedarLinter,
} from "../src/index.js"

const schema: cedarWasm.Schema = `
namespace Demo {
  entity Role;

  entity Datasource {
    classification: String,
    ownerTeam: String
  };

  action "query" appliesTo {
    principal: [Role],
    resource: [Datasource],
    context: {
      ticket: String,
      readOnly: Bool
    }
  };
}
`

const policy = `permit (
  principal in Demo::Role::"data-analyst",
  action == Demo::Action::"query",
  resource is Demo::Datasource
)
when {
  resource.classification == "internal" &&
  context.readOnly &&
  context.ticket != ""
};
`

await initCedarWasm({
  module_or_path: new URL(
    "../node_modules/@cedar-policy/cedar-wasm/web/cedar_wasm_bg.wasm",
    import.meta.url,
  ),
})

// The adapter receives initialized methods only, so it never invokes `default` again.
const cedarMethods = {
  policySetTextToParts: cedarWasm.policySetTextToParts,
  checkParsePolicySet: cedarWasm.checkParsePolicySet,
  schemaToJson: cedarWasm.schemaToJson,
  validate: cedarWasm.validate,
}

const parent = document.querySelector<HTMLElement>("#editor")
if (!parent) throw new Error("Missing #editor mount")

const theme = EditorView.theme({
  "&": {
    height: "100%",
    color: "#182126",
    backgroundColor: "#ffffff",
    fontSize: "15px",
  },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily:
      '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
    lineHeight: "1.65",
  },
  ".cm-content": {padding: "20px 0"},
  ".cm-line": {padding: "0 22px"},
  ".cm-gutters": {
    color: "#829096",
    backgroundColor: "#f6f8f7",
    borderRight: "1px solid #dce3df",
  },
  ".cm-activeLine": {backgroundColor: "#f1f8f5"},
  ".cm-activeLineGutter": {backgroundColor: "#e6f2ed"},
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "#cfe7dc",
  },
  ".cm-tooltip": {
    border: "1px solid #c9d5cf",
    borderRadius: "8px",
    boxShadow: "0 12px 30px rgba(20, 47, 36, 0.14)",
    overflow: "hidden",
  },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "#176b50",
    color: "white",
  },
  "&.cm-focused": {outline: "none"},
})

const state = EditorState.create({
  doc: policy,
  extensions: [
    lineNumbers(),
    history(),
    lintGutter(),
    keymap.of([
      ...defaultKeymap,
      ...historyKeymap,
      ...completionKeymap,
      ...lintKeymap,
    ]),
    cedar(),
    syntaxHighlighting(cedarHighlightStyle),
    cedarLinter({cedar: cedarMethods, schema}),
    autocompletion({
      override: [cedarCompletion({cedar: cedarMethods, schema})],
    }),
    theme,
    EditorView.lineWrapping,
  ],
})

new EditorView({state, parent})

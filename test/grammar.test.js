import assert from "node:assert/strict"
import {fileTests} from "@lezer/generator/dist/test"
import {cedarLanguage} from "../dist/index.js"
import * as fs from "node:fs"
import * as path from "node:path"
import {fileURLToPath} from "node:url"

const caseDir = path.dirname(fileURLToPath(import.meta.url))

for (const file of ["policies.txt", "expressions.txt"]) {
  const suiteName = path.basename(file, ".txt")
  describe(suiteName, () => {
    const contents = fs.readFileSync(path.join(caseDir, file), "utf8")
    for (const {name, run} of fileTests(contents, file)) {
      it(name, () => run(cedarLanguage.parser))
    }
  })
}

function syntaxErrors(source) {
  let count = 0
  cedarLanguage.parser.parse(source).iterate({
    enter(node) {
      if (node.type.isError) count++
    },
  })
  return count
}

describe("Cedar syntax coverage", () => {
  it("accepts empty and trailing-comma collection forms", () => {
    const source = `
      permit(principal, action in [], resource);
      permit(principal, action in [Action::"read",], resource) when {
        [{name: "alice",},]
      };
    `
    assert.equal(syntaxErrors(source), 0)
  })

  it("rejects string literals after member-access dots", () => {
    const source = `permit(principal, action, resource) when {
      principal."name" == "alice"
    };`
    assert.ok(syntaxErrors(source) > 0)
  })
})

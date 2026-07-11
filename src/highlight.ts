import {HighlightStyle} from "@codemirror/language"
import {tags as t} from "@lezer/highlight"

/** An optional, standalone color scheme for Cedar syntax. */
export const cedarHighlightStyle = HighlightStyle.define([
  {tag: [t.keyword, t.controlKeyword], color: "#7c3aed", fontWeight: "600"},
  {tag: t.bool, color: "#7c3aed"},
  {tag: t.special(t.variableName), color: "#0369a1"},
  {tag: t.variableName, color: "#334155"},
  {tag: t.typeName, color: "#b45309"},
  {tag: t.function(t.variableName), color: "#2563eb"},
  {tag: t.propertyName, color: "#0f766e"},
  {tag: [t.string, t.special(t.string)], color: "#15803d"},
  {tag: [t.integer, t.number], color: "#c2410c"},
  {tag: t.operator, color: "#475569"},
  {tag: [t.meta, t.attributeName], color: "#9333ea"},
  {tag: t.lineComment, color: "#6b7280", fontStyle: "italic"},
  {tag: t.invalid, color: "#b91c1c", textDecoration: "underline"},
])

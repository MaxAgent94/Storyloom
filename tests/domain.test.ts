import test from "node:test";
import assert from "node:assert/strict";
import {
  makeProject,
  makeNode,
  contextText,
  sources,
  validateProject,
  exportMarkdown,
  promptMessages,
} from "../lib/domain.ts";
test("context stays explicit, follows ancestry, and does not leak another book", () => {
  const p = makeProject("Series");
  const book = makeNode("book", p.id, "One"),
    other = makeNode("book", p.id, "Two"),
    chapter = makeNode("chapter", book.id, "Chapter"),
    scene = makeNode("scene", chapter.id, "Scene");
  p.nodes.push(book, other, chapter, scene);
  book.sections.outline = "Outline A";
  other.sections.outline = "Secret B";
  scene.sections.notes = "Maybe kill him";
  p.nodes[0].sections.canon = "No flight";
  assert.equal(sources(p, scene).length, 3);
  assert.equal(contextText(p, scene, []), "");
  const context = contextText(p, scene, [
    `${book.id}:outline`,
    `${other.id}:outline`,
  ]);
  assert.match(context, /Outline A/);
  assert.doesNotMatch(context, /Secret B|Maybe kill him|No flight/);
});
test("invalid hierarchy and duplicate IDs are rejected", () => {
  const p = makeProject("Book");
  assert.ok(validateProject(p));
  p.nodes.push(makeNode("scene", p.id, "Bad parent"));
  assert.equal(validateProject(p), false);
  p.nodes.pop();
  p.nodes.push(p.nodes[0]);
  assert.equal(validateProject(p), false);
});
test("export scopes a chapter and preserves Markdown verbatim", () => {
  const p = makeProject("Series"),
    b = makeNode("book", p.id, "Book"),
    c = makeNode("chapter", b.id, "Chapter"),
    s = makeNode("scene", c.id, "Scene"),
    other = makeNode("chapter", b.id, "Other");
  p.nodes.push(b, c, s, other);
  s.sections.manuscript = "“Keep this.”\n\n*Exactly.*";
  other.sections.notes = "Excluded";
  const result = exportMarkdown(p, c.id);
  assert.match(result, /“Keep this.”\n\n\*Exactly\.\*/);
  assert.doesNotMatch(result, /Excluded/);
});
test("prompt has explicit system boundary and deterministic order", () => {
  const m = promptMessages(
    "Canon",
    [{ role: "user", content: "Decision" }],
    "Expand",
  );
  assert.equal(m[0].role, "system");
  assert.match(m[1].content, /<story-context>/);
  assert.equal(m[2].content, "Decision");
  assert.equal(m[3].content, "Expand");
});

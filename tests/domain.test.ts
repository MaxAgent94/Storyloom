import test from "node:test";
import assert from "node:assert/strict";
import {
  makeProject,
  makeNode,
  contextText,
  MAX_MANUSCRIPT_CONTEXT_WORDS,
  recentWords,
  sources,
  validateProject,
  exportMarkdown,
  promptMessages,
  removeNode,
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
test("manuscript context includes only the configured recent words", () => {
  const p = makeProject("Series"), book = makeNode("book", p.id, "Book");
  p.nodes.push(book);
  book.sections.manuscript = "one two three four five six";
  const context = contextText(p, book, [`${book.id}:manuscript`], 3);
  assert.match(context, /most recent 3 words maximum/);
  assert.match(context, /four five six$/);
  assert.doesNotMatch(context, /one two three/);
  assert.equal(MAX_MANUSCRIPT_CONTEXT_WORDS, 20000);
  const oversized = Array.from({ length: 20001 }, (_, i) => `word${i}`).join(" ");
  const capped = recentWords(oversized, 50000);
  assert.equal(capped.split(/\s+/).length, 20000);
  assert.ok(capped.startsWith("word1 "));
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
test("deleting a book removes its descendants and proposals without touching siblings", () => {
  const p = makeProject("Series"),
    book = makeNode("book", p.id, "Delete me"),
    keep = makeNode("book", p.id, "Keep me"),
    chapter = makeNode("chapter", book.id, "Chapter"),
    scene = makeNode("scene", chapter.id, "Scene");
  p.nodes.push(book, keep, chapter, scene);
  p.proposals.push({
    id: crypto.randomUUID(),
    nodeId: scene.id,
    section: "manuscript",
    previous: "",
    output: "Draft",
    model: "model",
    preset: "writing",
    instruction: "Write",
    at: new Date().toISOString(),
    context: "",
    status: "pending",
  });
  const result = removeNode(p, book.id);
  assert.deepEqual(result.nodes.map((node) => node.title), ["Series", "Keep me"]);
  assert.equal(result.proposals.length, 0);
  assert.throws(() => removeNode(p, p.id));
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

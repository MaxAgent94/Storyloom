import { makeNode, type Project, type Node } from './domain.ts';
export type ChapterPlan = { title: string; summary: string; scenes: { title: string; summary: string }[] };
export function parseStructure(text: string): ChapterPlan[] | null {
  const chapters: ChapterPlan[] = [];
  let scene: ChapterPlan['scenes'][number] | undefined;
  let fenced = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const chapter = line.match(/^##\s+(Chapter\b.*)/i);
    const heading = line.match(/^###\s+(Scene\b.*)/i);
    if (chapter) { chapters.push({ title: chapter[1].trim(), summary: '', scenes: [] }); scene = undefined; }
    else if (heading) {
      if (!chapters.length) return null;
      scene = { title: heading[1].trim(), summary: '' }; chapters.at(-1)!.scenes.push(scene);
    } else if (chapters.length) {
      const target = scene || chapters.at(-1)!;
      target.summary = `${target.summary}\n${line}`.trim();
    } else if (line.trim() && !/^#\s/.test(line)) return null;
  }
  return chapters.length && chapters.every(c => c.scenes.length) ? chapters : null;
}
export function validStructure(value: unknown): value is ChapterPlan[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 200 && value.every(c =>
    c && typeof c.title === 'string' && c.title.trim() && typeof c.summary === 'string' &&
    Array.isArray(c.scenes) && c.scenes.length > 0 && c.scenes.length <= 200 &&
    c.scenes.every((s: {title?: unknown; summary?: unknown}) => s && typeof s.title === 'string' && s.title.trim() && typeof s.summary === 'string'));
}
export function structureSources(p: Project, book: Node, selected: string[]) {
  return [`${book.id}:synopsis`, `${book.id}:outline`, ...['canon', 'research'].map(k => `${p.id}:${k}`).filter(id => selected.includes(id))];
}
export const structureInstruction = 'Propose chapters and scenes from this book outline. Preserve story decisions and relevant outline material in scene summaries. Do not write beats or manuscript. Return ONLY JSON: an array of {"title":"Chapter title","summary":"Chapter intent","scenes":[{"title":"Scene title","summary":"Scene synopsis / intent"}]}. Every chapter must contain at least one scene. No Markdown fences.';
export function materialize(p: Project, bookId: string, plan: ChapterPlan[], alternative: boolean) {
  if (!validStructure(plan)) throw new Error('Give every chapter and scene a title and every chapter at least one scene.');
  const book = p.nodes.find(n => n.id === bookId && n.kind === 'book' && !n.archived);
  if (!book) throw new Error('The source book is no longer available.');
  const nodes = [...p.nodes];
  let target = book;
  if (alternative) { target = {...makeNode('book', book.parent, `${book.title} — alternative`), sections: {...book.sections}}; nodes.push(target); }
  let firstScene = '';
  for (const c of plan) {
    const chapter = makeNode('chapter', target.id, c.title.trim());
    chapter.sections.outline = c.summary; nodes.push(chapter);
    for (const s of c.scenes) { const scene = makeNode('scene', chapter.id, s.title.trim()); scene.sections.synopsis = s.summary; nodes.push(scene); firstScene ||= scene.id; }
  }
  if (nodes.length > 5000) throw new Error('This structure exceeds the project node limit.');
  return { project: {...p, nodes}, firstScene };
}

"use client";
import { useEffect, useRef, useState } from "react";
import { api, configured, supabase } from "@/lib/browser";
import StructureReview from './structure-review';
import BookBeats from './book-beats';
import { parseStructure, validStructure, structureSources, structureInstruction, materialize, type ChapterPlan } from '@/lib/structure';
import {
  ancestry,
  contextText,
  defaultPresets,
  descendants,
  exportMarkdown,
  fields,
  labels,
  makeNode,
  makeProject,
  promptMessages,
  removeNode,
  sources,
  validateProject,
  type Kind,
  type Node,
  type Preset,
  type Project,
  type Proposal,
} from "@/lib/domain";
type Generation = {
  id: string;
  output: string;
  context: string;
  model: string;
  at: string;
  nodeId: string;
  section: string;
  instruction: string;
  preset: string;
  previous: string;
  action: string;
};
type Row = { id: string; title: string; revision: number };
type Version = {
  id: string;
  content: string;
  created_at: string;
  metadata: Record<string, unknown>;
};
type Model = {
  id: string;
  name: string;
  context_length: number;
  pricing: { prompt: string; completion: string };
};
function download(name: string, text: string, type = "text/markdown") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name.replace(/[^a-zA-Z0-9._ -]/g, "_");
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function Workspace() {
  const [structure, setStructure] = useState<{plan: ChapterPlan[]; bookId: string; projectId: string; outline: string; origin: string; generation?: string} | null>(null);
  const [signed, setSigned] = useState(false),
    [checking, setChecking] = useState(true),
    [demo, setDemo] = useState(false);
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState("");
  const [rows, setRows] = useState<Row[]>([]),
    [project, setProject] = useState<Project | null>(null),
    [selected, setSelected] = useState(""),
    [section, setSection] = useState("synopsis");
  const [status, setStatus] = useState(""),
    [error, setError] = useState(""),
    [left, setLeft] = useState(false),
    [right, setRight] = useState(false),
    [focus, setFocus] = useState(false);
  const [panel, setPanel] = useState("chat"),
    [modal, setModal] = useState(""),
    [menu, setMenu] = useState(false),
    [archived, setArchived] = useState(false);
  const [guidance, setGuidance] = useState(""),
    [selectedSources, setSelectedSources] = useState<string[]>([]),
    [includeChat, setIncludeChat] = useState(true),
    [presetId, setPresetId] = useState("economy");
  const [models, setModels] = useState<Model[]>([]),
    [key, setKey] = useState(""),
    [hasKey, setHasKey] = useState(false),
    [busy, setBusy] = useState(false),
    [versions, setVersions] = useState<Version[]>([]),
    [historyText, setHistoryText] = useState<string | null>(null);
  const [proposalId, setProposalId] = useState(""),
    [proposalText, setProposalText] = useState(""),
    [sceneInput, setSceneInput] = useState(""),
    [generations, setGenerations] = useState<Generation[]>([]);
  const [inputDialog, setInputDialog] = useState<{
    title: string;
    value: string;
    action: (value: string) => void;
  } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    description: string;
    action: () => void | Promise<void>;
  } | null>(null);
  const knownSources = useRef<string[]>([]);
  const current = useRef<Project | null>(null),
    revision = useRef(0),
    dirty = useRef(false),
    saving = useRef<Promise<boolean> | null>(null),
    demoRef = useRef(false),
    meta = useRef<Record<string, unknown>>({ action: "manual" }),
    editor = useRef<HTMLTextAreaElement>(null),
    importer = useRef<HTMLInputElement>(null);
  const node = project?.nodes.find((n) => n.id === selected),
    preset =
      project?.presets.find((p) => p.id === presetId) || defaultPresets[0];
  const available = project && node ? sources(project, node) : [];
  const context =
    project && node ? contextText(project, node, selectedSources) : "";
  const pending =
    project?.proposals.filter((p) => p.status === "pending") || [];
  const activeProposal = project?.proposals.find((p) => p.id === proposalId);
  function alertError(e: unknown) {
    setError(
      e instanceof Error
        ? e.message
        : "Something went wrong. Your draft remains open.",
    );
  }
  function change(
    p: Project,
    m: Record<string, unknown> = { action: "manual" },
  ) {
    current.current = p;
    setProject(p);
    dirty.current = true;
    meta.current = m;
    setStatus(demoRef.current ? "Preview · not saved" : "Unsaved changes");
  }
  function textChange(value: string) {
    const p = current.current;
    if (!p || !node) return;
    change({
      ...p,
      nodes: p.nodes.map((n) =>
        n.id === node.id
          ? { ...n, sections: { ...n.sections, [section]: value } }
          : n,
      ),
    });
  }
  async function save(): Promise<boolean> {
    if (saving.current) {
      if (!(await saving.current)) return false;
      if (dirty.current) return save();
      return true;
    }
    if (!dirty.current || !current.current) return true;
    if (demoRef.current) {
      setStatus("Preview · not saved");
      return true;
    }
    const snapshot = current.current,
      metadata = meta.current;
    const run = (async () => {
      setStatus("Saving…");
      try {
        const result = await api("projects", {
          project: snapshot,
          revision: revision.current,
          meta: metadata,
        });
        revision.current = result.revision;
        if (current.current === snapshot) {
          dirty.current = false;
          setStatus("Saved to cloud");
        } else setStatus("Unsaved changes");
        setRows((r) => [
          {
            id: snapshot.id,
            title: snapshot.title,
            revision: revision.current,
          },
          ...r.filter((x) => x.id !== snapshot.id),
        ]);
        return true;
      } catch (e) {
        setStatus("Not saved");
        alertError(e);
        return false;
      }
    })();
    saving.current = run;
    const ok = await run;
    saving.current = null;
    if (ok && dirty.current && !demoRef.current) return save();
    return ok;
  }
  useEffect(() => {
    if (!supabase) {
      setChecking(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSigned(!!data.session);
      setChecking(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, s) =>
      setSigned(!!s),
    );
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!signed) return;
    api("projects").then(setRows).catch(alertError);
    api("settings")
      .then((x) => setHasKey(x.hasKey))
      .catch(alertError);
    api("models").then(setModels).catch(alertError);
  }, [signed]);
  useEffect(() => {
    if (!project) return;
    const timer = setTimeout(() => {
      void save();
    }, 1200);
    return () => clearTimeout(timer);
  }, [project]); // autosave only after idle; save serializes in-flight requests
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (dirty.current && !demoRef.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);
  useEffect(() => {
    if (!project || !node) return;
    const all = sources(project, node);
    knownSources.current = all.map((s) => s.id);
    setSelectedSources(
      all.filter((s) => preset.contextKeys.includes(s.key)).map((s) => s.id),
    );
  }, [selected, presetId]);
  useEffect(() => {
    const ids = available.map((s) => s.id),
      added = available
        .filter(
          (s) =>
            !knownSources.current.includes(s.id) &&
            preset.contextKeys.includes(s.key),
        )
        .map((s) => s.id);
    knownSources.current = ids;
    setSelectedSources((prev) => [
      ...prev.filter((id) => ids.includes(id)),
      ...added,
    ]);
  }, [available.map((s) => s.id).join("|")]);
  useEffect(() => {
    function keyboard(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        void save();
      }
      if (e.key === "Escape") {
        setModal("");
        setInputDialog(null);
        setConfirmDialog(null);
        setLeft(false);
        setRight(false);
      }
    }
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, []);
  async function openProject(id: string) {
    if (busy) return;
    if (!(await save())) return;
    try {
      const row = await api(`projects?id=${id}`);
      current.current = row.body;
      revision.current = row.revision;
      dirty.current = false;
      setProject(row.body);
      selectNode(row.body.nodes.find((n: Node)=>n.kind==='book'&&!n.archived) || row.body.nodes[0]);
      setStatus("Saved to cloud");
    } catch (e) {
      alertError(e);
    }
  }
  function selectNode(n: Node) {
    setSelected(n.id);
    setSection(fields[n.kind][0]);
    setMenu(false);
    setLeft(false);
    setProposalId("");
  }
  function ask(title: string, value: string, action: (value: string) => void) {
    setInputDialog({ title, value, action });
  }
  async function newProject(title: string) {
    if (!(await save())) return;
    const p = makeProject(title);
    revision.current = 0;
    change(p);
    selectNode(p.nodes[0]);
  }
  function addNode() {
    if (!project || !node) return;
    const kind = node.kind === 'book' ? 'book' : (
      { project: "book", book: "chapter", chapter: "scene" } as Record<
        string,
        Kind
      >
    )[node.kind];
    if (!kind) return;
    ask(`New ${kind}`, "", (title) => {
      const n = makeNode(kind, kind==='book' ? project.id : node.id, title);
      change({ ...current.current!, nodes: [...current.current!.nodes, n] });
      selectNode(n);
    });
  }
  function updatePreset(values: Partial<Preset>) {
    if (!project) return;
    change({
      ...project,
      presets: project.presets.map((p) =>
        p.id === preset.id ? { ...p, ...values } : p,
      ),
    });
  }
  function reorder(delta: number) {
    if (!project || !node) return;
    const siblings = project.nodes.filter((n) => n.parent === node.parent);
    const next = siblings[siblings.findIndex((n) => n.id === node.id) + delta];
    if (!next) return;
    const nodes = [...project.nodes],
      a = nodes.indexOf(node),
      b = nodes.indexOf(next);
    [nodes[a], nodes[b]] = [nodes[b], nodes[a]];
    change({ ...project, nodes });
  }
  function duplicate() {
    if (!project || !node) return;
    if (node.kind === "project") {
      const p = structuredClone(project),
        ids = new Map(p.nodes.map((n) => [n.id, crypto.randomUUID()]));
      p.nodes = p.nodes.map((n) => ({
        ...n,
        id: ids.get(n.id)!,
        parent: n.parent ? ids.get(n.parent)! : null,
      }));
      p.id = p.nodes[0].id;
      p.title += " (copy)";
      p.nodes[0].title = p.title;
      p.proposals = [];
      revision.current = 0;
      change(p);
      selectNode(p.nodes[0]);
      return;
    }
    const ids = descendants(project, node.id),
      map = new Map([...ids].map((id) => [id, crypto.randomUUID()]));
    const copies = project.nodes
      .filter((n) => ids.has(n.id))
      .map((n) => ({
        ...structuredClone(n),
        id: map.get(n.id)!,
        parent: map.get(n.parent || "") || n.parent,
        title: n.id === node.id ? `${n.title} (copy)` : n.title,
      }));
    change({ ...project, nodes: [...project.nodes, ...copies] });
    selectNode(copies[0]);
  }
  function clearConversation() {
    const p = current.current;
    if (!p) return;
    change(
      { ...p, messages: [] },
      { action: "clear-conversation" },
    );
  }
  function deleteNode() {
    const p = current.current;
    if (!p || !node || node.kind === "project") return;
    const root = p.nodes[0];
    change(
      removeNode(p, node.id),
      { action: "delete-node", kind: node.kind, title: node.title },
    );
    selectNode(root);
  }
  async function deleteProject() {
    const p = current.current;
    if (!p || demo) return;
    try {
      await api(`projects?id=${p.id}`, undefined, "DELETE");
      setRows((existing) => existing.filter((row) => row.id !== p.id));
      current.current = null;
      revision.current = 0;
      dirty.current = false;
      setProject(null);
      setSelected("");
      setStatus("Project deleted");
      setMenu(false);
    } catch (e) {
      alertError(e);
    }
  }
  async function history() {
    if (!(await save())) return;
    setHistoryText(null);
    setModal("history");
    if (demo) return setVersions([]);
    try {
      setVersions(
        await api(
          `history?project=${project!.id}&node=${selected}&section=${section}`,
        ),
      );
    } catch (e) {
      alertError(e);
    }
  }
  function openScenes() {
    const e = editor.current;
    setSceneInput(
      e && e.selectionEnd > e.selectionStart
        ? e.value.slice(e.selectionStart, e.selectionEnd)
        : node?.sections[section] || "",
    );
    setModal("scenes");
  }
  function createScenes() {
    if (!project || !node) return;
    let parent =
      node.kind === "chapter"
        ? node.id
        : ancestry(project, node).find((n) => n.kind === "chapter")?.id;
    let nodes = [...project.nodes];
    if (!parent) {
      const book = ancestry(project, node).find((n) => n.kind === "book");
      if (!book) {
        setError("Create or select a book before adding scenes.");
        return;
      }
      const chapter = makeNode("chapter", book.id, "New chapter");
      nodes.push(chapter);
      parent = chapter.id;
    }
    const chunks = sceneInput
      .split(/\n(?=###?\s)/)
      .map((x) => x.trim())
      .filter(Boolean);
    const newScenes = chunks.map((chunk, i) => {
      const lines = chunk.split("\n"),
        heading = /^#{1,3}\s+/.test(lines[0]);
      const scene = makeNode(
        "scene",
        parent!,
        heading ? lines[0].replace(/^#+\s*/, "") : `Scene ${i + 1}`,
      );
      scene.sections.synopsis = heading
        ? lines.slice(1).join("\n").trim()
        : chunk;
      return scene;
    });
    if (!newScenes.length) return;
    change({ ...project, nodes: [...nodes, ...newScenes] });
    selectNode(newScenes[0]);
    setModal("");
  }
  async function openStructure() {
    if (!project || node?.kind !== 'book' || busy) return;
    const outline = node.sections.outline || '';
    if (!outline.trim()) { setError('Write or generate a Book outline first.'); return; }
    const base = {bookId: node.id, projectId: project.id, outline};
    const parsed = parseStructure(outline);
    if (parsed) { setStructure({...base, plan: parsed, origin: 'Parsed locally · no API tokens used'}); return; }
    if (demo || !preset.model) { setError('This outline needs AI interpretation. Sign in and choose a model, or use ## Chapter / ### Scene headings.'); setPanel('model'); setRight(true); return; }
    if (!(await save())) return;
    setBusy(true);
    try {
      const result = await api('ai', {projectId: project.id, revision: revision.current, nodeId: node.id,
        sources: structureSources(project,node,selectedSources), includeChat:false, instruction:structureInstruction,
        model:preset.model, temperature:preset.temperature, maxTokens:preset.maxTokens, section:'outline', preset:preset.name, action:'structure'});
      const plan: unknown = JSON.parse(result.output.trim().replace(/^```(?:json)?\s*|\s*```$/g,''));
      if (!validStructure(plan)) throw new Error('The model returned an invalid hierarchy. Nothing was created. Try again or use chapter/scene headings.');
      if (current.current?.id !== base.projectId) return;
      setStructure({...base, plan, origin:`Proposed by AI · ${result.model} · ${preset.name}`,generation:result.id});
      if (!result.checkpointSaved) setError('The AI checkpoint could not be saved. Keep this review open until approval saves successfully.');
    } catch(e) { alertError(e); } finally { setBusy(false); }
  }
  async function approveStructure(plan: ChapterPlan[], alternative: boolean) {
    if (!structure) return;
    try {
      if (!(await save())) return;
      const p = current.current;
      if (!p || p.id !== structure.projectId || p.nodes.find(n=>n.id===structure.bookId)?.sections.outline !== structure.outline)
        throw new Error('The source outline changed. Cancel and propose structure again.');
      const result = materialize(p,structure.bookId,plan,alternative);
      change(result.project,{action:'create-structure',origin:structure.origin,generationId:structure.generation,sourceOutline:structure.outline,reviewedStructure:plan});
      setStructure(null); setSelected(result.firstScene); setSection('synopsis');
      await save();
    } catch(e) { alertError(e); }
  }
  async function generate(action: string, beat = '') {
    if (!project || !node || busy) return;
    if (demo) {
      setError(
        "AI requests are disabled in the unsaved preview. Configure the cloud workspace and sign in to use OpenRouter.",
      );
      return;
    }
    if (!preset.model) {
      setPanel("model");
      setRight(true);
      setError("Choose an OpenRouter model first.");
      return;
    }
    if (!(await save())) return;
    const p = current.current!,
      target = node.id,
      targetSection =
        action === 'prose' ? 'manuscript' : action === 'sceneBeats' ? 'sceneBeats' : action === "outline"
          ? "outline"
          : action === "beats"
            ? "beats"
            : action === "detailedBeats"
              ? "detailedBeats"
              : action === "scenePlan"
                ? "scenePlan"
                : section;
    const prose = node.sections.manuscript || '';
    const start = section === 'manuscript' ? editor.current?.selectionStart ?? prose.length : prose.length;
    const end = section === 'manuscript' ? editor.current?.selectionEnd ?? start : start;
    const instruction = action === 'prose'
      ? `Write only the prose to insert at the indicated cursor, or replace the selected passage. Preserve the writer's instructions and supplied dialogue. ${beat ? `Render this scene beat as prose: ${beat}` : guidance}\nBefore cursor:\n${prose.slice(Math.max(0,start-16000),start)}\nSelected passage:\n${prose.slice(start,end)}\nAfter cursor:\n${prose.slice(end,end+4000)}`
      : action === 'sceneBeats' ? `Turn the Book outline into editable scene beats. Use a ## Scene title heading for every planning unit, followed by what should happen. Do not write prose. ${guidance}` :
      action === "chat"
        ? guidance
        : `${action === "revise" ? "Revise" : action === "fromChat" ? "Convert the decisions in our conversation into" : "Generate"} ${labels[targetSection] || targetSection} for ${node.title}. Return only the proposed section as editable Markdown. Preserve the writer’s decisions. ${guidance}`;
    if (!instruction.trim()) return;
    setBusy(true);
    setError("");
    try {
      const result = await api("ai", {
        projectId: p.id,
        revision: revision.current,
        nodeId: target,
        sources: Array.from(new Set([...selectedSources, ...(node.kind === 'book' && ['outline','sceneBeats','prose'].includes(action) ? [`${node.id}:synopsis`, ...(action !== 'outline' ? [`${node.id}:outline`] : [])] : [])])),
        includeChat: action === 'chat' || action === 'fromChat' ? includeChat : false,
        instruction,
        model: preset.model,
        temperature: preset.temperature,
        maxTokens: preset.maxTokens,
        section: targetSection,
        preset: preset.name,
        action,
        ...(action === 'prose' ? {insertion:{start,end}} : {}),
      });
      const latest = current.current!;
      const at = result.at;
      const messages = [
        ...latest.messages,
        {
          id: crypto.randomUUID(),
          role: "user" as const,
          content: instruction,
          at,
        },
        {
          id: crypto.randomUUID(),
          role: "assistant" as const,
          content: result.output,
          at,
          model: result.model,
        },
      ];
      const proposal: Proposal = {
        id: result.id,
        nodeId: target,
        section: targetSection,
        previous:
          p.nodes.find((n) => n.id === target)?.sections[targetSection] || "",
        output: result.output,
        model: result.model,
        preset: preset.name,
        instruction,
        at,
        context: result.context,
        status: "pending",
      };
      change(
        {
          ...latest,
          messages,
          proposals:
            action === "chat"
              ? latest.proposals
              : [...latest.proposals, proposal],
        },
        {
          action: "generation",
          model: result.model,
          preset: preset.name,
          instruction,
          generationId: result.generationId,
          usage: result.usage,
        },
      );
      if (action !== "chat") {
        if (action === 'prose') setSection('manuscript');
        setProposalId(proposal.id);
        setProposalText(proposal.output);
        setModal("proposal");
      }
      setGuidance("");
      if (!result.checkpointSaved)
        setError(
          "The response arrived, but its server checkpoint failed. Keep this tab open until the project saves.",
        );
      await save();
    } catch (e) {
      alertError(e);
    } finally {
      setBusy(false);
    }
  }
  function applyProposal(branch = false) {
    if (!project || !activeProposal) return;
    const n = project.nodes.find((n) => n.id === activeProposal.nodeId);
    if (!n) return;
    const latest = n.sections[activeProposal.section] || "";
    if (!branch && latest !== activeProposal.previous) {
      setError(
        "This section changed since generation. Keep your current text and use “Save as scene copy,” or copy the proposal into your editor.",
      );
      return;
    }
    let nodes = project.nodes;
    if (branch) {
      if (n.kind === "project") {
        setError(
          "Duplicate the project first to branch project-level material.",
        );
        return;
      }
      const clone = {
        ...structuredClone(n),
        id: crypto.randomUUID(),
        title: `${n.title} — alternative`,
        sections: { ...n.sections, [activeProposal.section]: proposalText },
      };
      nodes = [...nodes, clone];
      selectNode(clone);
    } else {
      nodes = nodes.map((x) =>
        x.id === n.id
          ? {
              ...x,
              sections: {
                ...x.sections,
                [activeProposal.section]: proposalText,
              },
            }
          : x,
      );
      setSelected(n.id);
      setSection(activeProposal.section);
    }
    change(
      {
        ...project,
        nodes,
        proposals: project.proposals.map((p) =>
          p.id === activeProposal.id ? { ...p, status: "accepted" } : p,
        ),
      },
      {
        action: branch ? "branch" : "ai-apply",
        model: activeProposal.model,
        preset: activeProposal.preset,
        instruction: activeProposal.instruction,
        proposalId: activeProposal.id,
        originalOutput: activeProposal.output,
      },
    );
    setModal("");
  }
  async function importFile(file: File) {
    try {
      const text = await file.text();
      if (file.name.endsWith(".json")) {
        const p = JSON.parse(text);
        if (!validateProject(p))
          throw new Error("This is not a valid Storyloom backup.");
        if (!(await save())) return;
        const ids = new Map(p.nodes.map((n) => [n.id, crypto.randomUUID()]));
        const copy: Project = {
          ...p,
          id: ids.get(p.id)!,
          title: `${p.title} (imported)`,
          nodes: p.nodes.map((n) => ({
            ...n,
            id: ids.get(n.id)!,
            parent: n.parent ? ids.get(n.parent)! : null,
          })),
          proposals: p.proposals.map((v) => ({
            ...v,
            id: crypto.randomUUID(),
            nodeId: ids.get(v.nodeId) || v.nodeId,
          })),
        };
        copy.nodes[0].title = copy.title;
        revision.current = 0;
        change(copy, { action: "import" });
        selectNode(copy.nodes[0]);
      } else {
        if (!node) throw new Error("Select a section first.");
        setConfirmDialog({
          title: "Import Markdown into this section?",
          description: "The existing text will remain in version history.",
          action: () => textChange(text),
        });
      }
    } catch (e) {
      alertError(e);
    }
  }
  function preview() {
    const p = makeProject("Untitled project"),
      b = makeNode("book", p.id, "Book one");
    p.nodes.push(b);
    demoRef.current = true;
    setDemo(true);
    current.current = p;
    setProject(p);
    selectNode(b);
    setStatus("Preview · not saved");
  }
  if (checking)
    return (
      <main className="gate">
        <p>Opening your writing room…</p>
      </main>
    );
  if (!signed && !demo)
    return (
      <main className="gate">
        <div className="login">
          <div className="brand">
            Storyloom<span>WRITING ROOM</span>
          </div>
          <h1>
            A little room
            <br />
            for a big story.
          </h1>
          {configured ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setError("");
                const { error } = await supabase!.auth.signInWithPassword({
                  email,
                  password,
                });
                setPassword("");
                if (error) alertError(error);
              }}
            >
              <p>Sign in to your private writing room.</p>
              <label>
                Email
                <input
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </label>
              <button className="primary">Open writing room</button>
            </form>
          ) : (
            <>
              <p>
                This writing room is ready for cloud setup. Project storage and
                sign-in have not been connected yet.
              </p>
              <button onClick={preview}>Explore the unsaved interface</button>
            </>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <small>No encyclopedia required. Start with what you know.</small>
        </div>
      </main>
    );
  return (
    <div className={`app ${focus ? "focus" : ""}`}>
      <header className="topbar">
        <button
          className="nav-toggle"
          onClick={() => setLeft(!left)}
          aria-label="Toggle project navigation"
        >
          ☰
        </button>
        <div className="brand">Storyloom</div>
        <span className="top-project">
          {project?.title || "Your writing room"}
        </span>
        <span className="save-status" role="status">
          {status}
        </span>
        <button disabled={!project || busy} onClick={() => setFocus(!focus)}>
          {focus ? "Leave focus" : "Focus"}
        </button>
        <button
          onClick={() => {
            setModal("settings");
            if (signed && !demo)
              api("settings")
                .then((x) => setHasKey(x.hasKey))
                .catch(alertError);
          }}
        >
          Settings
        </button>
        <button className="ai-toggle" onClick={() => setRight(!right)}>
          Writing partner
        </button>
      </header>
      {demo && (
        <div className="preview-banner">
          Unsaved interface preview · Cloud storage and AI are not connected.
        </div>
      )}
      {error && (
        <div role="alert" className="error-banner">
          <span>{error}</span>
          {project && (
            <button
              onClick={() =>
                download(
                  `${project.title}.json`,
                  JSON.stringify(project, null, 2),
                  "application/json",
                )
              }
            >
              Download draft
            </button>
          )}
          <button onClick={() => setError("")} aria-label="Dismiss error">
            ×
          </button>
        </div>
      )}
      <div className="panes">
        {(left || right) && (
          <button
            className="scrim"
            aria-label="Close panel"
            onClick={() => {
              setLeft(false);
              setRight(false);
            }}
          />
        )}
        <nav
          className={`navigator ${left ? "open" : ""}`}
          aria-label="Manuscript navigation"
        >
          <div className="nav-head">
            <span>YOUR PROJECTS</span>
            <button
              disabled={busy}
              aria-label="Create project"
              onClick={() =>
                ask("New project", "", (title) => {
                  void newProject(title);
                })
              }
            >
              ＋
            </button>
          </div>
          <select
            aria-label="Select project"
            value={project?.id || ""}
            disabled={busy}
            onChange={(e) => void openProject(e.target.value)}
          >
            <option value="" disabled>
              Choose a project
            </option>
            {rows.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title}
              </option>
            ))}
            {project && !rows.some((r) => r.id === project.id) && (
              <option value={project.id}>{project.title}</option>
            )}
          </select>
          <div className="tree">
            {project && renderTree(project.nodes[0], 0)}
            {!project && (
              <p className="muted">
                A synopsis, a scene, a stray thought. Begin with any of them.
              </p>
            )}
          </div>
          <div className="nav-footer">
            <button
              disabled={!node || node.kind === "scene" || busy}
              onClick={addNode}
            >
              ＋ Add{" "}
              {node?.kind === "project"
                ? "book"
                : node?.kind === "book"
                  ? "book"
                  : "scene"}
            </button>
            <label className="check">
              <input
                type="checkbox"
                checked={archived}
                onChange={(e) => setArchived(e.target.checked)}
              />
              Show archived
            </label>
            <button onClick={() => importer.current?.click()}>
              Import Markdown / backup
            </button>
          </div>
        </nav>
        <main className="workspace">
          {node && project ? (
            <>
              <div className="breadcrumbs">
                {ancestry(project, node).map((n) => (
                  <span key={n.id}>{n.title}</span>
                ))}
              </div>
              <div className="title-row">
                <div>
                  <span className="eyebrow">
                    {node.kind}
                    {node.archived ? " · archived" : ""}
                  </span>
                  <h1>{node.title}</h1>
                </div>
                <div className="node-menu">
                  <button
                    aria-label="Section actions"
                    onClick={() => setMenu(!menu)}
                  >
                    •••
                  </button>
                  {menu && (
                    <div className="menu">
                      <button
                        disabled={busy}
                        onClick={() =>
                          ask("Rename", node.title, (title) => {
                            change({
                              ...project,
                              title:
                                node.kind === "project" ? title : project.title,
                              nodes: project.nodes.map((n) =>
                                n.id === node.id ? { ...n, title } : n,
                              ),
                            });
                            setMenu(false);
                          })
                        }
                      >
                        Rename
                      </button>
                      <button
                        disabled={busy}
                        onClick={async () => {
                          if (await save()) duplicate();
                        }}
                      >
                        Duplicate / branch
                      </button>
                      <button disabled={busy} onClick={() => reorder(-1)}>
                        Move up
                      </button>
                      <button disabled={busy} onClick={() => reorder(1)}>
                        Move down
                      </button>
                      <button
                        disabled={busy}
                        onClick={() =>
                          setConfirmDialog({
                            title: node.archived
                              ? "Restore from archive?"
                              : "Archive this item?",
                            description:
                              "Its children and writing remain available through Show archived.",
                            action: () => {
                              change({
                                ...project,
                                nodes: project.nodes.map((n) =>
                                  n.id === node.id
                                    ? { ...n, archived: !n.archived }
                                    : n,
                                ),
                              });
                              setMenu(false);
                            },
                          })
                        }
                      >
                        {node.archived ? "Unarchive" : "Archive"}
                      </button>
                      <button
                        onClick={() =>
                          download(
                            `${node.title}.md`,
                            exportMarkdown(project, node.id),
                          )
                        }
                      >
                        Export {node.kind}
                      </button>
                      <button
                        className="danger"
                        disabled={busy || demo}
                        onClick={() => {
                          const isProject = node.kind === "project";
                          const count = isProject
                            ? project.nodes.length - 1
                            : descendants(project, node.id).size - 1;
                          setConfirmDialog({
                            title: `Delete ${node.kind}?`,
                            description: isProject
                              ? `Permanently delete “${project.title},” including all books, scenes, writing, conversation, proposals, and version history? This cannot be undone.`
                              : `Permanently delete “${node.title}”${count ? ` and its ${count} contained item${count === 1 ? "" : "s"}` : ""}? This cannot be undone.`,
                            action: isProject ? deleteProject : deleteNode,
                          });
                          setMenu(false);
                        }}
                      >
                        Delete {node.kind}
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <div
                className="section-tabs"
                role="tablist"
                aria-label="Writing sections"
              >
                {(node.kind === 'project' ? [] : node.kind === 'book' ? ['synopsis','outline','sceneBeats','manuscript'] : fields[node.kind]).map((f) => (
                  <button
                    key={f}
                    role="tab"
                    aria-selected={section === f}
                    onClick={() => setSection(f)}
                  >
                    {labels[f]}
                  </button>
                ))}
              </div>
              <div className="editor-tools">
                <span>
                  {section === "notes"
                    ? "Ideas can stay undecided."
                    : section === "canon"
                      ? "Only the facts the model must not get wrong."
                      : "Your words. Always editable."}
                </span>
                <button onClick={history}>History</button>
                <button
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(
                        node.sections[section] || "",
                      );
                      setStatus("Markdown copied");
                    } catch (e) {
                      alertError(e);
                    }
                  }}
                >
                  Copy
                </button>
                <button
                  onClick={() =>
                    download(
                      `${node.title}-${section}.md`,
                      node.sections[section] || "",
                    )
                  }
                >
                  ↓ .md
                </button>
                {section === "outline" && (node.sections.outline || "").trim() && (
                  <button
                    className="danger"
                    disabled={busy}
                    onClick={() =>
                      setConfirmDialog({
                        title: "Clear this outline?",
                        description:
                          "The outline text will be cleared. You can restore its previous contents from History.",
                        action: () => {
                          textChange("");
                          meta.current = { action: "clear-outline" };
                        },
                      })
                    }
                  >
                    Clear outline
                  </button>
                )}
              </div>
              {node.kind === 'book' && <div className="editor-tools">
                {section==='synopsis' && <button disabled={busy} onClick={()=>void generate('outline')}>Generate outline</button>}
                {section==='outline' && <button disabled={busy} onClick={()=>void generate('sceneBeats')}>Generate scene beats</button>}
                {section==='manuscript' && <><span>Select prose to rewrite, or place the cursor to insert. Enter guidance in the right pane.</span><button disabled={busy||!guidance.trim()} onClick={()=>void generate('prose')}>Write / rewrite with AI</button><button onClick={()=>{setRight(true);setPanel('model');}}>Writing guidance & model</button></>}
              </div>}
              {node.kind === 'book' && section === 'sceneBeats' ? <BookBeats value={node.sections.sceneBeats||''} onChange={textChange} busy={busy} onGenerate={beat=>{setConfirmDialog({title:'Generate scene in manuscript',description:'The proposed scene will be appended to the Book manuscript. You can edit and review the complete manuscript proposal before accepting.',action:()=>{void generate('prose',beat);}});}}/> : <textarea
                ref={editor}
                hidden={node.kind === 'project'}
                className={`editor ${section === "manuscript" ? "manuscript" : ""}`}
                aria-label={labels[section] || section}
                value={node.sections[section] || ""}
                onChange={(e) => textChange(e.target.value)}
                placeholder={
                  section === "synopsis"
                    ? "What do you know about this story?\n\nStart anywhere. A person who wants something. A confrontation. An ending you can’t stop thinking about."
                    : section === "manuscript"
                      ? "The scene begins here…"
                      : section === "notes"
                        ? "A line of dialogue. A possibility. Something to figure out later."
                        : `Start your ${labels[section]?.toLowerCase() || section} here…`
                }
                spellCheck
              />}
              {node.kind === 'project' && <div className="empty"><h2>Start with a Book</h2><p>Synopsis → Outline → Scene Beats → Manuscript</p><button onClick={addNode}>Create Book</button>{project.nodes.filter(n=>n.kind==='book'&&!n.archived).map(b=><button key={b.id} onClick={()=>selectNode(b)}>{b.title}</button>)}<p>Project notes, canon, and research are in the Context pane.</p></div>}
              <footer className="editor-footer">
                <span>
                  {(node.sections[section] || "")
                    .trim()
                    .split(/\s+/)
                    .filter(Boolean)
                    .length.toLocaleString()}{" "}
                  words <span className="muted">· Markdown</span>
                </span>
                <div>
                  {node.kind === "chapter" && (
                    <button disabled={busy} onClick={openScenes}>
                      Create scenes from selection
                    </button>
                  )}
                  <button onClick={() => void save()}>Save</button>
                </div>
              </footer>
            </>
          ) : (
            <div className="empty">
              <span className="eyebrow">A PLACE TO BEGIN</span>
              <h1>
                Your story starts
                <br />
                wherever you are.
              </h1>
              <p>
                No setup ritual. No required outline.
                <br />
                Make a project and put the first thought down.
              </p>
              <button
                className="primary"
                onClick={() =>
                  ask("New project", "", (title) => void newProject(title))
                }
              >
                Create a project
              </button>
            </div>
          )}
        </main>
        <aside
          className={`partner ${right ? "open" : ""}`}
          aria-label="AI writing partner"
        >
          <div className="partner-heading">
            <h2>Writing partner</h2>
            <button
              aria-label="Close writing partner"
              className="close-partner"
              onClick={() => setRight(false)}
            >
              ×
            </button>
          </div>
          <div className="partner-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={panel === "chat"}
              onClick={() => setPanel("chat")}
            >
              Conversation
            </button>
            <button
              role="tab"
              aria-selected={panel === "context"}
              onClick={() => setPanel("context")}
            >
              Context{" "}
              <small>
                {
                  selectedSources.filter((id) =>
                    available.some((s) => s.id === id),
                  ).length
                }
              </small>
            </button>
            <button
              role="tab"
              aria-selected={panel === "model"}
              onClick={() => setPanel("model")}
            >
              AI / Model
            </button>
          </div>
          {panel === "chat" ? (
            <>
              <div className="conversation">
                {!!project?.messages.length && (
                  <div className="chat-actions">
                    <button
                      className="danger"
                      disabled={busy}
                      onClick={() =>
                        setConfirmDialog({
                          title: "Clear conversation?",
                          description:
                            "This permanently removes the brainstorming conversation from this project. Saved writing and completed AI response checkpoints are unaffected.",
                          action: clearConversation,
                        })
                      }
                    >
                      Clear conversation
                    </button>
                  </div>
                )}
                {!project?.messages.length && (
                  <div className="chat-empty">
                    <span className="eyebrow">THINK IT THROUGH</span>
                    <h3>What’s on your mind?</h3>
                    <p>
                      Explore a decision, untangle a scene, or see where an idea
                      leads.
                    </p>
                    {[
                      "What are three ways this confrontation could turn?",
                      "Help me figure out why this character refuses.",
                      "Where does this outline need a stronger transition?",
                    ].map((t) => (
                      <button key={t} onClick={() => setGuidance(t)}>
                        {t}
                      </button>
                    ))}
                  </div>
                )}
                {project?.messages.map((m) => (
                  <article key={m.id} className={`message ${m.role}`}>
                    <span>
                      {m.role === "user" ? "YOU" : "WRITING PARTNER"}
                      {m.model && <small> · {m.model}</small>}
                    </span>
                    <div>{m.content}</div>
                  </article>
                ))}
                {busy && (
                  <p role="status" className="thinking">
                    Thinking with your selected context…
                  </p>
                )}
              </div>
              {pending.length > 0 && (
                <div className="pending">
                  <label>
                    Proposals waiting for review
                    <select
                      value=""
                      onChange={(e) => {
                        const p = pending.find((p) => p.id === e.target.value)!;
                        setProposalId(p.id);
                        setProposalText(p.output);
                        setModal("proposal");
                      }}
                    >
                      <option value="">
                        Review a proposal ({pending.length})
                      </option>
                      {pending.map((p) => (
                        <option key={p.id} value={p.id}>
                          {project?.nodes.find((n) => n.id === p.nodeId)?.title}{" "}
                          · {labels[p.section]}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
            </>
          ) : panel === "context" ? (
            <div className="panel-scroll">
              <h3>Story context</h3>
              {project && node && ancestry(project,node).filter(n=>n.kind==='project'||n.kind==='book').map(n=><details key={n.id}><summary>{n.title} · edit context</summary>{(n.kind==='project'?['notes','canon','voice','research']:['recentContext','actSummaries','currentAct','voice','notes']).map(k=><label key={k}>{labels[k]}<textarea value={n.sections[k]||''} onChange={e=>{const p=current.current!;change({...p,nodes:p.nodes.map(x=>x.id===n.id?{...x,sections:{...x.sections,[k]:e.target.value}}:x)});}}/></label>)}</details>)}
              <p className="muted">
                Only checked sources are attached. Empty sections stay out.
              </p>
              {available.length === 0 && (
                <p>Write a little first. Your sections will appear here.</p>
              )}
              {available.map((s) => (
                <label key={s.id} className="context-item">
                  <input
                    type="checkbox"
                    checked={selectedSources.includes(s.id)}
                    onChange={(e) =>
                      setSelectedSources((ids) =>
                        e.target.checked
                          ? [...ids, s.id]
                          : ids.filter((id) => id !== s.id),
                      )
                    }
                  />
                  <span>
                    {s.label}
                    <small>{s.text.length.toLocaleString()} characters</small>
                  </span>
                </label>
              ))}
              <label className="check">
                <input
                  type="checkbox"
                  checked={includeChat}
                  onChange={(e) => setIncludeChat(e.target.checked)}
                />
                Include last 20 chat messages
              </label>
              <button onClick={() => setModal("inspector")}>
                Inspect exact chat request
              </button>
              <button
                disabled={!project}
                onClick={() =>
                  updatePreset({
                    contextKeys: [
                      ...new Set(
                        available
                          .filter((s) => selectedSources.includes(s.id))
                          .map((s) => s.key),
                      ),
                    ],
                  })
                }
              >
                Save selection as preset recipe
              </button>
              <div className="help">
                <h3>Model confused?</h3>
                <p>
                  Add recent prose or a canon rule, attach research, strengthen
                  your guidance, or change the model.
                </p>
              </div>
            </div>
          ) : (
            <div className="panel-scroll">
              <label>
                Preset
                <select
                  value={preset.id}
                  onChange={(e) => setPresetId(e.target.value)}
                >
                  {project?.presets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                OpenRouter model
                <input
                  list="models"
                  placeholder="provider/model-id"
                  value={preset.model}
                  disabled={!project}
                  onChange={(e) => updatePreset({ model: e.target.value })}
                />
                <datalist id="models">
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </datalist>
              </label>
              {models
                .filter((m) => m.id === preset.model)
                .map((m) => (
                  <p className="model-cost" key={m.id}>
                    {m.context_length.toLocaleString()} token window
                    <br />${(Number(m.pricing.prompt) * 1e6).toFixed(2)} input /
                    ${(Number(m.pricing.completion) * 1e6).toFixed(2)} output
                    per million tokens
                  </p>
                ))}
              <label>
                Temperature
                <input
                  type="number"
                  min="0"
                  max="2"
                  step="0.1"
                  value={preset.temperature}
                  onChange={(e) =>
                    updatePreset({ temperature: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                Maximum output tokens
                <input
                  type="number"
                  min="256"
                  max="32768"
                  step="256"
                  value={preset.maxTokens}
                  onChange={(e) =>
                    updatePreset({ maxTokens: Number(e.target.value) })
                  }
                />
              </label>
              <button
                disabled={!project}
                onClick={() =>
                  ask("Save a new preset", "", (name) => {
                    const id = crypto.randomUUID();
                    change({
                      ...project!,
                      presets: [...project!.presets, { ...preset, id, name }],
                    });
                    setPresetId(id);
                  })
                }
              >
                Save as new preset
              </button>
              <p className="muted">
                Choose the least expensive model that works for this task.
                Presets remember the model, settings, and context recipe.
              </p>
            </div>
          )}
          <div className="composer">
            <label htmlFor="guidance">
              {panel === "chat"
                ? "Message / generation guidance"
                : "Generation guidance"}
            </label>
            <textarea
              id="guidance"
              value={guidance}
              onChange={(e) => setGuidance(e.target.value)}
              placeholder="What should we work on? Preserve this line, explore that decision…"
            />
            <div className="model-label">
              <button onClick={() => setPanel("model")}>
                {preset.model || "Choose a model"}
              </button>
              <span>
                ~{Math.ceil(context.length / 4).toLocaleString()} context
                tokens*
              </span>
            </div>
            <button
              className="primary"
              disabled={!project || busy || !guidance.trim()}
              onClick={() => void generate("chat")}
            >
              {busy ? "Thinking…" : "Send message"}
            </button>
            <details>
              <summary>Work on this section</summary>
              <div className="generation-actions">
                {node?.kind === "book" && (
                  <button
                    disabled={busy}
                    onClick={() => void generate("outline")}
                  >
                    Synopsis → Outline
                  </button>
                )}
                {node?.kind === "chapter" && (
                  <button
                    disabled={busy}
                    onClick={() => void generate("scenePlan")}
                  >
                    Outline → Scene plan
                  </button>
                )}
                {node?.kind === "scene" && (
                  <>
                    <button
                      disabled={busy}
                      onClick={() => void generate("beats")}
                    >
                      Scene → Beats
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => void generate("detailedBeats")}
                    >
                      Beats → Detailed beats
                    </button>
                  </>
                )}
                <button
                  disabled={!node || busy}
                  onClick={() => void generate("revise")}
                >
                  Revise {labels[section]?.toLowerCase()}
                </button>
                <button
                  disabled={!node || busy || !project?.messages.length}
                  onClick={() => void generate("fromChat")}
                >
                  Chat → {labels[section]}
                </button>
              </div>
            </details>
          </div>
        </aside>
      </div>
      <input
        type="file"
        ref={importer}
        hidden
        accept=".md,.markdown,.txt,.json"
        onChange={(e) => {
          if (e.target.files?.[0]) void importFile(e.target.files[0]);
          e.target.value = "";
        }}
      />
      {modal && (
        <div className="modal-backdrop">
          <section
            role="dialog"
            aria-modal="true"
            aria-label={modal}
            className={`modal ${modal === "proposal" ? "wide" : ""}`}
          >
            <div className="modal-heading">
              <h2>
                {
                  (
                    {
                      settings: "Your writing room",
                      history: "Section history",
                      proposal: "A possible next version",
                      inspector: "Exactly what the model sees",
                      scenes: "Turn an outline into scenes",
                      generations: "Completed AI responses",
                    } as Record<string, string>
                  )[modal]
                }
              </h2>
              <button aria-label="Close dialog" onClick={() => setModal("")}>
                ×
              </button>
            </div>
            {modal === "settings" && (
              <>
                <p>
                  {hasKey
                    ? "Your account-wide OpenRouter key is saved. Enter another key to replace it for every project."
                    : "Add one OpenRouter key for this StoryLoom account. It will work across every project."}
                </p>
                <label>
                  Account OpenRouter API key
                  <input
                    type="password"
                    autoComplete="off"
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                  />
                </label>
                <button
                  className="primary"
                  disabled={!key || demo}
                  onClick={async () => {
                    try {
                      await api("settings", { key });
                      setKey("");
                      setHasKey(true);
                      setStatus("Account OpenRouter key saved");
                    } catch (e) {
                      alertError(e);
                    }
                  }}
                >
                  Save account key securely
                </button>
                <p className="muted">
                  Shared by all your StoryLoom projects. Encrypted at rest,
                  used only by the server, and never included in project
                  exports.
                </p>
                <button
                  disabled={!project || demo}
                  onClick={async () => {
                    try {
                      setGenerations(await api(`ai?project=${project!.id}`));
                      setModal("generations");
                    } catch (e) {
                      alertError(e);
                    }
                  }}
                >
                  Recover completed AI responses
                </button>
                <button
                  disabled={!project}
                  onClick={() =>
                    download(
                      `${project!.title}.json`,
                      JSON.stringify(project, null, 2),
                      "application/json",
                    )
                  }
                >
                  Download full project backup
                </button>
                <button
                  disabled={busy}
                  onClick={async () => {
                    if (!(await save())) return;
                    if (demo) {
                      setDemo(false);
                      demoRef.current = false;
                    } else await supabase!.auth.signOut();
                    setProject(null);
                    current.current = null;
                    setModal("");
                  }}
                >
                  Sign out
                </button>
              </>
            )}
            {modal === "history" && (
              <>
                <p>
                  Restoring creates another version. Later versions remain
                  available.
                </p>
                <div className="history-list">
                  {!versions.length && (
                    <p>No saved versions for this section yet.</p>
                  )}
                  {versions.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => setHistoryText(v.content)}
                    >
                      {new Date(v.created_at).toLocaleString()} ·{" "}
                      {String(v.metadata.action || "manual")}
                      <small>
                        {v.content.slice(0, 100) || "(empty section)"}
                      </small>
                    </button>
                  ))}
                </div>
                {historyText !== null && (
                  <>
                    <div className="compare">
                      <div>
                        <h3>Current</h3>
                        <pre>{node?.sections[section] || "(empty)"}</pre>
                      </div>
                      <div>
                        <h3>Selected version</h3>
                        <pre>{historyText || "(empty)"}</pre>
                      </div>
                    </div>
                    <button
                      className="primary"
                      onClick={() => {
                        textChange(historyText);
                        meta.current = { action: "restore" };
                        setModal("");
                      }}
                    >
                      Restore as a new version
                    </button>
                  </>
                )}
              </>
            )}
            {modal === "proposal" && activeProposal && (
              <>
                <p>
                  {
                    project?.nodes.find((n) => n.id === activeProposal.nodeId)
                      ?.title
                  }{" "}
                  · {labels[activeProposal.section]}
                  <br />
                  <small>
                    {activeProposal.model} · {activeProposal.preset}
                  </small>
                </p>
                <div className="compare">
                  <div>
                    <h3>Current text</h3>
                    <pre>
                      {project?.nodes.find(
                        (n) => n.id === activeProposal.nodeId,
                      )?.sections[activeProposal.section] || "(empty)"}
                    </pre>
                  </div>
                  <div>
                    <h3>Proposed text · editable</h3>
                    <textarea
                      aria-label="Proposed text"
                      value={proposalText}
                      onChange={(e) => setProposalText(e.target.value)}
                    />
                  </div>
                </div>
                <div className="modal-actions">
                  <button className="primary" onClick={() => applyProposal()}>
                    Apply as new version
                  </button>
                  <button onClick={() => applyProposal(true)}>
                    Save as item copy
                  </button>
                  <button
                    onClick={() => {
                      change(
                        {
                          ...project!,
                          proposals: project!.proposals.map((p) =>
                            p.id === activeProposal.id
                              ? { ...p, status: "rejected" }
                              : p,
                          ),
                        },
                        { action: "reject-proposal" },
                      );
                      setModal("");
                    }}
                  >
                    Reject
                  </button>
                </div>
              </>
            )}
            {modal === "inspector" && (
              <>
                <p>
                  Includes the system instruction, selected sources, optional
                  recent conversation, and current guidance. Token counts are
                  estimates.
                </p>
                <pre className="request-preview">
                  {JSON.stringify(
                    {
                      model: preset.model,
                      temperature: preset.temperature,
                      max_tokens: preset.maxTokens,
                      messages: promptMessages(
                        context,
                        includeChat ? project?.messages.slice(-20) || [] : [],
                        guidance,
                      ),
                    },
                    null,
                    2,
                  )}
                </pre>
              </>
            )}
            {modal === "generations" && (
              <>
                <p>
                  These responses were saved by the server. Recover one if a tab
                  closed before you could save it.
                </p>
                {!generations.length && <p>No completed responses yet.</p>}
                {generations.map((g) => (
                  <details key={g.id}>
                    <summary>
                      {new Date(g.at).toLocaleString()} · {g.model} ·{" "}
                      {labels[g.section] || "Chat"}
                    </summary>
                    <pre>{g.output}</pre>
                    <button
                      onClick={() => download(`response-${g.id}.md`, g.output)}
                    >
                      Download response
                    </button>
                    <button
                      disabled={!project?.nodes.some((n) => n.id === g.nodeId)}
                      onClick={() => {
                        const proposal: Proposal = {
                          id: crypto.randomUUID(),
                          nodeId: g.nodeId,
                          section: g.section || "notes",
                          previous: g.previous,
                          output: g.output,
                          model: g.model,
                          preset: g.preset,
                          instruction: g.instruction,
                          context: g.context,
                          at: g.at,
                          status: "pending",
                        };
                        change(
                          {
                            ...project!,
                            proposals: [...project!.proposals, proposal],
                          },
                          { action: "recover-generation" },
                        );
                        setProposalId(proposal.id);
                        setProposalText(proposal.output);
                        setModal("proposal");
                      }}
                    >
                      Recover as proposal
                    </button>
                  </details>
                ))}
              </>
            )}
            {modal === "scenes" && (
              <>
                <p>
                  Your selected text is copied below. Use a{" "}
                  <code>## Scene title</code> heading for each scene. Review or
                  edit before creating. Existing scenes stay in place.
                </p>
                <textarea
                  className="scene-import"
                  aria-label="Scene plans to create"
                  value={sceneInput}
                  onChange={(e) => setSceneInput(e.target.value)}
                />
                <button className="primary" onClick={createScenes}>
                  Create scenes
                </button>
              </>
            )}
          </section>
        </div>
      )}
      {inputDialog && (
        <div className="modal-backdrop">
          <form
            className="modal compact"
            role="dialog"
            aria-modal="true"
            aria-label={inputDialog.title}
            onSubmit={(e) => {
              e.preventDefault();
              if (inputDialog.value.trim()) {
                inputDialog.action(inputDialog.value.trim());
                setInputDialog(null);
              }
            }}
          >
            <h2>{inputDialog.title}</h2>
            <input
              aria-label="Name"
              autoFocus
              value={inputDialog.value}
              onChange={(e) =>
                setInputDialog({ ...inputDialog, value: e.target.value })
              }
            />
            <div className="modal-actions">
              <button type="submit" className="primary">
                Save
              </button>
              <button type="button" onClick={() => setInputDialog(null)}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
      {confirmDialog && (
        <div className="modal-backdrop">
          <section
            className="modal compact"
            role="alertdialog"
            aria-modal="true"
            aria-label={confirmDialog.title}
          >
            <h2>{confirmDialog.title}</h2>
            <p>{confirmDialog.description}</p>
            <div className="modal-actions">
              <button
                className="primary"
                onClick={async () => {
                  if (await save()) {
                    await confirmDialog.action();
                    setConfirmDialog(null);
                  }
                }}
              >
                Confirm
              </button>
              <button onClick={() => setConfirmDialog(null)}>Cancel</button>
            </div>
          </section>
        </div>
      )}
      {structure && <StructureReview initial={structure.plan} origin={structure.origin} existing={!!project?.nodes.some(n=>n.parent===structure.bookId)} onCancel={()=>setStructure(null)} onApprove={approveStructure}/>}
    </div>
  );
  function renderTree(n: Node, depth: number): React.ReactNode {
    if (n.archived && !archived) return null;
    return (
      <div key={n.id}>
        <button
          className={`tree-node ${selected === n.id ? "selected" : ""}`}
          style={{ paddingLeft: 12 + depth * 14 }}
          disabled={busy}
          onClick={() => selectNode(n)}
        >
          <span className="node-mark">
            {n.kind === "project"
              ? "◈"
              : n.kind === "book"
                ? "▤"
                : n.kind === "chapter"
                  ? "≡"
                  : "—"}
          </span>
          <span>
            {n.title}
            {n.archived ? " (archived)" : ""}
          </span>
        </button>
        {project?.nodes
          .filter((child) => child.parent === n.id)
          .map((child) => renderTree(child, depth + 1))}
      </div>
    );
  }
}

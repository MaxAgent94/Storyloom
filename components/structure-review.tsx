"use client";
import { useState } from 'react';
import { type ChapterPlan, validStructure } from '@/lib/structure';
export default function StructureReview({initial, origin, existing, onCancel, onApprove}: {
  initial: ChapterPlan[]; origin: string; existing: boolean; onCancel: () => void;
  onApprove: (plan: ChapterPlan[], alternative: boolean) => Promise<void>;
}) {
  const [plan, setPlan] = useState(initial);
  const [waiting, setWaiting] = useState(false);
  function edit(fn: (p: ChapterPlan[]) => void) { const copy = structuredClone(plan); fn(copy); setPlan(copy); }
  function move<T>(a: T[], i: number, d: number) { if (i+d >= 0 && i+d < a.length) [a[i],a[i+d]] = [a[i+d],a[i]]; }
  async function approve(alternative: boolean) { setWaiting(true); try { await onApprove(plan, alternative); } finally { setWaiting(false); } }
  return <div className="modal-backdrop"><section className="modal wide" role="dialog" aria-modal="true" aria-label="Review chapters and scenes">
    <h2>Review chapters and scenes</h2><p>{origin}</p>
    <p>{existing ? 'This book already has structure. Append new chapters, or create a separate alternative Book.' : 'Only chapter outlines and scene synopses will be populated.'} Existing content is preserved.</p>
    <fieldset disabled={waiting} style={{border:0,padding:0}}>
    {plan.map((c,i) => <section key={i} style={{padding:'16px 0',borderBottom:'1px solid #ccc'}}>
      <label>Chapter {i+1}<input value={c.title} onChange={e=>edit(p=>{p[i].title=e.target.value;})}/></label>
      <label>Chapter intent<textarea value={c.summary} onChange={e=>edit(p=>{p[i].summary=e.target.value;})}/></label>
      <button disabled={i===0} onClick={()=>edit(p=>move(p,i,-1))}>Chapter ↑</button><button disabled={i===plan.length-1} onClick={()=>edit(p=>move(p,i,1))}>Chapter ↓</button><button onClick={()=>edit(p=>{p.splice(i,1);})}>Remove chapter</button>
      {c.scenes.map((s,j)=><div key={j} style={{padding:'12px',marginTop:12}}>
        <label>Scene {j+1}<input value={s.title} onChange={e=>edit(p=>{p[i].scenes[j].title=e.target.value;})}/></label>
        <label>Synopsis / intent<textarea value={s.summary} onChange={e=>edit(p=>{p[i].scenes[j].summary=e.target.value;})}/></label>
        <button disabled={j===0} onClick={()=>edit(p=>move(p[i].scenes,j,-1))}>Scene ↑</button><button disabled={j===c.scenes.length-1} onClick={()=>edit(p=>move(p[i].scenes,j,1))}>Scene ↓</button><button onClick={()=>edit(p=>{p[i].scenes.splice(j,1);})}>Remove scene</button>
      </div>)}
      <button onClick={()=>edit(p=>{p[i].scenes.push({title:'New scene',summary:''});})}>Add scene</button>
    </section>)}
    <button onClick={()=>edit(p=>{p.push({title:'New chapter',summary:'',scenes:[{title:'New scene',summary:''}]});})}>Add chapter</button>
    <p>{plan.length} chapters · {plan.reduce((n,c)=>n+c.scenes.length,0)} scenes</p>
    {!validStructure(plan) && <p>Each chapter needs a scene; all titles are required.</p>}
    <button disabled={!validStructure(plan)} onClick={()=>void approve(false)}>{existing ? 'Approve & append new structure' : 'Approve & create chapters / scenes'}</button>
    <button disabled={!validStructure(plan)} onClick={()=>void approve(true)}>Create as alternative copy</button>
    <button onClick={onCancel}>Cancel</button>
    </fieldset>
  </section></div>;
}

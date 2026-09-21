"use client";
import { useRef } from 'react';
export function readBeats(text: string) {
  return text.trim() ? text.split(/(?=^## )/m).filter(s=>s.trim()).map(s=>{
    const lines=s.trim().split('\n');
    return lines[0].startsWith('## ') ? {title:lines[0].slice(3),text:lines.slice(1).join('\n').trim()} : {title:'Scene beat',text:s.trim()};
  }) : [];
}
export default function BookBeats({value,onChange,onGenerate,busy}: {value:string;onChange:(v:string)=>void;onGenerate:(beat:string)=>void;busy:boolean}) {
  const scroller = useRef<HTMLDivElement>(null);
  function jump(to: 'top' | 'bottom') {
    const element = scroller.current;
    if (element) element.scrollTo({ top: to === 'top' ? 0 : element.scrollHeight, behavior: 'instant' });
  }
  const beats=readBeats(value);
  function update(next: typeof beats) {onChange(next.map(b=>`## ${b.title}\n\n${b.text}`).join('\n\n'));}
  return <div className="book-beats" ref={scroller}>
    <nav className="beats-jump" aria-label="Scene beats navigation">
      <button type="button" aria-label="Jump to top of scene beats" onClick={()=>jump('top')}>↑ Top</button>
      <button type="button" aria-label="Jump to bottom of scene beats" onClick={()=>jump('bottom')}>↓ Bottom</button>
    </nav>
    {beats.map((b,i)=><section key={i}>
    <label>Scene {i+1}<input value={b.title} onChange={e=>update(beats.map((x,j)=>j===i?{...x,title:e.target.value}:x))}/></label>
    <textarea aria-label={`Beats for ${b.title}`} value={b.text} onChange={e=>update(beats.map((x,j)=>j===i?{...x,text:e.target.value}:x))}/>
    <button disabled={i===0} onClick={()=>{[beats[i-1],beats[i]]=[beats[i],beats[i-1]];update(beats);}}>Move up</button>
    <button disabled={i===beats.length-1} onClick={()=>{[beats[i+1],beats[i]]=[beats[i],beats[i+1]];update(beats);}}>Move down</button>
    <button onClick={()=>{if(window.confirm('Remove this planning unit? Previous saved versions remain in History.'))update(beats.filter((_,j)=>j!==i));}}>Remove</button>
    <button disabled={busy||!b.text.trim()} onClick={()=>onGenerate(`## ${b.title}\n${b.text}`)}>Generate scene</button>
  </section>)}<button onClick={()=>update([...beats,{title:`Scene ${beats.length+1}`,text:''}])}>Add scene beat</button></div>;
}

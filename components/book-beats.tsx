"use client";
export function readBeats(text: string) {
  return text.trim() ? text.split(/(?=^## )/m).filter(s=>s.trim()).map(s=>{
    const lines=s.trim().split('\n');
    return lines[0].startsWith('## ') ? {title:lines[0].slice(3),text:lines.slice(1).join('\n').trim()} : {title:'Scene beat',text:s.trim()};
  }) : [];
}
export default function BookBeats({value,onChange,onGenerate,busy}: {value:string;onChange:(v:string)=>void;onGenerate:(beat:string)=>void;busy:boolean}) {
  const beats=readBeats(value);
  function update(next: typeof beats) {onChange(next.map(b=>`## ${b.title}\n\n${b.text}`).join('\n\n'));}
  return <div className="book-beats">{beats.map((b,i)=><section key={i}>
    <label>Scene {i+1}<input value={b.title} onChange={e=>update(beats.map((x,j)=>j===i?{...x,title:e.target.value}:x))}/></label>
    <textarea aria-label={`Beats for ${b.title}`} value={b.text} onChange={e=>update(beats.map((x,j)=>j===i?{...x,text:e.target.value}:x))}/>
    <button disabled={i===0} onClick={()=>{[beats[i-1],beats[i]]=[beats[i],beats[i-1]];update(beats);}}>Move up</button>
    <button disabled={i===beats.length-1} onClick={()=>{[beats[i+1],beats[i]]=[beats[i],beats[i+1]];update(beats);}}>Move down</button>
    <button onClick={()=>{if(window.confirm('Remove this planning unit? Previous saved versions remain in History.'))update(beats.filter((_,j)=>j!==i));}}>Remove</button>
    <button disabled={busy||!b.text.trim()} onClick={()=>onGenerate(`## ${b.title}\n${b.text}`)}>Generate scene</button>
  </section>)}<button onClick={()=>update([...beats,{title:`Scene ${beats.length+1}`,text:''}])}>Add scene beat</button></div>;
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {parseStructure, materialize, structureSources} from '../lib/structure.ts';
import {makeProject,makeNode,validateProject} from '../lib/domain.ts';
test('explicit headings preserve summaries and loose outlines require interpretation',()=>{
  const plan=parseStructure('## Chapter 1\nArrival\n### Scene 1\nShe finds a letter.\n### Scene 2\nShe refuses.');
  assert.equal(plan?.[0].scenes[1].summary,'She refuses.');
  assert.equal(parseStructure('She arrives, finds a letter, then refuses.'),null);
  assert.equal(parseStructure('## Chapter 1\nNo scenes yet'),null);
});
test('append and alternative preserve existing content and only fill scene synopsis',()=>{
  const p=makeProject('Novel'); const b=makeNode('book',p.id,'Book'); p.nodes.push(b);
  const plan=parseStructure('## Chapter 1\n### Scene 1\nA discovery.')!;
  const once=materialize(p,b.id,plan,false);
  const twice=materialize(once.project,b.id,plan,false);
  assert.deepEqual(twice.project.nodes.slice(0,once.project.nodes.length),once.project.nodes);
  assert.deepEqual(twice.project.nodes.at(-1)?.sections,{synopsis:'A discovery.'});
  const alt=materialize(twice.project,b.id,plan,true);
  assert.equal(alt.project.nodes.filter(n=>n.kind==='book').length,2);
  assert.ok(validateProject(alt.project));
  assert.equal(p.nodes.length,2);
});
test('structure context excludes prose, chat and unrelated books even if selected',()=>{
  const p=makeProject('Novel'); const b=makeNode('book',p.id,'Book');
  assert.deepEqual(structureSources(p,b,[`${p.id}:canon`,`${p.id}:research`,`${b.id}:manuscript`,'other:outline']),[`${b.id}:synopsis`,`${b.id}:outline`,`${p.id}:canon`,`${p.id}:research`]);
});

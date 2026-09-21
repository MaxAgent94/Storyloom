import test from 'node:test';
import assert from 'node:assert/strict';
import {insertProse, fields, makeProject, makeNode,validateProject,proposalDraft,proposalContent} from '../lib/domain.ts';
test('book supports the complete workflow without chapters or scenes',()=>{
 const p=makeProject('Novel');const b=makeNode('book',p.id,'Book');p.nodes.push(b);
 for(const k of ['synopsis','outline','sceneBeats','manuscript']) {assert.ok(fields.book.includes(k));b.sections[k]='text';}
 assert.ok(validateProject(p));
});
test('append preview shows only the scene and acceptance preserves the manuscript exactly once',()=>{
 for(const previous of ['', 'Existing chapter.', 'Existing chapter.\n\n']) {
  const p={section:'manuscript',previous,output:insertProse(previous,'New scene.',previous.length,previous.length)};
  assert.equal(proposalDraft(p),'New scene.');
  assert.equal(proposalContent(p,proposalDraft(p)),p.output);
  assert.equal(proposalContent(p,'Edited scene.'),insertProse(previous,'Edited scene.',previous.length,previous.length));
 }
});
test('replacement and planning proposals keep their full editable output',()=>{
 for(const p of [{section:'manuscript',previous:'Old text',output:'Rewritten text'},
  {section:'sceneBeats',previous:'First beat',output:'First beat\n\nSecond beat'}]) {
  assert.equal(proposalDraft(p),p.output);
  assert.equal(proposalContent(p,'Edited replacement'),'Edited replacement');
 }
});
test('prose insertion preserves surroundings and replacement affects only selection',()=>{
 assert.equal(insertProse('First.','Next.',6,6),'First.\n\nNext.');
 assert.equal(insertProse('First old last','new',6,9),'First new last');
 assert.throws(()=>insertProse('abc','x',0,4));
});

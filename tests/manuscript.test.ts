import test from 'node:test';
import assert from 'node:assert/strict';
import {insertProse, fields, makeProject, makeNode,validateProject} from '../lib/domain.ts';
test('book supports the complete workflow without chapters or scenes',()=>{
 const p=makeProject('Novel');const b=makeNode('book',p.id,'Book');p.nodes.push(b);
 for(const k of ['synopsis','outline','sceneBeats','manuscript']) {assert.ok(fields.book.includes(k));b.sections[k]='text';}
 assert.ok(validateProject(p));
});
test('prose insertion preserves surroundings and replacement affects only selection',()=>{
 assert.equal(insertProse('First.','Next.',6,6),'First.\n\nNext.');
 assert.equal(insertProse('First old last','new',6,9),'First new last');
 assert.throws(()=>insertProse('abc','x',0,4));
});

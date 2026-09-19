import test from 'node:test';
import assert from 'node:assert/strict';
import { makeProject, makeNode, validateProject } from '../lib/domain.ts';
import { projectDelta, applyProjectDelta, reconcileProject } from '../lib/project-transfer.ts';
import { body } from '../lib/server.ts';
import { gzipSync } from 'node:zlib';

test('large historical records stay out of routine saves without losing content', async () => {
  const p = makeProject('Novel');
  const book = makeNode('book', p.id, 'Book');
  book.sections.manuscript = 'Original prose';
  p.nodes.push(book);
  p.messages.push({ id: 'history', role: 'assistant', content: 'Past manuscript. '.repeat(300000), at: '' });
  const next = structuredClone(p);
  next.nodes[1].sections.manuscript += '\nNew prose';
  const patch = projectDelta(p, next);
  assert.ok(JSON.stringify(p).length > 3500000);
  assert.ok(JSON.stringify(patch).length < 5000);
  assert.deepEqual(applyProjectDelta(p, patch), next);
  assert.equal(p.nodes[1].sections.manuscript, 'Original prose');
  const request = new Request('http://localhost/api/projects', {
    method: 'POST', headers: { 'x-storyloom-transfer': 'gzip' },
    body: gzipSync(JSON.stringify({ project: next })),
  });
  const decoded = await body(request);
  assert.deepEqual(decoded.project, next);
  assert.ok(validateProject(decoded.project));
});

test('delta preserves reordering, deletion, new records and edited proposals', () => {
  const p = makeProject('Original');
  const next = structuredClone(p);
  next.title = 'Renamed';
  next.presets.reverse();
  next.messages.push({ id: 'new', role: 'user', content: 'Hello', at: '' });
  next.proposals.push({ id: 'proposal', nodeId: p.id, section: 'notes', previous: '', output: 'Idea', model: '', preset: '', instruction: '', at: '', context: '', status: 'pending' });
  assert.deepEqual(applyProjectDelta(p, projectDelta(p, next)), next);
  const final = structuredClone(next);
  final.messages = [];
  final.proposals[0].status = 'accepted';
  assert.deepEqual(applyProjectDelta(next, projectDelta(next, final)), final);
  const invalid = projectDelta(p, next);
  invalid.collections.nodes.order.push('missing');
  assert.throws(() => applyProjectDelta(p, invalid), /Incomplete/);
});

test('save recovery recognizes lost responses and preserves edits made while waiting', () => {
  const base = makeProject('Novel');
  base.nodes.push(makeNode('book', base.id, 'Book'));
  base.nodes[1].sections.manuscript = 'Original';
  const cloud = structuredClone(base);
  cloud.nodes[1].sections.manuscript = 'First edit';
  assert.deepEqual(reconcileProject(base, cloud, cloud, true), cloud);
  const local = structuredClone(cloud);
  local.nodes[1].sections.manuscript = 'First edit and more typing';
  cloud.nodes[1].sections.notes = 'Cloud note';
  cloud.messages.push({ id: 'chat', role: 'assistant', content: 'New chat', at: '' });
  const merged = reconcileProject(base, local, cloud, true);
  assert.equal(merged.nodes[1].sections.manuscript, local.nodes[1].sections.manuscript);
  assert.equal(merged.nodes[1].sections.notes, 'Cloud note');
  assert.deepEqual(merged.messages, cloud.messages);
  assert.equal(cloud.nodes[1].sections.manuscript, 'First edit');
  assert.throws(() => reconcileProject(base, local, cloud, false), /Both copies changed/);
});

test('recovery does not overwrite remote-only manuscript changes or resurrect deleted books', () => {
  const base = makeProject('Novel');
  base.nodes.push(makeNode('book', base.id, 'Book'));
  base.nodes[1].sections.manuscript = 'Original';
  const local = structuredClone(base), cloud = structuredClone(base);
  local.nodes[1].sections.notes = 'Local note';
  cloud.nodes[1].sections.manuscript = 'Cloud manuscript';
  assert.equal(reconcileProject(base, local, cloud, true).nodes[1].sections.manuscript, 'Cloud manuscript');
  cloud.nodes.pop();
  assert.throws(() => reconcileProject(base, local, cloud, true), /Both copies changed/);
});

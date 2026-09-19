import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { makeProject, makeNode, type Project } from '../lib/domain.ts';
import { projectDelta } from '../lib/project-transfer.ts';
import { hydrateProject, validateStoredDelta } from '../lib/project-storage.ts';

test('incremental database saves preserve history, revisions and owner boundaries without rewriting history', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role authenticated; create role anon; create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
    await db.exec(await readFile(new URL('../database/schema.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('../database/migrations/20260919071227_separate_project_history.sql', import.meta.url), 'utf8'));
    const owner = crypto.randomUUID(), other = crypto.randomUUID();
    await db.query('insert into auth.users values ($1),($2)', [owner, other]);
    await db.query('insert into public.allowed_users values ($1),($2)', [owner, other]);
    // Detect even a same-value assignment of the large column on routine saves.
    await db.exec(`create function public.guard_history() returns trigger language plpgsql as $$ begin
      if current_setting('test.reject_history_write',true)='yes' then raise exception 'History was rewritten'; end if;
      return new; end $$;
      create trigger guard_history before update of history on public.projects for each row execute function public.guard_history();
      set role authenticated;`);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
    let p = makeProject('Large project');
    p.nodes.push(makeNode('book', p.id, 'Book'));
    p.nodes[1].sections.manuscript = 'Original handwriting';
    p.messages.push({ id: 'large', role: 'assistant', content: 'History '.repeat(500000), at: '' });
    p.messages.push({ id: 'second', role: 'user', content: 'A question', at: '' });
    p.proposals.push({ id: 'proposal', nodeId: p.nodes[1].id, section: 'manuscript', previous: '', output: 'Alternative',
      context: '', instruction: '', model: '', preset: '', at: '', status: 'pending' });
    await db.query('select public.save_project($1,$2,0)', [p.id, JSON.stringify(p)]);
    const read = async () => (await db.query<{ body: Project; history: Pick<Project,'messages'|'proposals'>; revision: number }>(
      'select body,history,revision from public.projects where id=$1', [p.id])).rows[0];
    const save = async (before: Project, next: Project, revision: number) => {
      const delta = projectDelta(before, next);
      validateStoredDelta((await read()).body, delta);
      return db.query<{ save_project_v2: number }>('select public.save_project_v2($1,$2,null,$3)', [p.id, revision, JSON.stringify(delta)]);
    };
    let next = structuredClone(p);
    next.nodes[1].sections.manuscript = 'Manual edit';
    assert.equal((await save(p,next,1)).rows[0].save_project_v2, 2);
    let row = await read();
    assert.equal('messages' in row.body, false);
    assert.equal('proposals' in row.body, false);
    assert.deepEqual(hydrateProject(row.body,row.history), next);
    assert.ok(JSON.stringify(row.body).length < 10000);
    p = next;
    await db.exec("set test.reject_history_write='yes'");
    next = structuredClone(p);
    next.nodes[1].sections.manuscript = 'More handwriting';
    assert.equal((await save(p,next,2)).rows[0].save_project_v2, 3);
    row = await read();
    assert.deepEqual(hydrateProject(row.body,row.history), next);
    await assert.rejects(save(p,next,2), /conflict/i);
    const versions = await db.query<{ content: string }>("select content from public.section_versions where project_id=$1 and section='manuscript'", [p.id]);
    assert.deepEqual(versions.rows.map(x=>x.content).sort(), ['', 'Original handwriting', 'Manual edit', 'More handwriting'].sort());
    await db.exec("set test.reject_history_write='no'");
    p = next;
    next = structuredClone(p);
    next.messages.reverse();
    next.proposals[0].status = 'accepted';
    await save(p,next,3);
    row = await read();
    assert.deepEqual(hydrateProject(row.body,row.history), next);
    // Missing IDs fail atomically, including edits to manuscript in that request.
    const broken = projectDelta(next,next);
    broken.collections.messages.order.push('missing');
    await assert.rejects(db.query('select public.save_project_v2($1,4,null,$2)', [p.id,JSON.stringify(broken)]), /Incomplete/);
    assert.equal((await read()).revision,4);
    p = next;
    next = structuredClone(p);
    next.messages = [];
    next.proposals = [];
    await save(p,next,4);
    row = await read();
    assert.deepEqual(hydrateProject(row.body,row.history), next);
    // An older application server can still write; embedded data wins on read
    // and is migrated again on the next v2 save without resurrecting old chat.
    await db.query('select public.save_project($1,$2,5)', [p.id,JSON.stringify(p)]);
    row = await read();
    assert.deepEqual(hydrateProject(row.body,row.history), p);
    await save(p,next,6);
    row = await read();
    assert.deepEqual(hydrateProject(row.body,row.history),next);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [other]);
    await assert.rejects(db.query('select public.save_project_v2($1,7,$2)', [p.id,JSON.stringify(next)]), /conflict/i);
    assert.equal((await db.query('select history from public.projects')).rows.length,0);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [crypto.randomUUID()]);
    await assert.rejects(db.query('select public.save_project_v2($1,0,$2)', [p.id,JSON.stringify(next)]), /Unauthorized/);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
    p = makeProject('New/imported');
    p.messages.push({ id: 'imported', role: 'user', content: 'Preserved', at: '' });
    await db.query('select public.save_project_v2($1,0,$2)', [p.id,JSON.stringify(p)]);
    row = await read();
    assert.deepEqual(hydrateProject(row.body,row.history),p);
    await db.query('select public.delete_project($1)',[p.id]);
    assert.equal(await read(),undefined);
  } finally { await db.close(); }
});

test('delta validation rejects malformed historical records without requiring old history', () => {
  const p = makeProject('Test'), next = structuredClone(p);
  next.messages.push({ id: 'new', role: 'user', content: 'Hi', at: '' });
  const delta = projectDelta(p,next);
  assert.doesNotThrow(()=>validateStoredDelta(p,delta));
  Object.assign(delta.collections.messages.changed[0],{ role:'invalid' });
  assert.throws(()=>validateStoredDelta(p,delta),/Invalid project structure/);
});

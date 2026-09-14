import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { makeProject, makeNode } from "../lib/domain.ts";
test("database atomically versions edits, rejects stale saves, and enforces owner boundaries", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      `create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$; grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`,
    );
    await db.exec(
      await readFile(
        new URL("../database/schema.sql", import.meta.url),
        "utf8",
      ),
    );
    const owner = crypto.randomUUID(),
      other = crypto.randomUUID();
    await db.query("insert into auth.users values ($1),($2)", [owner, other]);
    await db.query("insert into public.allowed_users values ($1),($2)", [
      owner,
      other,
    ]);
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      owner,
    ]);
    const p = makeProject("Test"),
      b = makeNode("book", p.id, "Book");
    p.nodes.push(b);
    b.sections.synopsis = "Original";
    const save = async (expected: number, action = "manual") =>
      db.query<{ save_project: number }>(
        "select public.save_project($1,$2,$3,$4)",
        [p.id, JSON.stringify(p), expected, JSON.stringify({ action })],
      );
    assert.equal((await save(0)).rows[0].save_project, 1);
    b.sections.synopsis = "New";
    assert.equal((await save(1, "ai-apply")).rows[0].save_project, 2);
    await assert.rejects(save(1), /conflict/i);
    let versions = await db.query<{ content: string }>(
      "select content from public.section_versions where project_id=$1",
      [p.id],
    );
    assert.deepEqual(
      versions.rows.map((r) => r.content),
      ["", "Original", "New"],
    );
    b.sections.synopsis = "Original";
    await save(2, "restore");
    versions = await db.query<{ content: string }>(
      "select content from public.section_versions where project_id=$1",
      [p.id],
    );
    assert.equal(versions.rows.length, 4);
    assert.equal(versions.rows.at(-1)?.content, "Original");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      other,
    ]);
    assert.equal(
      (await db.query("select * from public.projects")).rows.length,
      0,
    );
    assert.equal(
      (await db.query("select * from public.section_versions")).rows.length,
      0,
    );
    await assert.rejects(save(3));
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      crypto.randomUUID(),
    ]);
    await assert.rejects(save(0), /Unauthorized/);
  } finally {
    await db.close();
  }
});

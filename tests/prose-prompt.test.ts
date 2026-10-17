import test from 'node:test';
import assert from 'node:assert/strict';
import { sceneProseInstruction } from '../lib/prose-prompt.ts';

test('scene generation keeps current beat and guidance separate from completed prose', () => {
  const beat = '## Scene 4\nExplain the distribution network. Target: 400–500 words.';
  const guidance = 'Do not repeat the letter introduction. Stay in her point of view.';
  const previous = 'The earlier letter introduction has already happened.';
  const prompt = sceneProseInstruction(beat, guidance, previous);
  assert.ok(prompt.includes(`<requested-scene-beat>\n\n${beat}\n\n</requested-scene-beat>`));
  assert.ok(prompt.includes(`<writer-guidance>\n\n${guidance}\n\n</writer-guidance>`));
  assert.ok(prompt.indexOf(previous) < prompt.indexOf(beat));
  assert.ok(prompt.includes('Do not reproduce, restart'));
  const next = sceneProseInstruction('## Scene 5\nLeave the house.', '', previous);
  assert.ok(!next.includes(beat));
});

test('continuity tail stays bounded without truncating the requested scene or guidance', () => {
  const prompt = sceneProseInstruction('Current scene', 'Current guidance', 'OLD START' + 'x'.repeat(17000) + 'LATEST END');
  assert.ok(!prompt.includes('OLD START'));
  assert.ok(prompt.includes('LATEST END'));
  assert.ok(prompt.includes('Current scene'));
  assert.ok(prompt.includes('Current guidance'));
});

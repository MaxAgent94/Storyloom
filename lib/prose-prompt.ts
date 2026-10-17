export function sceneProseInstruction(beat: string, guidance: string, previous: string): string {
  return [
    'Write a NEW scene to append to the existing manuscript. Return only the new scene prose.',
    'The existing manuscript below is already written and must remain unchanged. Use it only for continuity and voice. Do not reproduce, restart, summarize, or rewrite its scenes, introductions, dialogue, or revelations.',
    '<completed-manuscript-tail>',
    previous.slice(-16000) || '(The manuscript is empty.)',
    '</completed-manuscript-tail>',
    'Any other scene beats or outline passages in the background context are reference material, not additional scenes to generate.',
    '<writer-guidance>',
    guidance.trim() || '(No additional guidance.)',
    '</writer-guidance>',
    'CURRENT SCENE TO WRITE:',
    '<requested-scene-beat>',
    beat,
    '</requested-scene-beat>',
    'Render only this requested scene, following its events, word target, and the writer’s guidance. Begin with its first unwritten event after the existing manuscript ends. Do not repeat the preceding scene’s setup. Preserve supplied dialogue and author decisions. Output prose only.',
  ].join('\n\n');
}

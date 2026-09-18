import type { Project } from './domain.ts';

const collections = ['nodes', 'messages', 'proposals', 'presets'] as const;
type Item = { id: string };
export type ProjectDelta = {
  id: string;
  title: string;
  collections: Record<string, { order: string[]; changed: Item[] }>;
};

// Unchanged historical records never travel back with a routine edit.
export function projectDelta(previous: Project, next: Project): ProjectDelta {
  if (previous.id !== next.id) throw new Error('Project mismatch.');
  return {
    id: next.id, title: next.title,
    collections: Object.fromEntries(collections.map(key => {
      const old = new Map<string, Item>(previous[key].map(item => [item.id, item]));
      return [key, {
        order: next[key].map(item => item.id),
        changed: next[key].filter(item => JSON.stringify(old.get(item.id)) !== JSON.stringify(item)),
      }];
    })),
  };
}

export function applyProjectDelta(previous: Project, delta: ProjectDelta): Project {
  if (previous.id !== delta.id) throw new Error('Project mismatch.');
  const result = { ...previous, title: delta.title };
  for (const key of collections) {
    const patch = delta.collections?.[key];
    if (!patch || !Array.isArray(patch.order) || !Array.isArray(patch.changed) ||
      patch.order.some(id => typeof id !== 'string') ||
      new Set(patch.order).size !== patch.order.length ||
      patch.changed.some(item => !item || typeof item.id !== 'string'))
      throw new Error('Invalid project update.');
    const items = new Map<string, Item>(previous[key].map(item => [item.id, item]));
    for (const item of patch.changed) items.set(item.id, item);
    const ordered = patch.order.map(id => {
      const item = items.get(id);
      if (!item) throw new Error('Incomplete project update.');
      return item;
    });
    Object.assign(result, { [key]: ordered });
  }
  return result;
}

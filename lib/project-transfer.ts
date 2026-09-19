import type { Project } from './domain.ts';
import { validateProject } from './domain.ts';

const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// Three-way reconciliation: only local changes replace cloud fields. A manual
// manuscript edit wins a same-field conflict; save_project retains cloud history.
export function reconcileProject(base: Project, local: Project, cloud: Project, manual: boolean): Project {
  if (base.id !== local.id || base.id !== cloud.id) throw new Error('Project mismatch.');
  function merge(before: unknown, ours: unknown, theirs: unknown, path: string[]): unknown {
    if (equal(ours, theirs) || equal(before, theirs)) return ours;
    if (equal(before, ours)) return theirs;
    if (manual && path.length === 4 && path[0] === 'nodes' && path[2] === 'sections' && path[3] === 'manuscript'
      && typeof ours === 'string' && typeof theirs === 'string') return ours;
    if (Array.isArray(before) && Array.isArray(ours) && Array.isArray(theirs)) {
      const ids = (items: { id: string }[]) => items.map(item => item.id);
      const common = new Set(ids(before));
      // Preserve either side's reorder, but do not guess between two reorders.
      const order = (items: { id: string }[]) => ids(items).filter(id => common.has(id) && ours.some(x => x.id === id) && theirs.some(x => x.id === id));
      const oldOrder = order(before), localOrder = order(ours), cloudOrder = order(theirs);
      if (!equal(localOrder, oldOrder) && !equal(cloudOrder, oldOrder) && !equal(localOrder, cloudOrder))
        throw new Error('Both copies reordered the same items. Your local draft is still open; download a backup before resolving this conflict.');
      const primary = equal(localOrder, oldOrder) ? theirs : ours;
      const secondary = primary === ours ? theirs : ours;
      const orderedIds = [...new Set([...ids(primary), ...ids(secondary)])];
      return orderedIds.map(id => merge(before.find(x => x.id === id), ours.find(x => x.id === id), theirs.find(x => x.id === id), [...path, id])).filter(x => x !== undefined);
    }
    if (before && ours && theirs && typeof before === 'object' && typeof ours === 'object' && typeof theirs === 'object'
      && !Array.isArray(before) && !Array.isArray(ours) && !Array.isArray(theirs)) {
      const b = before as Record<string, unknown>, l = ours as Record<string, unknown>, r = theirs as Record<string, unknown>;
      return Object.fromEntries([...new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)])]
        .map(key => [key, merge(b[key], l[key], r[key], [...path, key])])
        .filter(([, value]) => value !== undefined));
    }
    throw new Error('Both copies changed the same project item. Your local draft is still open; download a backup before resolving this conflict.');
  }
  const result = merge(base, local, cloud, []);
  if (!validateProject(result)) throw new Error('Concurrent structure changes could not be combined. Your local draft is still open.');
  return result;
}

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

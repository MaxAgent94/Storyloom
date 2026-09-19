import { validateProject, type Project } from './domain.ts';
import { applyProjectDelta, type ProjectDelta } from './project-transfer.ts';

// Old full-document saves remain readable during a rolling deployment.
export function hydrateProject(body: Project, history?: Partial<Pick<Project, 'messages' | 'proposals'>>): Project {
  return { ...body, messages: body.messages ?? history?.messages ?? [], proposals: body.proposals ?? history?.proposals ?? [] };
}

// Validate the complete editable structure and each changed historical record,
// without downloading unchanged history. SQL checks historical IDs and ordering.
export function validateStoredDelta(body: Project, delta: ProjectDelta): void {
  const collections = { ...delta.collections };
  for (const key of ['messages', 'proposals'] as const) {
    const patch = collections[key];
    if (!patch || !Array.isArray(patch.order) || !Array.isArray(patch.changed) ||
      patch.order.some(id => typeof id !== 'string') || new Set(patch.order).size !== patch.order.length ||
      patch.changed.some(item => !item || typeof item.id !== 'string') ||
      new Set(patch.changed.map(item => item.id)).size !== patch.changed.length)
      throw new Error('Invalid project update.');
    collections[key] = { order: patch.changed.map(item => item.id), changed: patch.changed };
  }
  const candidate = applyProjectDelta({ ...body, messages: [], proposals: [] }, { ...delta, collections });
  if (!validateProject(candidate)) throw new Error('Invalid project structure.');
}

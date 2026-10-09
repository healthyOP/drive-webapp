import { ApiError } from '../utils/errors.js';
import { validateId } from '../utils/safePath.js';

export const MAX_DEPTH = 20;
const rank = { viewer: 1, editor: 2, owner: 3 };
export function permissionContext(repo, uid) {
  const cache = new Map(); // Request-local only; revocation takes effect next request.
  async function get(id) {
    validateId(id);
    if (!cache.has(id)) cache.set(id, await repo.get(id));
    const item = cache.get(id);
    if (!item) throw new ApiError(404, 'NOT_FOUND', 'File or folder not found.');
    return item;
  }
  async function access(id, required = 'viewer') {
    const item = await get(id);
    let role = item.ownerId === uid ? 'owner' : item.grants?.[uid]?.role;
    const ancestors = [];
    const seen = new Set([id]);
    let parentId = item.parentId;
    while (parentId) {
      if (seen.has(parentId) || ancestors.length >= MAX_DEPTH) throw new ApiError(409, 'INVALID_TREE', 'Folder nesting is invalid or too deep.');
      seen.add(parentId);
      const parent = await get(parentId);
      if (parent.ownerId !== item.ownerId || parent.kind !== 'folder') throw new ApiError(409, 'INVALID_TREE', 'Folder ownership is inconsistent.');
      ancestors.push(parent);
      const inherited = parent.grants?.[uid]?.role;
      if ((rank[inherited] || 0) > (rank[role] || 0)) role = inherited;
      parentId = parent.parentId;
    }
    if (!role) throw new ApiError(404, 'NOT_FOUND', 'File or folder not found.');
    if (rank[role] < rank[required]) throw new ApiError(403, 'PERMISSION_DENIED', 'You do not have permission for this action.');
    return { item, role, ancestors };
  }
  async function folder(id, required = 'viewer') {
    if (!id) return { item: null, ownerId: uid, role: 'owner', ancestors: [] };
    const result = await access(id, required);
    if (result.item.kind !== 'folder') throw new ApiError(400, 'NOT_A_FOLDER', 'Select a folder.');
    return { ...result, ownerId: result.item.ownerId };
  }
  return { get, access, folder };
}
export function publicItem(item, role) {
  return { id: item.id, name: item.name, parentId: item.parentId, isDirectory: item.kind === 'folder', size: item.size, mimeType: item.mimeType, modified: item.modified, created: item.created, role };
}

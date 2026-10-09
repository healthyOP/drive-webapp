import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createApp } from '../app.js';

// Test doubles are injected into createApp; production never imports this file.
export async function fixture(options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'drive-test-'));
  const storageRoot = path.join(root, 'blobs');
  const stagingRoot = path.join(root, 'incoming');
  await fs.mkdir(storageRoot); await fs.mkdir(stagingRoot);
  const docs = new Map();
  let failCommit = false;
  const repo = {
    async get(id) { return structuredClone(docs.get(id) || null); },
    async list({ ownerId, parentId, sharedUid, after, limit = 51 }) {
      return [...docs.values()].filter(i => sharedUid ? i.sharedWith.includes(sharedUid) : i.ownerId === ownerId && i.parentId === parentId)
        .sort((a, b) => a.id.localeCompare(b.id)).filter(i => !after || i.id > after).slice(0, limit).map(i => structuredClone(i));
    },
    async commit({ puts = [], deletes = [] }) {
      if (failCommit) throw new Error('Simulated database failure');
      puts.forEach(i => docs.set(i.id, structuredClone(i))); deletes.forEach(id => docs.delete(id));
    }
  };
  const auth = {
    async verifyIdToken(token, revoked) {
      if (!revoked || !['alice', 'bob', 'eve'].includes(token)) throw new Error('Invalid token');
      return { uid: token, email: token + '@example.test' };
    },
    async getUserByEmail(email) {
      const uid = email.split('@')[0];
      if (!['alice', 'bob', 'eve'].includes(uid) || email !== uid + '@example.test') throw new Error('Missing');
      return { uid, email, disabled: false, emailVerified: uid !== 'eve' };
    }
  };
  const app = createApp({ repo, auth, storageRoot, stagingRoot, clientConfig: { apiKey: 'test-only', projectId: 'demo-drive', authDomain: 'localhost' }, ...options });
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  async function request(url, { user = 'alice', method = 'GET', body, rawBody } = {}) {
    const headers = user ? { Authorization: 'Bearer ' + user } : {};
    if (body) headers['Content-Type'] = 'application/json';
    return fetch(base + '/api' + url, { method, headers, body: rawBody || (body ? JSON.stringify(body) : undefined) });
  }
  async function upload(name = 'hello.txt', parentId = null, user = 'alice', content = 'hello') {
    const form = new FormData(); form.append('files', new Blob([content]), name);
    return request('/upload' + (parentId ? '?parentId=' + parentId : ''), { user, method: 'POST', rawBody: form });
  }
  async function folder(name = 'Folder', parentId = null, user = 'alice') {
    const response = await request('/folders', { method: 'POST', user, body: { name, parentId } });
    if (response.status !== 201) throw new Error(JSON.stringify(await response.json()));
    return (await response.json()).item;
  }
  async function close() {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  }
  return { repo, docs, base, request, upload, folder, root, storageRoot, stagingRoot, close, failCommit: value => { failCommit = value; } };
}

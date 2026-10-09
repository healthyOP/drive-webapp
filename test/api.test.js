import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fixture } from './fixture.js';

async function setup(t, options) { const f = await fixture(options); t.after(() => f.close()); return f; }
async function uploaded(f, ...args) { const res = await f.upload(...args); assert.equal(res.status, 201); return (await res.json()).items[0]; }
const share = (f, id, role = 'viewer', email = 'bob@example.test') => f.request('/shares', { method: 'PUT', body: { id, email, role } });

test('all file endpoints reject missing, forged and revoked authentication', async t => {
  const f = await setup(t);
  for (const [method, url] of [['GET','/files'], ['POST','/upload'], ['GET','/download'], ['GET','/preview'], ['POST','/folders'], ['PATCH','/rename'], ['PATCH','/move'], ['DELETE','/delete'], ['GET','/shares'], ['PUT','/shares'], ['DELETE','/shares']]) {
    for (const user of [null, 'forged', 'revoked']) assert.equal((await f.request(url, { user, method })).status, 401, url);
  }
});
test('folder upload stays inside its folder and duplicates use separate disk IDs', async t => {
  const f = await setup(t); const folder = await f.folder();
  const first = await uploaded(f, 'Homework (1).txt', folder.id);
  const second = await uploaded(f, 'Homework (1).txt', folder.id);
  assert.notEqual(first.id, second.id); assert.equal(first.name, second.name);
  assert.equal((await (await f.request('/files')).json()).items.length, 1);
  const list = await (await f.request('/files?parentId=' + folder.id)).json();
  assert.equal(list.items.length, 2); assert.equal(list.breadcrumbs[0].name, 'Folder');
  assert.equal(list.items[0].storageId, undefined);
  const files = await fs.readdir(f.storageRoot);
  assert.equal(files.length, 2); assert.ok(files.every(name => !name.includes('Homework')));
});
test('Hebrew and Unicode names round-trip through upload, rename and download headers', async t => {
  const f = await setup(t); const name = 'שיעורי בית (2) café.txt';
  const item = await uploaded(f, name);
  assert.equal(item.name, name);
  const response = await f.request('/download?id=' + item.id);
  assert.equal(await response.text(), 'hello');
  assert.match(response.headers.get('content-disposition'), /filename\*=UTF-8''/);
  assert.equal(decodeURIComponent(response.headers.get('content-disposition').split("filename*=UTF-8''")[1]), name);
  const storedName = f.docs.get(item.id).storageId;
  assert.equal((await f.request('/rename', { method: 'PATCH', body: { id: item.id, newName: 'מסמך חדש.txt' } })).status, 200);
  assert.equal(f.docs.get(item.id).storageId, storedName);
});
test('users cannot list, download, preview or mutate another user private items', async t => {
  const f = await setup(t); const folder = await f.folder(); const item = await uploaded(f, 'private.txt', folder.id);
  assert.deepEqual((await (await f.request('/files', { user: 'bob' })).json()).items, []);
  for (const url of ['/files?parentId=' + folder.id, '/download?id=' + item.id, '/preview?id=' + item.id, '/shares?id=' + item.id]) assert.equal((await f.request(url, { user: 'bob' })).status, 404);
  for (const [url, method, body] of [['/rename','PATCH',{id:item.id,newName:'stolen.txt'}], ['/move','PATCH',{id:item.id,parentId:null}], ['/shares','PUT',{id:item.id,email:'eve@example.test',role:'viewer'}], ['/delete?id='+folder.id,'DELETE',undefined]]) assert.equal((await f.request(url, { user: 'bob', method, body })).status, 404);
  assert.equal((await f.upload('x.txt', folder.id, 'bob')).status, 404);
  assert.equal((await fs.readdir(f.stagingRoot)).length, 0);
});
test('viewer can read shared file, editor can rename, only owner controls deletion and sharing', async t => {
  const f = await setup(t); const item = await uploaded(f);
  assert.equal((await share(f, item.id)).status, 200);
  assert.equal((await f.request('/download?id=' + item.id, { user: 'bob' })).status, 200);
  assert.equal((await f.request('/rename', { user: 'bob', method: 'PATCH', body: { id: item.id, newName: 'edited.txt' } })).status, 403);
  await share(f, item.id, 'editor');
  assert.equal((await f.request('/rename', { user: 'bob', method: 'PATCH', body: { id: item.id, newName: 'edited.txt' } })).status, 200);
  assert.equal((await f.request('/delete?id=' + item.id, { user: 'bob', method: 'DELETE' })).status, 403);
  assert.equal((await f.request('/shares', { user: 'bob', method: 'PUT', body: { id:item.id,email:'eve@example.test',role:'viewer' } })).status, 403);
  assert.equal((await (await f.request('/files?view=shared', { user: 'bob' })).json()).items[0].name, 'edited.txt');
});
test('sharing requires recipient email verification to prevent email impersonation', async t => {
  const f=await setup(t);const item=await uploaded(f);
  const res=await share(f,item.id,'viewer','eve@example.test');
  assert.equal(res.status,400);assert.equal((await res.json()).error.code,'UNVERIFIED_RECIPIENT');
  assert.deepEqual(f.docs.get(item.id).sharedWith,[]);
});
test('inherited folder grants, hidden private ancestors, editor uploads and revocation', async t => {
  const f = await setup(t); const privateParent = await f.folder('Private ancestor'); const folder = await f.folder('Shared folder', privateParent.id);
  const nested = await f.folder('Nested', folder.id); const file = await uploaded(f, 'shared.txt', nested.id);
  await share(f, folder.id, 'editor');
  const list = await (await f.request('/files?parentId=' + nested.id, { user: 'bob' })).json();
  assert.equal(list.role, 'editor'); assert.deepEqual(list.breadcrumbs.map(c=>c.name), ['Shared folder','Nested']);
  const uploadedByBob = await uploaded(f, 'bob.txt', nested.id, 'bob');
  assert.equal(f.docs.get(uploadedByBob.id).ownerId, 'alice');
  assert.equal((await f.request('/preview?id=' + file.id, {user:'bob'})).status, 200);
  await f.request('/shares', {method:'DELETE',body:{id:folder.id,uid:'bob'}});
  assert.equal((await f.request('/download?id=' + file.id, {user:'bob'})).status, 404);
});
test('moves update parents, reject cycles and block moves into another owner drive', async t => {
  const f = await setup(t); const a = await f.folder('A'), b = await f.folder('B', a.id), item = await uploaded(f);
  assert.equal((await f.request('/move',{method:'PATCH',body:{id:a.id,parentId:b.id}})).status,400);
  assert.equal((await f.request('/move',{method:'PATCH',body:{id:item.id,parentId:a.id}})).status,200);
  assert.equal(f.docs.get(item.id).parentId,a.id);
  const bobFolder = await f.folder('Bob',null,'bob');
  assert.equal((await f.request('/move',{method:'PATCH',body:{id:item.id,parentId:bobFolder.id}})).status,404);
});
test('recursive deletion removes metadata and local contents, preserving other users', async t => {
  const f = await setup(t); const a=await f.folder(), b=await f.folder('Nested',a.id); await uploaded(f,'inside.txt',b.id);
  const other = await uploaded(f,'other.txt',null,'bob');
  assert.equal((await f.request('/delete?id='+a.id,{method:'DELETE'})).status,200);
  assert.equal(f.docs.size,1); assert.ok(f.docs.has(other.id)); assert.equal((await fs.readdir(f.storageRoot)).length,1);
});
test('database deletion failure preserves local bytes and metadata', async t => {
  const f = await setup(t); const item=await uploaded(f); f.failCommit(true);
  assert.equal((await f.request('/delete?id='+item.id,{method:'DELETE'})).status,500);
  assert.equal(f.docs.size,1); assert.equal((await fs.readdir(f.storageRoot)).length,1);
});
test('ambiguous upload commit failure retains blob for safe recovery', async t => {
  const f = await setup(t); f.failCommit(true);
  assert.equal((await f.upload()).status,500);
  assert.equal((await fs.readdir(f.storageRoot)).length,1);
  assert.equal((await fs.readdir(f.stagingRoot)).length,0);
});
test('file/count limits reject requests and clean partial uploads', async t => {
  const f = await setup(t,{maxFileSize:4});
  assert.equal((await f.upload('large.txt',null,'alice','12345')).status,413);
  assert.equal((await fs.readdir(f.storageRoot)).length,0); assert.equal((await fs.readdir(f.stagingRoot)).length,0);
  const form=new FormData(); for(let i=0;i<11;i++) form.append('files',new Blob(['x']),'a.txt');
  assert.equal((await f.request('/upload',{method:'POST',rawBody:form})).status,400);
  assert.equal((await fs.readdir(f.stagingRoot)).length,0);
});
test('exactly ten files can be uploaded together', async t => {
  const f=await setup(t);const form=new FormData();
  for(let i=0;i<10;i++) form.append('files',new Blob(['x']),'same.txt');
  const response=await f.request('/upload',{method:'POST',rawBody:form});
  assert.equal(response.status,201,await response.clone().text());
  assert.equal((await response.json()).items.length,10);
});
test('concurrent create/delete cannot leave a child in a deleted folder', async t => {
  const f=await setup(t);const parent=await f.folder();
  const results=await Promise.all([
    f.request('/delete?id='+parent.id,{method:'DELETE'}),
    f.request('/folders',{method:'POST',body:{name:'child',parentId:parent.id}})
  ]);
  assert.equal(results[0].status,200);
  assert.ok([201,404].includes(results[1].status));
  assert.equal(f.docs.size,0);
});
test('traversal, root operations, raw paths and unsafe names are rejected', async t => {
  const f=await setup(t);
  for(const id of ['../secret','..%2Fsecret','C:%5Csecret','', 'undefined']) assert.equal((await f.request('/delete?id='+id,{method:'DELETE'})).status,400);
  assert.equal((await f.request('/files?path=docs')).status,400);
  for(const name of ['../x','a/b','a\\b','bad\u0000name','..','a" onerror="alert(1)']) assert.equal((await f.request('/folders',{method:'POST',body:{name}})).status,400);
  assert.equal((await f.upload('../attack.txt')).status,400);
});
test('preview never serves uploaded executable HTML inline', async t => {
  const f=await setup(t);const item=await uploaded(f,'attack.html',null,'alice','<script>alert(1)</script>');
  const res=await f.request('/preview?id='+item.id);
  assert.match(res.headers.get('content-disposition'),/^attachment/);
  assert.match(res.headers.get('content-type'),/^application\/octet-stream/);
  assert.equal(res.headers.get('x-content-type-options'),'nosniff');
});
test('paginated listings bound results and preserve duplicate names', async t => {
  const f=await setup(t);
  const rows=Array.from({length:55},()=>({id:randomUUID(),name:'Same',kind:'folder',ownerId:'alice',parentId:null,grants:{},sharedWith:[],size:0}));
  await f.repo.commit({puts:rows});
  const first=await (await f.request('/files')).json(); assert.equal(first.items.length,50); assert.ok(first.nextCursor);
  const last=await (await f.request('/files?after='+first.nextCursor)).json(); assert.equal(last.items.length,5); assert.equal(last.nextCursor,null);
  assert.equal(new Set([...first.items,...last.items].map(i=>i.id)).size,55);
});
test('overlarge recursive deletes fail before modifying data', async t => {
  const f=await setup(t);const parent=await f.folder();
  await f.repo.commit({puts:Array.from({length:200},()=>({id:randomUUID(),name:'child',kind:'file',ownerId:'alice',parentId:parent.id,grants:{},sharedWith:[]}))});
  assert.equal((await f.request('/delete?id='+parent.id,{method:'DELETE'})).status,409); assert.equal(f.docs.size,201);
});
test('missing disk files return useful errors without leaking physical paths', async t => {
  const f=await setup(t);const item=await uploaded(f);await fs.unlink(path.join(f.storageRoot,f.docs.get(item.id).storageId));
  const res=await f.request('/download?id='+item.id);assert.equal(res.status,404);
  const error=await res.json();assert.equal(error.error.code,'NOT_FOUND');assert.ok(!JSON.stringify(error).includes(f.root));
});

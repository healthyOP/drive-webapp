import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { decodeUploadName, validateName, storagePath, initializeStorage } from '../utils/safePath.js';
import { createBudget } from '../services/budget.js';
import { createLock } from '../utils/lock.js';

test('filename decoder preserves Latin-1, real Unicode and repairs multipart UTF-8',()=>{
  const hebrew='שלום (2).txt';
  assert.equal(decodeUploadName(Buffer.from(hebrew).toString('latin1')),hebrew);
  assert.equal(decodeUploadName(hebrew),hebrew);
  assert.equal(decodeUploadName('café.txt'),'café.txt');
  assert.equal(validateName('cafe\u0301.txt'),'café.txt');
  assert.throws(()=>validateName('א'.repeat(128)));
  assert.throws(()=>storagePath('/tmp','../outside'));
});
test('budget survives restart, serializes concurrent reservations and fails closed',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'budget-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const file=path.join(root,'budget.json');const limits={reads:3,writes:2,deletes:1};
  const reserve=createBudget(file,limits);
  await Promise.all([reserve({reads:1}),reserve({reads:1}),reserve({writes:2})]);
  const restarted=createBudget(file,limits);await restarted({reads:1});
  await assert.rejects(restarted({reads:1}),/budget/);await assert.rejects(restarted({writes:1}),/budget/);
  await fs.writeFile(file,'not json');await assert.rejects(restarted({reads:1}));
});
test('storage initialization rejects directory symlinks (junctions on Windows)',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'storage-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const outside=path.join(root,'outside');await fs.mkdir(outside);
  const link=path.join(root,'link');await fs.symlink(outside,link,process.platform==='win32'?'junction':'dir');
  await assert.rejects(initializeStorage(link),/symbolic link/);
});
test('mutation lock serializes actions and releases after errors',async()=>{
  const lock=createLock(),sequence=[];
  await Promise.all([lock('x',async()=>{sequence.push(1);await Promise.resolve();sequence.push(2);}),lock('x',()=>{sequence.push(3);})]);
  assert.deepEqual(sequence,[1,2,3]);
  await assert.rejects(lock('x',()=>{throw new Error('failure');}));
  assert.equal(await lock('x',()=>42),42);
});

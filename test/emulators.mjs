// Optional integration check. Start ONLY local Auth/Firestore emulators with a
// demo- project; this script never needs credentials or production Firebase.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initializeApp as initializeAdmin, deleteApp as deleteAdmin } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { createMetadata } from '../services/metadata.js';
import { createApp } from '../app.js';

process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8089';
const authOnly = process.argv.includes('--auth-only');
const admin = initializeAdmin({ projectId: 'demo-drive' });
const client = initializeApp({ projectId: 'demo-drive', apiKey: 'demo-key', authDomain: 'localhost' });
const auth = getAuth(client); connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'drive-emulator-'));
await fs.mkdir(path.join(root, 'blobs')); await fs.mkdir(path.join(root, 'incoming'));
const db = getFirestore(admin);
const repo = createMetadata(db, async () => {});
const server = createApp({ auth: getAdminAuth(admin), repo, clientConfig: {}, storageRoot: path.join(root, 'blobs'), stagingRoot: path.join(root, 'incoming') }).listen(0,'127.0.0.1');
await new Promise(resolve=>server.once('listening',resolve));
const base = 'http://127.0.0.1:'+server.address().port;
try {
  const email = 'test-'+Date.now()+'@example.test', password = 'long-test-password';
  const registration = await createUserWithEmailAndPassword(auth,email,password);
  const uid = registration.user.uid;
  const token = await registration.user.getIdToken();
  assert.equal((await getAdminAuth(admin).verifyIdToken(token,true)).uid,uid);
  await signOut(auth); assert.equal(auth.currentUser,null);
  await assert.rejects(signInWithEmailAndPassword(auth,email,'wrong-password'));
  await signInWithEmailAndPassword(auth,email,password);
  assert.equal(auth.currentUser.uid,uid);
  if (!authOnly) {
    const headers={Authorization:'Bearer '+await auth.currentUser.getIdToken(),'Content-Type':'application/json'};
    const created=await fetch(base+'/api/folders',{method:'POST',headers,body:JSON.stringify({name:'שלום',parentId:null})});
    assert.equal(created.status,201,await created.clone().text());
    const folder=(await created.json()).item;
    const list=await fetch(base+'/api/files',{headers}); assert.equal(list.status,200,await list.clone().text());
    assert.ok((await list.json()).items.some(i=>i.id===folder.id));
    const direct=await fetch('http://127.0.0.1:8089/v1/projects/demo-drive/databases/(default)/documents/items/'+folder.id,{headers:{Authorization:headers.Authorization}});
    assert.equal(direct.status,403,'Browser access must be denied by rules');
    const page=await repo.list({ownerId:uid,parentId:null,after:folder.id,limit:51}); assert.deepEqual(page,[]);
    const deleted=await fetch(base+'/api/delete?id='+folder.id,{method:'DELETE',headers}); assert.equal(deleted.status,200);
    console.log('Firestore emulator passed: Admin metadata write/list/cursor/delete and deny-all client rules.');
  }
  await getAdminAuth(admin).updateUser(uid,{disabled:true});
  const disabled=await fetch(base+'/api/files',{headers:{Authorization:'Bearer '+token}});
  assert.equal(disabled.status,401);
  await getAdminAuth(admin).deleteUser(uid);
  console.log('Auth emulator passed: registration, login, invalid password, logout, Admin ID verification and disabled-account rejection.');
} finally {
  server.closeAllConnections(); await new Promise(resolve=>server.close(resolve));
  await db.terminate(); await deleteApp(client); await deleteAdmin(admin); await fs.rm(root,{recursive:true,force:true});
}

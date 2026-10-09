import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { fixture } from './fixture.js';

// Real app JS and Express APIs, with only the Firebase client and browser-only
// dialog/media primitives substituted. This checks behavior, not visual layout.
test('UI registration/login/logout, folders, rename, sharing, move, preview and delete', async t => {
  const f=await fixture();t.after(()=>f.close());
  const html=await fs.readFile(new URL('../public/index.html',import.meta.url),'utf8');
  const code=(await fs.readFile(new URL('../public/app.js',import.meta.url),'utf8')).replace("import { setupAuth } from './firebase-client.js';",'');
  const dom=new JSDOM(html,{url:f.base,runScripts:'outside-only'});t.after(()=>dom.window.close());
  const w=dom.window, d=w.document;
  w.fetch=(url,options)=>fetch(new URL(url,f.base),options);
  w.URL.createObjectURL=()=> 'blob:test';w.URL.revokeObjectURL=()=>{};
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  w.HTMLDialogElement.prototype.close=function(){if(this.open){this.open=false;this.dispatchEvent(new w.Event('close'));}};
  w.setupAuth=async(config,callback)=>{
    callback(null);
    const enter=async email=>{const uid=email.split('@')[0];callback({email,getIdToken:async()=>uid});};
    return{register:enter,login:enter,logout:async()=>callback(null)};
  };
  const $=id=>d.getElementById(id);
  async function until(predicate){const end=Date.now()+4000;while(!predicate()){if(Date.now()>end)throw new Error('UI timed out: '+predicate+'; '+$('dialog-error').textContent+'; '+$('folder-error').textContent+'; preview: '+$('preview-content').textContent+'; toast: '+$('toast').textContent);await new Promise(r=>setTimeout(r,10));}}
  const click=id=>$(id).click();
  const submit=()=> $('action-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  const item=name=>[...d.querySelectorAll('.file-item')].find(el=>el.querySelector('.file-name').textContent===name);
  const action=async(name,label)=>{[...item(name).querySelectorAll('button')].find(el=>el.textContent===label).click();await until(()=>$('action-dialog').open);};
  const login=async(email,register=false)=>{ $('email').value=email;$('password').value='password123';if(register)click('register-button');else $('auth-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await until(()=>!$('drive-panel').classList.contains('hidden')&&$('loading').classList.contains('hidden'));};
  await w.eval('(async()=>{'+code+'})()');
  await login('alice@example.test',true);
  click('new-folder-button');$('dialog-fields').querySelector('input').value='לימודים';submit();
  await until(()=>!!item('לימודים'));item('לימודים').querySelector('.file-name').click();
  await until(()=>$('breadcrumbs').textContent.includes('לימודים'));
  const folder=[...f.docs.values()].find(i=>i.name==='לימודים');
  await f.upload('Notes.txt',folder.id,'alice','<img src=x onerror=alert(1)>');
  click('refresh-button');await until(()=>!!item('Notes.txt'));
  await action('Notes.txt','Rename');$('dialog-fields').querySelector('input').value='שלום.txt';submit();await until(()=>!!item('שלום.txt'));
  item('שלום.txt').querySelector('.file-name').click();await until(()=>!!d.querySelector('.preview-text'));
  assert.equal(d.querySelector('.preview-text').textContent,'<img src=x onerror=alert(1)>');
  assert.equal($('preview-content').querySelector('img'),null);click('preview-close');
  await action('שלום.txt','Share');
  $('dialog-fields').querySelector('input').value='bob@example.test';submit();await until(()=>!$('action-dialog').open);
  await action('שלום.txt','Move');await until(()=>!$('dialog-submit').disabled);submit();
  await until(()=>!$('action-dialog').open&&!item('שלום.txt'));
  click('home-button');await until(()=>!!item('שלום.txt'));
  click('logout-button');await until(()=>!$('auth-panel').classList.contains('hidden'));
  assert.equal(d.querySelectorAll('.file-item').length,0);
  await login('bob@example.test');assert.equal(d.querySelectorAll('.file-item').length,0);
  click('shared-button');await until(()=>!!item('שלום.txt'));
  assert.equal([...item('שלום.txt').querySelectorAll('button')].some(b=>b.textContent==='Rename'),false);
  click('logout-button');await until(()=>!$('auth-panel').classList.contains('hidden'));
  await login('alice@example.test');await until(()=>!!item('שלום.txt'));
  await action('שלום.txt','Delete');submit();await until(()=>!$('action-dialog').open&&!item('שלום.txt'));
  assert.equal([...f.docs.values()].filter(i=>i.kind==='file').length,0);
});

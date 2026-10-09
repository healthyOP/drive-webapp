import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fixture } from './fixture.js';

// By default Playwright launches Chromium. CDP is useful in restricted desktop
// environments where the browser must be launched by the host separately.
const browser = process.env.DRIVE_TEST_CDP
  ? await chromium.connectOverCDP(process.env.DRIVE_TEST_CDP)
  : await chromium.launch({ headless: true });
const f = await fixture();
const errors = [];
const screenshots = process.env.DRIVE_TEST_SCREENSHOTS || 'test-results';
await fs.mkdir(screenshots, { recursive: true });
const authMock = `export async function setupAuth(config, callback) {
  callback(null);
  const enter = async email => { const uid=email.split('@')[0]; callback({email,getIdToken:async()=>uid}); };
  return {login:enter,register:enter,logout:async()=>callback(null)};
}`;
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
await context.route('**/firebase-client.js', route => route.fulfill({contentType:'text/javascript',body:authMock}));
const page = await context.newPage();
page.on('pageerror',error=>errors.push(error.message));
async function waitFiles() { await page.locator('#loading').waitFor({state:'hidden'}); }
async function login(email, register = false) {
  await page.getByLabel('Email',{exact:true}).fill(email);
  await page.getByLabel('Password',{exact:true}).fill('password123');
  await page.getByRole('button',{name:register?'Create account':'Log in',exact:true}).click();
  await page.locator('#drive-panel').waitFor({state:'visible'}); await waitFiles();
}
const card = name => page.locator('.file-item').filter({has:page.getByRole('button',{name,exact:true})});
try {
  await page.goto(f.base);
  await login('alice@example.test',true);
  await page.getByRole('button',{name:'+ New folder',exact:true}).click();
  await page.getByLabel('Folder name',{exact:true}).fill('לימודים 2026');
  await page.getByRole('button',{name:'Create',exact:true}).click();
  await page.getByRole('button',{name:'לימודים 2026',exact:true}).click();
  await waitFiles();
  const filename='שיעורי בית (2) café.txt';
  await page.locator('#file-input').setInputFiles([{name:filename,mimeType:'text/plain',buffer:Buffer.from('Hello שלום')},{name:filename,mimeType:'text/plain',buffer:Buffer.from('Another file')}]);
  await page.getByText('Files uploaded.',{exact:true}).waitFor(); await waitFiles();
  assert.equal(await card(filename).count(),2);
  await card(filename).first().getByRole('button',{name:'Rename',exact:true}).click();
  await page.getByLabel('Name',{exact:true}).fill('Notes.txt');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await page.getByRole('button',{name:'Notes.txt',exact:true}).waitFor();
  await page.getByRole('button',{name:'Notes.txt',exact:true}).click();
  await page.locator('.preview-text').waitFor();
  assert.ok((await page.locator('.preview-text').textContent()).length>0);
  await page.getByRole('button',{name:'Close preview',exact:true}).click();
  const downloadPromise=page.waitForEvent('download');
  await card('Notes.txt').getByRole('button',{name:'Download',exact:true}).click();
  assert.equal((await downloadPromise).suggestedFilename(),'Notes.txt');
  await card('Notes.txt').getByRole('button',{name:'Share',exact:true}).click();
  await page.getByLabel('Account email',{exact:true}).fill('bob@example.test');
  await page.getByLabel('Permission',{exact:true}).selectOption('viewer');
  await page.locator('#dialog-submit').click(); await page.locator('#action-dialog').waitFor({state:'hidden'});await waitFiles();
  await page.screenshot({path:screenshots+'/desktop.png',fullPage:true});
  for(const width of [320,390,768,1440]) {
    await page.setViewportSize({width,height:900});
    for(const mode of ['List view','Grid view']) {
      await page.getByRole('button',{name:mode,exact:true}).click();
      const dimensions=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
      assert.ok(dimensions.scroll<=dimensions.width,'Horizontal overflow at '+width+' '+mode);
    }
  }
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:screenshots+'/mobile.png',fullPage:true});
  await page.getByRole('button',{name:'Log out',exact:true}).click();
  await page.locator('#auth-panel').waitFor({state:'visible'});
  assert.equal(await page.locator('.file-item').count(),0);
  await login('bob@example.test');
  assert.equal(await page.locator('.file-item').count(),0);
  await page.getByRole('button',{name:'♧ Shared with me',exact:true}).click();await waitFiles();
  await page.getByRole('button',{name:'Notes.txt',exact:true}).waitFor();
  assert.equal(await card('Notes.txt').getByRole('button',{name:'Delete',exact:true}).count(),0);
  assert.equal(await card('Notes.txt').getByRole('button',{name:'Rename',exact:true}).count(),0);
  await page.getByRole('button',{name:'Notes.txt',exact:true}).click();await page.locator('.preview-text').waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Log out',exact:true}).click();
  await login('alice@example.test');
  await card('לימודים 2026').getByRole('button',{name:'Delete',exact:true}).click();
  await page.locator('#dialog-submit').click();await page.locator('#action-dialog').waitFor({state:'hidden'});await waitFiles();
  assert.equal(await page.locator('.file-item').count(),0);
  assert.deepEqual(errors,[]);
  console.log('Browser workflows passed: auth UI (stubbed), folder navigation, Unicode/duplicate upload, rename, preview, download, sharing, logout, recursive deletion; no overflow at 320/390/768/1440px in grid/list views.');
} finally { await context.close(); await browser.close(); await f.close(); }

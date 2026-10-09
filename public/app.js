import { setupAuth } from './firebase-client.js';

const $ = id => document.getElementById(id);
let currentUser = null;
let authActions;
let currentFolder = null;
let currentItems = [];
let crumbs = [];
let view = 'mine';
let folderRole = 'owner';
let nextCursor = null;
let searchText = '';
let sortType = 'name';
let loadVersion = 0;
let sessionVersion = 0;
let uploadBusy = false;
let activeUpload;
let previewUrl;
let previewVersion = 0;
let config;
const actionDialog = $('action-dialog');
const previewModal = $('preview-modal');
const fileContainer = $('file-container');

function showToast(message) {
  $('toast').textContent = message;
  $('toast').classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => $('toast').classList.remove('show'), 5000);
}
async function errorMessage(response) {
  try { const data = await response.json(); return data.error?.message || 'Request failed.'; }
  catch { return 'The server could not complete this request (' + response.status + ').'; }
}
async function request(url, options = {}) {
  const user = currentUser;
  if (!user) throw new Error('Log in to continue.');
  const token = await user.getIdToken();
  const headers = { Authorization: 'Bearer ' + token, ...options.headers };
  if (options.body && !(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  let response;
  try { response = await fetch(url, { ...options, headers, cache: 'no-store' }); }
  catch { throw new Error('Could not connect to the drive server. Check your connection.'); }
  if (currentUser !== user) throw new Error('Your account changed. Please try again.');
  if (!response.ok) throw new Error(await errorMessage(response));
  return response;
}
const json = async (url, options) => (await request(url, options)).json();
const write = (url, method, body) => json(url, { method, body: JSON.stringify(body) });
const run = action => Promise.resolve().then(action).catch(err => showToast(err.message));

function button(label, action, className = '') {
  const el = document.createElement('button');
  el.type = 'button'; el.textContent = label; el.className = className;
  el.addEventListener('click', event => { event.stopPropagation(); run(action); });
  return el;
}
function field(label, type = 'text', value = '') {
  const wrapper = document.createElement('label');
  wrapper.textContent = label;
  const input = document.createElement('input');
  input.type = type; input.value = value; input.required = true;
  wrapper.append(input); $('dialog-fields').append(wrapper);
  return input;
}
function openDialog(title, description, label, build, submit) {
  actionDialog.close();
  $('dialog-title').textContent = title;
  $('dialog-description').textContent = description;
  $('dialog-fields').replaceChildren();
  $('dialog-error').textContent = '';
  $('dialog-submit').textContent = label;
  $('dialog-submit').disabled = false;
  build();
  $('action-form').onsubmit = async event => {
    event.preventDefault();
    $('dialog-submit').disabled = true;
    const session = sessionVersion;
    try {
      await submit();
      if (session !== sessionVersion) return;
      actionDialog.close();
      await loadDirectory(currentFolder, view);
    } catch (err) { if (session === sessionVersion) $('dialog-error').textContent = err.message; }
    finally { $('dialog-submit').disabled = false; }
  };
  actionDialog.showModal();
}
$('dialog-cancel').onclick = () => actionDialog.close();

async function loadDirectory(folderId = null, newView = 'mine', append = false) {
  if (!currentUser) return;
  const version = ++loadVersion;
  $('loading').classList.remove('hidden');
  $('load-more').disabled = true;
  $('folder-error').textContent = '';
  if (!append) {
    folderRole = 'viewer';
    currentItems = []; fileContainer.replaceChildren(); $('empty-message').classList.add('hidden');
    $('load-more').classList.add('hidden');
    $('new-folder-button').disabled = true; $('upload-button').disabled = true;
  }
  const query = new URLSearchParams();
  if (folderId) query.set('parentId', folderId);
  if (newView === 'shared') query.set('view', 'shared');
  if (append && nextCursor) query.set('after', nextCursor);
  try {
    const data = await json('/api/files?' + query);
    if (version !== loadVersion) return;
    currentFolder = data.parentId; view = newView; folderRole = data.role;
    crumbs = data.breadcrumbs; nextCursor = data.nextCursor;
    currentItems = append ? [...currentItems, ...data.items] : data.items;
    $('load-more').classList.toggle('hidden', !nextCursor);
    const writable = view !== 'shared' && folderRole !== 'viewer';
    $('new-folder-button').disabled = !writable;
    $('upload-button').disabled = !writable || uploadBusy;
    $('folder-hint').textContent = view === 'shared'
      ? 'Files and folders shared directly with you. Open a shared folder to see its contents.'
      : folderRole === 'viewer' ? 'You have view-only access to this folder.'
      : 'Drop files here to upload · Search and sort apply to loaded files';
    $('home-button').classList.toggle('active', view === 'mine');
    $('shared-button').classList.toggle('active', view === 'shared' || folderRole !== 'owner');
    renderBreadcrumbs(); renderFiles();
  } catch (err) {
    if (version === loadVersion) $('folder-error').textContent = err.message;
  } finally {
    if (version === loadVersion) { $('loading').classList.add('hidden'); $('load-more').disabled = false; }
  }
}
function renderBreadcrumbs() {
  $('breadcrumbs').replaceChildren(button(view === 'shared' || folderRole !== 'owner' ? 'Shared with me' : 'My files',
    () => loadDirectory(null, folderRole !== 'owner' ? 'shared' : view)));
  for (const crumb of crumbs) {
    const sep = document.createElement('span'); sep.textContent = ' / ';
    const el = button(crumb.name, () => loadDirectory(crumb.id)); el.dir = 'auto';
    $('breadcrumbs').append(sep, el);
  }
  $('back-button').disabled = !currentFolder;
}
function renderFiles() {
  const items = currentItems.filter(item => item.name.toLocaleLowerCase().includes(searchText.toLocaleLowerCase()));
  items.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    if (sortType === 'size') return b.size - a.size;
    if (sortType === 'date') return new Date(b.modified) - new Date(a.modified);
    return a.name.localeCompare(b.name);
  });
  fileContainer.replaceChildren(...items.map(createFileElement));
  $('empty-message').classList.toggle('hidden', items.length > 0);
  $('empty-message').textContent = searchText ? 'No matching loaded files. Try another search or load more files.'
    : view === 'shared' ? 'Nothing shared yet. Ask a file owner to share with your account email.'
    : 'This folder is empty. Upload a file or create a folder to get started.';
}
function createFileElement(item) {
  const el = document.createElement('article'); el.className = 'file-item';
  const icon = document.createElement('div'); icon.className = 'file-icon'; icon.textContent = getFileIcon(item); icon.setAttribute('aria-hidden', 'true');
  const name = button(item.name, () => item.isDirectory ? loadDirectory(item.id) : previewFile(item), 'file-name');
  name.dir = 'auto'; name.title = item.name;
  const info = document.createElement('div'); info.className = 'file-info';
  info.textContent = (item.isDirectory ? 'Folder' : formatFileSize(item.size)) + ' · ' + item.role;
  const actions = document.createElement('div'); actions.className = 'file-buttons';
  if (!item.isDirectory) actions.append(button('Download', () => downloadItem(item)));
  if (item.role !== 'viewer') actions.append(button('Rename', () => renameItem(item)));
  if (item.role === 'owner') {
    actions.append(button('Move', () => moveItem(item)), button('Share', () => shareItem(item)), button('Delete', () => deleteItem(item), 'danger'));
  }
  el.append(icon, name, info, actions);
  return el;
}
function getExtension(name) { const index = name.lastIndexOf('.'); return index < 0 ? '' : name.substring(index).toLowerCase(); }
function getFileIcon(item) {
  if (item.isDirectory) return '📁';
  const extension = getExtension(item.name);
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(extension)) return '🖼️';
  if (extension === '.pdf') return '📕';
  if (['.mp3', '.wav', '.ogg'].includes(extension)) return '🎵';
  if (['.mp4', '.webm'].includes(extension)) return '🎬';
  if (['.js', '.css', '.html', '.json'].includes(extension)) return '📜';
  return '📄';
}
function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return (bytes / 1024 / 1024 / 1024).toFixed(1) + ' GB';
}
function createFolder() {
  let input;
  openDialog('New folder', 'Create a folder in the current location.', 'Create', () => { input = field('Folder name'); },
    () => write('/api/folders', 'POST', { parentId: currentFolder, name: input.value }));
}
function renameItem(item) {
  let input;
  openDialog('Rename', 'Duplicate names are allowed. Each file stays separate.', 'Save',
    () => { input = field('Name', 'text', item.name); },
    () => write('/api/rename', 'PATCH', { id: item.id, newName: input.value }));
}
function deleteItem(item) {
  openDialog('Delete ' + item.name + '?', item.isDirectory
    ? 'This permanently deletes this folder and everything inside it (up to 200 items).'
    : 'This permanently deletes the file for you and everyone it is shared with.', 'Delete', () => {}, async () => {
    const result = await json('/api/delete?id=' + encodeURIComponent(item.id), { method: 'DELETE' });
    showToast(result.cleanupPending ? 'Access removed. Ask the server owner to check local cleanup.' : 'Deleted.');
  });
}
function moveItem(item) {
  let destination = null;
  let pickerVersion = 0;
  const loadChoices = async (id, trail = [], after = null) => {
    const version = ++pickerVersion;
    const data = await json('/api/files?' + new URLSearchParams({ ...(id ? { parentId: id } : {}), ...(after ? { after } : {}) }));
    if (version !== pickerVersion || !actionDialog.open) return;
    destination = id;
    const container = $('dialog-fields');
    if (!after) {
      container.replaceChildren();
      const heading = document.createElement('p'); heading.textContent = 'Destination: My files' + trail.map(c => ' / ' + c.name).join('');
      container.append(heading);
      container.append(button('My files', () => loadChoices(null)));
      if (trail.length) container.append(button('Up', () => loadChoices(trail.at(-2)?.id || null, trail.slice(0, -1))));
    } else container.querySelector('.picker-more')?.remove();
    for (const folder of data.items.filter(row => row.isDirectory && row.id !== item.id)) {
      container.append(button('📁 ' + folder.name, () => loadChoices(folder.id, [...trail, folder]), 'folder-choice'));
    }
    if (data.nextCursor) container.append(button('Load more folders', () => loadChoices(id, trail, data.nextCursor), 'picker-more'));
    $('dialog-submit').disabled = false;
  };
  openDialog('Move ' + item.name, 'Choose a destination. Inherited access changes with the destination; direct shares stay.', 'Move here',
    () => {}, () => write('/api/move', 'PATCH', { id: item.id, parentId: destination }));
  $('dialog-submit').disabled = true;
  run(() => loadChoices(null));
}
async function shareItem(item) {
  let email, role;
  const data = await json('/api/shares?id=' + encodeURIComponent(item.id));
  openDialog('Share ' + item.name, 'The recipient must have an account with a verified email. Folder access applies to its contents. Editors can upload, create folders and rename; owners control sharing, moving and deletion.', 'Share',
    () => {
      email = field('Account email', 'email');
      const label = document.createElement('label'); label.textContent = 'Permission';
      role = document.createElement('select');
      for (const value of ['viewer', 'editor']) { const option = document.createElement('option'); option.value = value; option.textContent = value === 'viewer' ? 'Viewer' : 'Editor'; role.append(option); }
      label.append(role); $('dialog-fields').append(label);
      for (const share of data.shares) {
        const row = document.createElement('div'); row.className = 'share-row';
        const text = document.createElement('span'); text.textContent = share.email + ' · ' + share.role;
        row.append(text, button('Remove', async () => {
          await write('/api/shares', 'DELETE', { id: item.id, uid: share.uid });
          row.remove(); showToast('Direct share removed. Access inherited from another folder may still apply.');
        }));
        $('dialog-fields').append(row);
      }
    }, async () => { await write('/api/shares', 'PUT', { id: item.id, email: email.value, role: role.value }); showToast('Sharing updated.'); });
}
async function downloadItem(item) {
  const session = sessionVersion;
  const blob = await (await request('/api/download?id=' + encodeURIComponent(item.id))).blob();
  if (session !== sessionVersion) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = item.name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function closePreview() {
  previewVersion++;
  $('preview-content').replaceChildren();
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
}
previewModal.addEventListener('close', closePreview);
$('preview-close').onclick = () => previewModal.close();
async function previewFile(item) {
  closePreview();
  const version = previewVersion;
  $('preview-title').textContent = item.name;
  $('preview-content').textContent = 'Loading preview…';
  $('preview-download').onclick = () => run(() => downloadItem(item));
  if (!previewModal.open) previewModal.showModal();
  if (item.size > 20 * 1024 * 1024) { $('preview-content').textContent = 'This file is too large to preview. Use Download.'; return; }
  const ext = getExtension(item.name);
  const imageTypes = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' };
  const audioTypes = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg' };
  const videoTypes = { '.mp4': 'video/mp4', '.webm': 'video/webm' };
  const textTypes = ['.txt', '.js', '.css', '.html', '.json', '.md', '.svg', '.csv'];
  if (!imageTypes[ext] && !audioTypes[ext] && !videoTypes[ext] && ext !== '.pdf' && !textTypes.includes(ext)) {
    $('preview-content').textContent = 'Preview is unavailable for this type. Use Download to open it.'; return;
  }
  try {
    const response = await request('/api/preview?id=' + encodeURIComponent(item.id));
    const blob = await response.blob();
    if (version !== previewVersion) return;
    let el;
    if (textTypes.includes(ext)) {
      el = document.createElement('pre'); el.className = 'preview-text'; el.textContent = await blob.text();
    } else {
      previewUrl = URL.createObjectURL(new Blob([blob], { type: imageTypes[ext] || audioTypes[ext] || videoTypes[ext] || 'application/pdf' }));
      if (imageTypes[ext]) { el = document.createElement('img'); el.alt = item.name; }
      else if (audioTypes[ext]) { el = document.createElement('audio'); el.controls = true; }
      else if (videoTypes[ext]) { el = document.createElement('video'); el.controls = true; }
      else { el = document.createElement('iframe'); el.title = item.name; el.setAttribute('sandbox', ''); }
      el.src = previewUrl;
    }
    if (version === previewVersion) $('preview-content').replaceChildren(el);
  } catch (err) { if (version === previewVersion) $('preview-content').textContent = err.message; }
}
async function uploadFiles(files) {
  if (!files.length) return;
  if (uploadBusy || view === 'shared' || folderRole === 'viewer' || !currentUser) throw new Error('Open a writable folder before uploading.');
  if (files.length > config.maxFiles || [...files].some(f => f.size > config.maxFileSize)) throw new Error('Upload at most 10 files, up to 100 MB each.');
  const user = currentUser, folder = currentFolder, session = sessionVersion;
  uploadBusy = true; $('upload-button').disabled = true;
  $('upload-status').classList.remove('hidden'); $('upload-progress').value = 0;
  $('upload-label').textContent = 'Uploading ' + files.length + ' file(s)…';
  const form = new FormData();
  for (const file of files) form.append('files', file, file.name);
  try {
    const token = await user.getIdToken();
    if (session !== sessionVersion) return;
    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest(); activeUpload = xhr;
      xhr.open('POST', '/api/upload' + (folder ? '?parentId=' + encodeURIComponent(folder) : ''));
      xhr.setRequestHeader('Authorization', 'Bearer ' + token);
      xhr.timeout = 5 * 60 * 1000;
      xhr.upload.onprogress = event => {
        if (event.lengthComputable) $('upload-progress').value = event.loaded / event.total * 100;
        if (event.loaded === event.total) $('upload-label').textContent = 'Saving files…';
      };
      xhr.onerror = () => reject(new Error('Connection lost. Refresh before retrying: the server may have saved the files.'));
      xhr.ontimeout = () => reject(new Error('Upload timed out. Refresh before retrying.'));
      xhr.onabort = () => reject(new Error('Upload cancelled.'));
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else {
          let message = 'Upload failed. Refresh before retrying.';
          try { message = JSON.parse(xhr.responseText).error.message; } catch {}
          reject(new Error(message));
        }
      };
      xhr.send(form);
    });
    if (session === sessionVersion) {
      showToast('Files uploaded.');
      if (currentFolder === folder) await loadDirectory(currentFolder, view);
    }
  } finally {
    activeUpload = null; uploadBusy = false;
    $('upload-status').classList.add('hidden');
    $('upload-button').disabled = view === 'shared' || folderRole === 'viewer';
  }
}
$('home-button').onclick = () => loadDirectory();
$('shared-button').onclick = () => loadDirectory(null, 'shared');
$('back-button').onclick = () => loadDirectory(crumbs.at(-2)?.id || null, crumbs.length <= 1 && folderRole !== 'owner' ? 'shared' : 'mine');
$('refresh-button').onclick = () => loadDirectory(currentFolder, view);
$('load-more').onclick = () => loadDirectory(currentFolder, view, true);
$('new-folder-button').onclick = createFolder;
$('upload-button').onclick = () => $('file-input').click();
$('file-input').onchange = event => { const files = [...event.target.files]; event.target.value = ''; run(() => uploadFiles(files)); };
$('search-input').oninput = event => { searchText = event.target.value.trim(); renderFiles(); };
$('sort-select').onchange = event => { sortType = event.target.value; renderFiles(); };
for (const mode of ['grid', 'list']) $(mode + '-view-button').onclick = () => {
  fileContainer.classList.toggle('list-view', mode === 'list');
  for (const value of ['grid', 'list']) { $(value + '-view-button').classList.toggle('active', mode === value); $(value + '-view-button').setAttribute('aria-pressed', String(mode === value)); }
};
$('drop-zone').ondragover = event => { event.preventDefault(); };
$('drop-zone').ondrop = event => { event.preventDefault(); run(() => uploadFiles([...event.dataTransfer.files])); };
$('logout-button').onclick = () => run(() => authActions.logout());
$('verify-email-button').onclick = () => run(async () => {
  const button = $('verify-email-button');
  button.disabled = true;
  try { await authActions.verifyEmail(); showToast('Verification email sent. Follow its link, then log out and log in again.'); }
  catch (err) { throw new Error(authError(err)); }
  finally { setTimeout(() => { button.disabled = false; }, 60000); }
});
function authError(err) {
  const messages = {
    'auth/invalid-credential': 'Email or password is incorrect.',
    'auth/email-already-in-use': 'An account already uses this email. Try logging in.',
    'auth/weak-password': 'Use a stronger password (at least 6 characters).',
    'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
    'auth/network-request-failed': 'Could not reach Firebase. Check your internet connection.',
    'auth/operation-not-allowed': 'Email/password sign-in must be enabled in Firebase Console.',
    'auth/invalid-api-key': 'The server owner needs to check the Firebase client configuration.',
    'auth/unauthorized-domain': 'The server owner needs to authorize this hostname in Firebase.'
  };
  return messages[err.code] || 'Could not sign in. Check your details and Firebase configuration.';
}
async function submitAuth(register) {
  if (!$('auth-form').reportValidity()) return;
  $('auth-error').textContent = '';
  $('login-button').disabled = true; $('register-button').disabled = true;
  try { await authActions[register ? 'register' : 'login']($('email').value.trim(), $('password').value); }
  catch (err) { $('auth-error').textContent = authError(err); }
  finally { $('login-button').disabled = false; $('register-button').disabled = false; }
}
$('auth-form').onsubmit = event => { event.preventDefault(); run(() => submitAuth(false)); };
$('register-button').onclick = () => run(() => submitAuth(true));
try {
  const response = await fetch('/api/config', { cache: 'no-store' });
  if (!response.ok) throw new Error('Could not load server configuration.');
  config = await response.json();
  authActions = await setupAuth(config.firebase, user => {
    sessionVersion++; loadVersion++; activeUpload?.abort(); actionDialog.close(); previewModal.close(); closePreview();
    currentUser = user; currentItems = []; currentFolder = null; nextCursor = null; crumbs = []; view = 'mine'; folderRole = 'owner';
    fileContainer.replaceChildren(); $('breadcrumbs').replaceChildren();
    searchText = ''; $('search-input').value = ''; $('password').value = '';
    $('auth-panel').classList.toggle('hidden', !!user); $('drive-panel').classList.toggle('hidden', !user);
    $('account-email').textContent = user?.email || '';
    $('verify-email-button').classList.toggle('hidden', !user || user.emailVerified);
    if (user) loadDirectory();
  });
  $('login-button').disabled = false; $('register-button').disabled = false;
} catch (err) { $('auth-error').textContent = 'The drive could not start. ' + err.message; }

// 云备忘录 - 主脚本

// 全局变量
let notes = [];
let currentNoteId = null;
let isAuthenticated = false;
let userEmail = '';
let autoSaveTimer = null;
let draggedItem = null;
let pendingSyncToCloud = false;
let deletedNotes = {};
let syncBaseNotes = [];
let syncInProgress = false;
let autoSyncTimer = null;
let authRetryTimer = null;
let authRetryAttempt = 0;
const authRetryDelays = [5000, 15000, 30000, 60000];
const editHistory = new Map();

// DOM 元素
const elements = {
  authSection: document.getElementById('authSection'),
  userSection: document.getElementById('userSection'),
  userEmail: document.getElementById('userEmail'),
  loginBtn: document.getElementById('loginBtn'),
  logoutBtn: document.getElementById('logoutBtn'),
  syncToCloudBtn: document.getElementById('syncToCloudBtn'),
  syncFromCloudBtn: document.getElementById('syncFromCloudBtn'),
  syncStatus: document.getElementById('syncStatus'),
  syncStatusText: document.getElementById('syncStatusText'),
  newNoteBtn: document.getElementById('newNoteBtn'),
  noteCount: document.getElementById('noteCount'),
  notesContainer: document.getElementById('notesContainer'),
  emptyState: document.getElementById('emptyState'),
  editor: document.getElementById('editor'),
  noteTitle: document.getElementById('noteTitle'),
  noteContent: document.getElementById('noteContent'),
  lastModified: document.getElementById('lastModified'),
  saveNoteBtn: document.getElementById('saveNoteBtn'),
  deleteNoteBtn: document.getElementById('deleteNoteBtn'),
  toast: document.getElementById('toast'),
  mergeDialog: document.getElementById('mergeDialog'),
  localCountSpan: document.getElementById('localCount'),
  cloudCountSpan: document.getElementById('cloudCount'),
  mergedCountSpan: document.getElementById('mergedCount'),
  conflictInfo: document.getElementById('conflictInfo'),
  mergeBtn: document.getElementById('mergeBtn'),
  mergeCancelBtn: document.getElementById('mergeCancelBtn')
};

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
  // 显示扩展ID（用于排查OAuth配置问题）
  console.log('扩展ID:', chrome.runtime.id);
  
  await loadNotes();
  renderNoteList();
  
  // 默认选中第一个笔记
  if (notes.length > 0 && !currentNoteId) {
    selectNote(notes[0].id);
  }
  
  setupEventListeners();
  await checkAuthStatus();
  if (isAuthenticated) {
    startAutoSync();
    await autoSyncFromCloud();
  }
});

// 加载笔记
async function loadNotes() {
  try {
    const result = await chrome.storage.local.get([
      'notes',
      'lastSync',
      'noteOrder',
      'deletedNotes',
      'syncBaseNotes'
    ]);
    if (result.notes && Array.isArray(result.notes)) {
      notes = MemoSync.normalizeNotes(result.notes);
      deletedNotes = MemoSync.normalizeDeletedNotes(result.deletedNotes);
      syncBaseNotes = MemoSync.normalizeNotes(result.syncBaseNotes);
      
      // 如果有保存的顺序，按顺序排序
      if (result.noteOrder && Array.isArray(result.noteOrder)) {
        const orderMap = new Map(result.noteOrder.map((id, index) => [id, index]));
        notes.sort((a, b) => {
          const orderA = orderMap.get(a.id) ?? Infinity;
          const orderB = orderMap.get(b.id) ?? Infinity;
          return orderA - orderB;
        });
      }
    } else {
      // 创建默认欢迎笔记
      notes = [{
        id: Date.now(),
        title: '欢迎使用云备忘录',
        content: '这是一个简洁的云端备忘录工具。\n\n功能特点：\n- 创建和编辑笔记\n- 自动保存到本地\n- 登录 Google 账号后可同步到云端\n- 多设备数据同步\n- 拖拽调整笔记顺序\n\n点击左上角的 + 按钮创建新笔记！\n\n拖拽笔记可以调整顺序哦~',
        createdAt: Date.now(),
        updatedAt: Date.now()
      }];
      await saveNotes();
    }
  } catch (error) {
    console.error('加载笔记失败:', error);
    notes = [];
  }
}

// 保存笔记到本地
async function saveNotes({ markModified = true } = {}) {
  try {
    // 保存笔记数据
    const data = {
      notes: MemoSync.normalizeNotes(notes),
      deletedNotes
    };
    if (markModified) data.lastModified = Date.now();
    await chrome.storage.local.set(data);
    console.log('保存成功，笔记数量:', notes.length);
  } catch (error) {
    console.error('保存笔记失败:', error);
    showToast('保存失败: ' + error.message);
    throw error; // 重新抛出错误以便上层处理
  }
}

// 保存笔记顺序
async function saveNoteOrder() {
  try {
    const noteOrder = notes.map(n => n.id);
    await chrome.storage.local.set({ noteOrder });
  } catch (error) {
    console.error('保存笔记顺序失败:', error);
  }
}

// 渲染笔记列表
function renderNoteList() {
  elements.noteCount.textContent = notes.length;
  
  if (notes.length === 0) {
    elements.notesContainer.innerHTML = '<div style="text-align: center; padding: 20px; color: #999; font-size: 12px;">暂无笔记</div>';
    return;
  }
  
  elements.notesContainer.innerHTML = notes.map((note, index) => {
    const preview = note.content.substring(0, 30).replace(/\n/g, ' ') + (note.content.length > 30 ? '...' : '');
    const date = formatDate(note.updatedAt);
    const isActive = note.id === currentNoteId;
    
    return `
      <div class="note-item ${isActive ? 'active' : ''}" data-id="${note.id}" data-index="${index}" draggable="true">
        <div class="drag-handle" title="拖拽调整顺序">⋮⋮</div>
        <div class="note-content-wrapper">
          <div class="note-item-title">${escapeHtml(note.title) || '无标题'}</div>
          <div class="note-item-preview">${escapeHtml(preview) || '无内容'}</div>
          <div class="note-item-date">${date}</div>
        </div>
      </div>
    `;
  }).join('');
  
  // 添加点击事件
  elements.notesContainer.querySelectorAll('.note-item').forEach(item => {
    item.addEventListener('click', (e) => {
      // 如果点击的是拖拽手柄，不触发选择
      if (e.target.classList.contains('drag-handle')) return;
      
      const noteId = parseInt(item.dataset.id);
      selectNote(noteId);
    });
  });
  
  // 添加拖拽事件
  setupDragAndDrop();
}

// 设置拖拽功能
function setupDragAndDrop() {
  const items = elements.notesContainer.querySelectorAll('.note-item');
  
  items.forEach(item => {
    item.addEventListener('dragstart', handleDragStart);
    item.addEventListener('dragend', handleDragEnd);
    item.addEventListener('dragover', handleDragOver);
    item.addEventListener('drop', handleDrop);
    item.addEventListener('dragenter', handleDragEnter);
    item.addEventListener('dragleave', handleDragLeave);
  });
}

function handleDragStart(e) {
  draggedItem = this;
  this.style.opacity = '0.5';
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/html', this.innerHTML);
}

function handleDragEnd(e) {
  this.style.opacity = '1';
  draggedItem = null;
  
  // 移除所有拖拽样式
  elements.notesContainer.querySelectorAll('.note-item').forEach(item => {
    item.classList.remove('drag-over');
  });
}

function handleDragOver(e) {
  if (e.preventDefault) {
    e.preventDefault();
  }
  e.dataTransfer.dropEffect = 'move';
  return false;
}

function handleDragEnter(e) {
  if (this !== draggedItem) {
    this.classList.add('drag-over');
  }
}

function handleDragLeave(e) {
  this.classList.remove('drag-over');
}

function handleDrop(e) {
  if (e.stopPropagation) {
    e.stopPropagation();
  }
  
  if (draggedItem !== this) {
    const draggedIndex = parseInt(draggedItem.dataset.index);
    const targetIndex = parseInt(this.dataset.index);
    
    // 重新排序笔记数组
    const [movedNote] = notes.splice(draggedIndex, 1);
    notes.splice(targetIndex, 0, movedNote);
    
    // 保存并重新渲染
    saveNotes();
    saveNoteOrder();
    renderNoteList();
    
    showToast('已调整顺序');
  }
  
  return false;
}

// 选择笔记
function selectNote(noteId) {
  currentNoteId = noteId;
  const note = notes.find(n => n.id === noteId);
  
  if (note) {
    elements.emptyState.classList.add('hidden');
    elements.editor.classList.remove('hidden');
    elements.noteTitle.value = note.title;
    elements.noteContent.value = note.content;
    elements.lastModified.textContent = '最后修改: ' + formatDateTime(note.updatedAt);
    editHistory.set(String(noteId), {
      undo: editHistory.get(String(noteId))?.undo || [],
      redo: [],
      lastSnapshot: { title: note.title, content: note.content }
    });
    renderNoteList(); // 更新选中状态
  }
}

// 新建笔记
function createNewNote() {
  const newNote = {
    id: Date.now(),
    title: '',
    content: '',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  
  // 新笔记添加到最前面
  notes.unshift(newNote);
  saveNotes();
  saveNoteOrder();
  selectNote(newNote.id);
  renderNoteList();
  elements.noteTitle.focus();
  showToast('创建新笔记');
}

// 保存当前笔记
async function saveCurrentNote({ markModified = true } = {}) {
  if (!currentNoteId) {
    console.warn('没有选中的笔记');
    return;
  }

  const note = notes.find(n => n.id === currentNoteId);
  if (!note) {
    console.error('找不到笔记，ID:', currentNoteId);
    showToast('保存失败: 找不到笔记');
    return;
  }

  try {
    note.title = elements.noteTitle.value.trim();
    note.content = elements.noteContent.value;
    note.updatedAt = Date.now();

    await saveNotes({ markModified });
    renderNoteList();
    elements.lastModified.textContent = '最后修改: ' + formatDateTime(note.updatedAt);
    showToast('已保存');
    console.log('笔记保存成功');
  } catch (error) {
    console.error('保存当前笔记失败:', error);
    showToast('保存失败，请查看控制台');
  }
}

// 删除当前笔记
async function deleteCurrentNote() {
  if (!currentNoteId) return;
  
  if (confirm('确定要删除这个笔记吗？')) {
    const currentIndex = notes.findIndex(n => n.id === currentNoteId);
    notes = notes.filter(n => n.id !== currentNoteId);
    deletedNotes[String(currentNoteId)] = Date.now();
    editHistory.delete(String(currentNoteId));
    await saveNotes();
    saveNoteOrder();
    
    // 删除后自动选择下一个笔记，如果没有则选择上一个
    if (notes.length > 0) {
      const nextIndex = Math.min(currentIndex, notes.length - 1);
      selectNote(notes[nextIndex].id);
    } else {
      currentNoteId = null;
      elements.editor.classList.add('hidden');
      elements.emptyState.classList.remove('hidden');
    }
    
    renderNoteList();
    showToast('已删除');
  }
}

// 自动保存
function setupAutoSave() {
  captureEditSnapshot();
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
  }
  
  autoSaveTimer = setTimeout(async () => {
    if (currentNoteId) {
      const note = notes.find(n => n.id === currentNoteId);
      if (note) {
        const newTitle = elements.noteTitle.value.trim();
        const newContent = elements.noteContent.value;
        
        if (note.title !== newTitle || note.content !== newContent) {
          note.title = newTitle;
          note.content = newContent;
          note.updatedAt = Date.now();
          await saveNotes();
          renderNoteList();
          elements.lastModified.textContent = '最后修改: ' + formatDateTime(note.updatedAt);
        }
      }
    }
  }, 1000);
}

function getCurrentEditSnapshot() {
  return {
    title: elements.noteTitle.value,
    content: elements.noteContent.value
  };
}

function captureEditSnapshot() {
  if (!currentNoteId) return;
  const key = String(currentNoteId);
  const current = getCurrentEditSnapshot();
  const history = editHistory.get(key) || { undo: [], redo: [], lastSnapshot: current };
  if (history.lastSnapshot.title !== current.title || history.lastSnapshot.content !== current.content) {
    history.undo.push(history.lastSnapshot);
    if (history.undo.length > 100) history.undo.shift();
    history.redo = [];
    history.lastSnapshot = current;
  }
  editHistory.set(key, history);
}

async function applyEditSnapshot(snapshot) {
  if (!currentNoteId || !snapshot) return;
  const note = notes.find(n => n.id === currentNoteId);
  if (!note) return;
  note.title = snapshot.title;
  note.content = snapshot.content;
  note.updatedAt = Date.now();
  elements.noteTitle.value = snapshot.title;
  elements.noteContent.value = snapshot.content;
  elements.lastModified.textContent = '最后修改: ' + formatDateTime(note.updatedAt);
  await saveNotes();
  renderNoteList();
}

async function undoEdit() {
  if (!currentNoteId) return;
  const history = editHistory.get(String(currentNoteId));
  if (!history || history.undo.length === 0) return showToast('没有可撤销的修改');
  const current = getCurrentEditSnapshot();
  history.redo.push(current);
  history.lastSnapshot = history.undo.pop();
  await applyEditSnapshot(history.lastSnapshot);
  showToast('已撤销');
}

async function redoEdit() {
  if (!currentNoteId) return;
  const history = editHistory.get(String(currentNoteId));
  if (!history || history.redo.length === 0) return showToast('没有可恢复的修改');
  const current = getCurrentEditSnapshot();
  history.undo.push(current);
  history.lastSnapshot = history.redo.pop();
  await applyEditSnapshot(history.lastSnapshot);
  showToast('已恢复');
}

// 检查登录状态
async function checkAuthStatus() {
  try {
    // 尝试获取 token（非交互模式）
    const token = await getAuthToken(false);
    
    if (token) {
      // 获取用户信息
      const userInfo = await getUserInfo(token);
      if (userInfo && userInfo.email) {
        isAuthenticated = true;
        userEmail = userInfo.email;
        clearAuthRetry();
        updateAuthUI();
        updateSyncStatus('已登录，可同步');
        return true;
      }
    }
    isAuthenticated = false;
    userEmail = '';
    updateAuthUI();
    scheduleAuthRetry();
    return false;
  } catch (error) {
    console.log('静默登录检查失败:', error);
    isAuthenticated = false;
    userEmail = '';
    updateAuthUI();
    scheduleAuthRetry();
    return false;
  }
}

// 获取授权 Token
function getAuthToken(interactive) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: interactive }, (token) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(token);
      }
    });
  });
}

// 获取用户信息
async function getUserInfo(token) {
  try {
    const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (response.ok) {
      return await response.json();
    }
  } catch (error) {
    console.error('获取用户信息失败:', error);
  }
  return null;
}

// 更新登录UI
function updateAuthUI() {
  if (isAuthenticated) {
    elements.authSection.classList.add('hidden');
    elements.userSection.classList.remove('hidden');
    elements.userEmail.textContent = userEmail;
  } else {
    elements.authSection.classList.remove('hidden');
    elements.userSection.classList.add('hidden');
  }
}

// 更新同步状态显示
function updateSyncStatus(message, type = 'normal') {
  elements.syncStatusText.textContent = message;
  elements.syncStatus.classList.remove('hidden', 'syncing', 'error');
  
  if (type === 'syncing') {
    elements.syncStatus.classList.add('syncing');
  } else if (type === 'error') {
    elements.syncStatus.classList.add('error');
  }
}

function scheduleAuthRetry() {
  if (isAuthenticated || authRetryTimer) return;
  const delay = authRetryDelays[Math.min(authRetryAttempt, authRetryDelays.length - 1)];
  authRetryAttempt += 1;
  updateSyncStatus(`未检测到登录，${Math.round(delay / 1000)} 秒后自动检查`);
  authRetryTimer = setTimeout(async () => {
    authRetryTimer = null;
    const authenticated = await checkAuthStatus();
    if (authenticated) {
      startAutoSync();
      await autoSyncFromCloud();
    }
  }, delay);
}

function clearAuthRetry() {
  if (authRetryTimer) clearTimeout(authRetryTimer);
  authRetryTimer = null;
  authRetryAttempt = 0;
}

function startAutoSync() {
  if (autoSyncTimer) return;
  autoSyncTimer = setInterval(() => autoSyncFromCloud(), 60 * 1000);
}

function stopAutoSync() {
  if (autoSyncTimer) clearInterval(autoSyncTimer);
  autoSyncTimer = null;
}

// 登录
async function login() {
  try {
    clearAuthRetry();
    updateSyncStatus('正在登录...', 'syncing');
    console.log('开始登录流程...');

    // 直接获取 token，不清理缓存
    const token = await getAuthToken(true);
    console.log('获取到 token:', token ? '成功' : '失败');

    if (token) {
      const userInfo = await getUserInfo(token);
      console.log('获取用户信息:', userInfo);

      if (userInfo && userInfo.email) {
        isAuthenticated = true;
        userEmail = userInfo.email;
        clearAuthRetry();
        updateAuthUI();
        startAutoSync();
        showToast('登录成功！');
        await autoSyncFromCloud();
        return;
      }
    }

    // 如果到这里说明没有获取到用户信息
    throw new Error('无法获取用户信息');
  } catch (error) {
    console.error('登录失败:', error);
    updateSyncStatus('登录失败', 'error');

    // 详细的错误提示
    let errorMsg = '登录失败';
    if (error.message && error.message.includes('bad client id')) {
      errorMsg = 'OAuth配置错误：client_id无效或尚未生效';
      console.error('扩展ID:', chrome.runtime.id);
      console.error('请确认：1.OAuth同意页面已发布 2.扩展ID已添加到OAuth客户端配置');
    } else if (error.message) {
      errorMsg = '登录失败: ' + error.message;
    }

    showToast(errorMsg);
    scheduleAuthRetry();
  }
}

// 退出登录
async function logout() {
  try {
    const token = await getAuthToken(false).catch(() => null);
    
    if (token) {
      // 清除缓存的 token
      await new Promise((resolve) => {
        chrome.identity.removeCachedAuthToken({ token }, () => {
          resolve();
        });
      });
    }
    
    isAuthenticated = false;
    userEmail = '';
    clearAuthRetry();
    stopAutoSync();
    updateAuthUI();
    updateSyncStatus('已退出登录');
    showToast('已退出登录');
  } catch (error) {
    console.error('退出失败:', error);
  }
}

// 检查网络连接
async function checkNetwork() {
  try {
    const response = await fetch('https://www.googleapis.com/generate_204', { 
      method: 'HEAD',
      mode: 'no-cors',
      cache: 'no-store'
    });
    return true;
  } catch (error) {
    return false;
  }
}

// 获取云端文件。每次同步都先读取云端，再合并，避免上传按钮直接覆盖云端。
async function fetchCloudState(token) {
  const query = encodeURIComponent("name='memo_backup.json' and 'appDataFolder' in parents and trashed=false");
  const searchResponse = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${query}&spaces=appDataFolder&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!searchResponse.ok) throw new Error(`读取云端文件失败（${searchResponse.status}）`);
  const searchResult = await searchResponse.json();
  const file = searchResult.files && searchResult.files[0];
  if (!file) return null;

  const fileResponse = await fetch(
    `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!fileResponse.ok) throw new Error(`下载云端数据失败（${fileResponse.status}）`);
  return { fileId: file.id, data: await fileResponse.json() };
}

async function uploadCloudState(token, envelope, fileId = null) {
  const boundary = '-------314159265358979323846';
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;
  const metadata = { name: 'memo_backup.json', mimeType: 'application/json' };
  if (!fileId) metadata.parents = ['appDataFolder'];
  const body = delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) + delimiter +
    'Content-Type: application/json\r\n\r\n' +
    JSON.stringify(envelope) + closeDelimiter;
  const response = await fetch(
    fileId
      ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`
      : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
    {
      method: fileId ? 'PATCH' : 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary="${boundary}"`
      },
      body
    }
  );
  if (!response.ok) throw new Error(`上传合并结果失败（${response.status}）`);
}

async function flushPendingEdit() {
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
    await saveCurrentNote({ markModified: false });
  }
}

function applyMergedResult(result) {
  notes = result.merged;
  deletedNotes = result.deletedNotes;
  const orderMap = new Map(result.noteOrder.map((id, index) => [String(id), index]));
  notes.sort((a, b) => (orderMap.get(String(a.id)) ?? Infinity) - (orderMap.get(String(b.id)) ?? Infinity));
}

async function performSync({ interactive = false } = {}) {
  if (!isAuthenticated) {
    if (interactive) showToast('请先登录一次 Google，之后会自动同步');
    return;
  }
  if (syncInProgress) return;
  syncInProgress = true;
  try {
    await flushPendingEdit();
    if (!(await checkNetwork())) throw new Error('网络连接失败，请稍后重试');
    if (interactive) updateSyncStatus('正在读取两端数据...', 'syncing');
    const token = await getAuthToken(false);
    const cloudState = await fetchCloudState(token);
    const cloudData = cloudState?.data || {};
    const result = MemoSync.mergeNoteSets(
      notes,
      cloudData.notes || [],
      syncBaseNotes,
      deletedNotes,
      cloudData.deletedNotes,
      notes.map(note => note.id),
      cloudData.noteOrder
    );

    if (interactive) {
      const choice = await showMergeDialog(result);
      if (choice !== 'merge') return;
    }

    applyMergedResult(result);
    await saveNotes({ markModified: false });
    await saveNoteOrder();
    const envelope = MemoSync.createEnvelope(notes, result.noteOrder, deletedNotes);
    await uploadCloudState(token, envelope, cloudState?.fileId || null);
    syncBaseNotes = MemoSync.normalizeNotes(notes);
    await chrome.storage.local.set({
      syncBaseNotes,
      lastSync: Date.now(),
      noteOrder: result.noteOrder,
      deletedNotes
    });
    pendingSyncToCloud = false;
    renderNoteList();
    if (notes.length > 0 && !notes.some(note => note.id === currentNoteId)) selectNote(notes[0].id);
    updateSyncStatus(`已合并同步 · ${notes.length} 条笔记`);
    if (interactive) showToast(`已合并同步，共 ${notes.length} 条笔记`);
  } catch (error) {
    console.error('同步失败:', error);
    pendingSyncToCloud = true;
    updateSyncStatus('同步失败，稍后自动重试', 'error');
    if (interactive) showToast('同步失败：' + error.message);
  } finally {
    syncInProgress = false;
  }
}

// 两个同步按钮都走同一条合并流程。
async function syncToCloud() {
  await performSync({ interactive: true });
}

async function syncFromCloud() {
  await performSync({ interactive: true });
}

async function autoSyncFromCloud() {
  await performSync({ interactive: false });
}

// 显示合并预览对话框
let mergeDialogResolve = null;
function showMergeDialog(result) {
  return new Promise((resolve) => {
    mergeDialogResolve = resolve;
    elements.localCountSpan.textContent = result.localCount;
    elements.cloudCountSpan.textContent = result.cloudCount;
    elements.mergedCountSpan.textContent = result.mergedCount;
    
    if (result.conflictCount > 0) {
      elements.conflictInfo.textContent = `发现 ${result.conflictCount} 处同时修改：不同内容会合并，同一段落按最新修改时间处理`;
    } else {
      elements.conflictInfo.textContent = '没有发现冲突，点击后会把两端内容合并并写回云端';
    }
    
    elements.mergeDialog.classList.remove('hidden');
  });
}

// 关闭合并对话框
function closeMergeDialog(result) {
  elements.mergeDialog.classList.add('hidden');
  if (mergeDialogResolve) {
    mergeDialogResolve(result);
    mergeDialogResolve = null;
  }
}

// 设置事件监听器
function setupEventListeners() {
  // 新建笔记
  elements.newNoteBtn.addEventListener('click', createNewNote);
  
  // 保存和删除
  elements.saveNoteBtn.addEventListener('click', saveCurrentNote);
  elements.deleteNoteBtn.addEventListener('click', deleteCurrentNote);
  
  // 自动保存
  elements.noteTitle.addEventListener('input', setupAutoSave);
  elements.noteContent.addEventListener('input', setupAutoSave);
  
  // 登录/退出
  elements.loginBtn.addEventListener('click', login);
  elements.logoutBtn.addEventListener('click', logout);
  
  // 两个按钮都执行合并，不再提供覆盖云端或覆盖本地的操作。
  elements.syncToCloudBtn.addEventListener('click', () => {
    if (!isAuthenticated) {
      showToast('请先登录');
      return;
    }
    syncToCloud();
  });
  
  // 同步到本地按钮
  elements.syncFromCloudBtn.addEventListener('click', () => {
    if (!isAuthenticated) {
      showToast('请先登录');
      return;
    }
    syncFromCloud();
  });
  
  // 合并对话框按钮
  elements.mergeBtn.addEventListener('click', () => closeMergeDialog('merge'));
  elements.mergeCancelBtn.addEventListener('click', () => closeMergeDialog('cancel'));

  // 编辑器内支持 Ctrl/Cmd + Z 和 Ctrl/Cmd + Y。
  document.addEventListener('keydown', (event) => {
    const editing = event.target === elements.noteTitle || event.target === elements.noteContent;
    if (!editing || !(event.ctrlKey || event.metaKey)) return;
    if (event.key.toLowerCase() === 'z' && !event.shiftKey) {
      event.preventDefault();
      undoEdit();
    } else if (event.key.toLowerCase() === 'y' || (event.key.toLowerCase() === 'z' && event.shiftKey)) {
      event.preventDefault();
      redoEdit();
    }
  });
}

// 显示提示
function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.remove('hidden');
  setTimeout(() => {
    elements.toast.classList.add('hidden');
  }, 2000);
}

// 格式化日期
function formatDate(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;
  
  // 今天
  if (diff < 24 * 60 * 60 * 1000 && date.getDate() === now.getDate()) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }
  
  // 昨天
  if (diff < 48 * 60 * 60 * 1000 && date.getDate() === now.getDate() - 1) {
    return '昨天';
  }
  
  // 其他日期
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

// 格式化日期时间
function formatDateTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleString('zh-CN', { 
    month: 'short', 
    day: 'numeric', 
    hour: '2-digit', 
    minute: '2-digit' 
  });
}

// HTML转义
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

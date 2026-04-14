// 云备忘录 - 主脚本

// 全局变量
let notes = [];
let currentNoteId = null;
let isAuthenticated = false;
let userEmail = '';
let autoSaveTimer = null;
let draggedItem = null;

// DOM 元素
const elements = {
  authSection: document.getElementById('authSection'),
  userSection: document.getElementById('userSection'),
  userEmail: document.getElementById('userEmail'),
  loginBtn: document.getElementById('loginBtn'),
  logoutBtn: document.getElementById('logoutBtn'),
  syncBtn: document.getElementById('syncBtn'),
  syncIcon: document.getElementById('syncIcon'),
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
  toast: document.getElementById('toast')
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
  checkAuthStatus();
});

// 加载笔记
async function loadNotes() {
  try {
    const result = await chrome.storage.local.get(['notes', 'lastSync', 'noteOrder']);
    if (result.notes && Array.isArray(result.notes)) {
      notes = result.notes;
      
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
async function saveNotes() {
  try {
    // 保存笔记数据
    await chrome.storage.local.set({ 
      notes: notes,
      lastModified: Date.now()
    });
  } catch (error) {
    console.error('保存笔记失败:', error);
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
    renderNoteList(); // 更新选中状态
  }
}

// 新建笔记
function createNewNote() {
  const newNote = {
    id: Date.now(),
    title: '',
    content: '',
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
async function saveCurrentNote() {
  if (!currentNoteId) return;
  
  const note = notes.find(n => n.id === currentNoteId);
  if (note) {
    note.title = elements.noteTitle.value.trim();
    note.content = elements.noteContent.value;
    note.updatedAt = Date.now();
    
    await saveNotes();
    renderNoteList();
    elements.lastModified.textContent = '最后修改: ' + formatDateTime(note.updatedAt);
    showToast('已保存');
  }
}

// 删除当前笔记
async function deleteCurrentNote() {
  if (!currentNoteId) return;
  
  if (confirm('确定要删除这个笔记吗？')) {
    const currentIndex = notes.findIndex(n => n.id === currentNoteId);
    notes = notes.filter(n => n.id !== currentNoteId);
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
        updateAuthUI();
        updateSyncStatus('已登录，可同步');
      }
    } else {
      updateAuthUI();
    }
  } catch (error) {
    console.log('未登录:', error);
    isAuthenticated = false;
    updateAuthUI();
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

// 登录
async function login() {
  try {
    updateSyncStatus('正在登录...', 'syncing');
    
    // 先清除可能存在的旧token（更彻底的清除）
    try {
      const oldToken = await getAuthToken(false);
      if (oldToken) {
        // 从 Chrome 缓存中移除
        await new Promise((resolve) => {
          chrome.identity.removeCachedAuthToken({ token: oldToken }, () => {
            // 同时尝试从 Google 端撤销 token
            fetch(`https://accounts.google.com/o/oauth2/revoke?token=${oldToken}`)
              .then(() => resolve())
              .catch(() => resolve());
          });
        });
      }
    } catch (e) {
      // 忽略错误
    }
    
    // 清除所有身份验证缓存
    await new Promise((resolve) => {
      chrome.identity.clearAllCachedAuthTokens(() => {
        resolve();
      });
    });
    
    // 延迟一下确保清除完成
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const token = await getAuthToken(true);
    
    if (token) {
      const userInfo = await getUserInfo(token);
      if (userInfo && userInfo.email) {
        isAuthenticated = true;
        userEmail = userInfo.email;
        updateAuthUI();
        showToast('登录成功！');
        
        // 登录后询问是否同步
        setTimeout(async () => {
          if (confirm('登录成功！是否从云端同步数据？')) {
            await syncFromCloud();
          }
        }, 500);
      }
    }
  } catch (error) {
    console.error('登录失败:', error);
    
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
    updateSyncStatus('登录失败', 'error');
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
    updateAuthUI();
    updateSyncStatus('已退出登录');
    showToast('已退出登录');
  } catch (error) {
    console.error('退出失败:', error);
  }
}

// 同步到云端
async function syncToCloud() {
  if (!isAuthenticated) {
    showToast('请先登录');
    return;
  }
  
  updateSyncStatus('正在上传...', 'syncing');
  elements.syncIcon.classList.add('syncing');
  
  try {
    const token = await getAuthToken(false);
    
    // 准备数据
    const data = {
      notes: notes,
      noteOrder: notes.map(n => n.id),
      syncTime: Date.now(),
      device: 'Chrome Extension'
    };
    
    // 搜索是否已有文件
    const searchResponse = await fetch(
      'https://www.googleapis.com/drive/v3/files?q=name=%27memo_backup.json%27+and+%27appDataFolder%27+in+parents&spaces=appDataFolder',
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    const searchResult = await searchResponse.json();
    
    // 准备 multipart 请求体
    const boundary = '-------314159265358979323846';
    const delimiter = "\r\n--" + boundary + "\r\n";
    const close_delim = "\r\n--" + boundary + "--";
    
    const metadata = {
      name: 'memo_backup.json',
      mimeType: 'application/json'
    };
    
    if (searchResult.files && searchResult.files.length > 0) {
      metadata.id = searchResult.files[0].id;
    } else {
      metadata.parents = ['appDataFolder'];
    }
    
    const multipartRequestBody =
      delimiter +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) +
      delimiter +
      'Content-Type: application/json\r\n\r\n' +
      JSON.stringify(data) +
      close_delim;
    
    const method = (searchResult.files && searchResult.files.length > 0) ? 'PATCH' : 'POST';
    const url = (searchResult.files && searchResult.files.length > 0)
      ? `https://www.googleapis.com/upload/drive/v3/files/${searchResult.files[0].id}?uploadType=multipart`
      : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
    
    const response = await fetch(url, {
      method: method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'multipart/related; boundary="' + boundary + '"'
      },
      body: multipartRequestBody
    });
    
    if (response.ok) {
      await chrome.storage.local.set({ lastSync: Date.now() });
      updateSyncStatus('同步成功');
      showToast('已同步到云端');
    } else {
      const error = await response.text();
      throw new Error(error);
    }
  } catch (error) {
    console.error('同步失败:', error);
    updateSyncStatus('同步失败', 'error');
    showToast('同步失败: ' + error.message);
  } finally {
    elements.syncIcon.classList.remove('syncing');
  }
}

// 从云端同步
async function syncFromCloud() {
  if (!isAuthenticated) {
    showToast('请先登录');
    return;
  }
  
  updateSyncStatus('正在下载...', 'syncing');
  elements.syncIcon.classList.add('syncing');
  
  try {
    const token = await getAuthToken(false);
    
    // 搜索云端文件
    const searchResponse = await fetch(
      'https://www.googleapis.com/drive/v3/files?q=name=%27memo_backup.json%27+and+%27appDataFolder%27+in+parents&spaces=appDataFolder',
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    const searchResult = await searchResponse.json();
    
    if (searchResult.files && searchResult.files.length > 0) {
      // 下载文件
      const fileResponse = await fetch(
        `https://www.googleapis.com/drive/v3/files/${searchResult.files[0].id}?alt=media`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      
      if (fileResponse.ok) {
        const data = await fileResponse.json();
        
        if (data.notes && Array.isArray(data.notes)) {
          // 合并本地和云端数据
          if (confirm(`云端有 ${data.notes.length} 条笔记，本地有 ${notes.length} 条笔记。\n\n点击"确定"用云端数据覆盖本地\n点击"取消"保留本地数据并上传`)) {
            notes = data.notes;
            
            // 恢复顺序
            if (data.noteOrder && Array.isArray(data.noteOrder)) {
              const orderMap = new Map(data.noteOrder.map((id, index) => [id, index]));
              notes.sort((a, b) => {
                const orderA = orderMap.get(a.id) ?? Infinity;
                const orderB = orderMap.get(b.id) ?? Infinity;
                return orderA - orderB;
              });
            }
            
            await saveNotes();
            saveNoteOrder();
            renderNoteList();
            
            // 默认选中第一个
            if (notes.length > 0) {
              selectNote(notes[0].id);
            }
            
            updateSyncStatus('已同步云端数据');
            showToast('已同步云端数据');
          } else {
            // 用户选择上传本地数据
            await syncToCloud();
          }
        }
      } else {
        throw new Error('下载失败');
      }
    } else {
      updateSyncStatus('云端暂无数据，将上传本地数据');
      showToast('云端暂无数据，将上传本地数据');
      await syncToCloud();
    }
  } catch (error) {
    console.error('同步失败:', error);
    updateSyncStatus('同步失败', 'error');
    showToast('同步失败: ' + error.message);
  } finally {
    elements.syncIcon.classList.remove('syncing');
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
  
  // 同步按钮 - 短按下载，长按上传
  let pressTimer;
  let isLongPress = false;
  
  const startPress = () => {
    isLongPress = false;
    pressTimer = setTimeout(() => {
      isLongPress = true;
      syncToCloud();
    }, 800);
  };
  
  const endPress = () => {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
      if (!isLongPress) {
        syncFromCloud();
      }
    }
  };
  
  elements.syncBtn.addEventListener('mousedown', startPress);
  elements.syncBtn.addEventListener('mouseup', endPress);
  elements.syncBtn.addEventListener('mouseleave', () => {
    if (pressTimer) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
  });
  
  // 触摸事件支持
  elements.syncBtn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    startPress();
  });
  elements.syncBtn.addEventListener('touchend', endPress);
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

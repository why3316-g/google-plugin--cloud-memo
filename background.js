// 云备忘录后台服务：弹窗关闭后仍负责自动合并同步。
importScripts('sync-engine.js');

let syncTimer = null;
let syncRunning = false;
let syncDirty = false;

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    const existing = await chrome.storage.local.get(['notes', 'lastSync', 'lastModified']);
    await chrome.storage.local.set({
      notes: Array.isArray(existing.notes) ? existing.notes : [],
      lastSync: existing.lastSync || null,
      lastModified: existing.lastModified || null,
      deletedNotes: {},
      syncBaseNotes: []
    });

    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: '云备忘录已安装',
      message: '登录 Google 后，笔记会自动合并同步。'
    });
  }
  chrome.alarms.create('autoSync', { periodInMinutes: 1 });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('autoSync', { periodInMinutes: 1 });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getAuthToken') {
    chrome.identity.getAuthToken({ interactive: request.interactive }, (token) => {
      if (chrome.runtime.lastError) {
        sendResponse({ error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ token });
      }
    });
    return true;
  }

  if (request.action === 'removeCachedAuthToken') {
    chrome.identity.removeCachedAuthToken({ token: request.token }, () => {
      sendResponse({ success: true });
    });
    return true;
  }
});

chrome.identity.onSignInChanged.addListener((account, signedIn) => {
  console.log('登录状态改变:', account?.id, signedIn);
  if (signedIn) scheduleAutoSync(500);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (changes.notes || changes.deletedNotes || changes.lastModified || changes.noteOrder) {
    if (syncRunning) {
      syncDirty = true;
    } else {
      scheduleAutoSync();
    }
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'autoSync') scheduleAutoSync(0);
});

function scheduleAutoSync(delay = 1500) {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    runAutoSync();
  }, delay);
}

function getAuthToken() {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve(token);
    });
  });
}

async function fetchCloudState(token) {
  const query = encodeURIComponent("name='memo_backup.json' and 'appDataFolder' in parents and trashed=false");
  const searchResponse = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${query}&spaces=appDataFolder&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!searchResponse.ok) throw new Error(`读取云端文件失败（${searchResponse.status}）`);
  const result = await searchResponse.json();
  const file = result.files && result.files[0];
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

async function runAutoSync() {
  if (syncRunning) {
    syncDirty = true;
    return;
  }
  syncRunning = true;
  syncDirty = false;
  try {
    const token = await getAuthToken();
    const state = await chrome.storage.local.get([
      'notes',
      'noteOrder',
      'deletedNotes',
      'syncBaseNotes',
      'lastModified'
    ]);
    const cloudState = await fetchCloudState(token);
    const cloudData = cloudState?.data || {};
    const merged = MemoSync.mergeNoteSets(
      state.notes || [],
      cloudData.notes || [],
      state.syncBaseNotes || [],
      state.deletedNotes || {},
      cloudData.deletedNotes || {},
      state.noteOrder || [],
      cloudData.noteOrder || []
    );

    // 弹窗或其他设备刚写入本地时，放弃本轮结果，下一轮重新读取，避免覆盖新输入。
    const latestState = await chrome.storage.local.get(['lastModified']);
    if (latestState.lastModified !== state.lastModified) {
      syncDirty = true;
      return;
    }

    const mergedNotes = MemoSync.normalizeNotes(merged.merged);
    const envelope = MemoSync.createEnvelope(mergedNotes, merged.noteOrder, merged.deletedNotes);
    await uploadCloudState(token, envelope, cloudState?.fileId || null);
    await chrome.storage.local.set({
      notes: mergedNotes,
      noteOrder: merged.noteOrder,
      deletedNotes: merged.deletedNotes,
      syncBaseNotes: mergedNotes,
      lastSync: Date.now()
    });
    console.log('自动合并同步完成:', mergedNotes.length, '条笔记');
  } catch (error) {
    // 未登录、断网和 API 临时错误都在下一次 alarm 中重试，不打扰用户。
    console.log('自动同步暂不可用:', error.message || error);
  } finally {
    syncRunning = false;
    if (syncDirty) scheduleAutoSync(500);
  }
}

// 立即创建一次定时任务，兼容已有安装未触发 onInstalled 的情况。
chrome.alarms.create('autoSync', { periodInMinutes: 1 });

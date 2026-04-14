// Background script for Cloud Memo extension

// 安装时初始化
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('云备忘录插件已安装');
    
    // 初始化存储
    chrome.storage.local.set({
      notes: [],
      lastSync: null,
      lastModified: null
    });
    
    // 显示欢迎通知
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: '云备忘录已安装',
      message: '点击扩展图标开始使用，登录 Google 账号可同步到云端！'
    });
  }
});

// 监听来自 popup 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getAuthToken') {
    chrome.identity.getAuthToken({ interactive: request.interactive }, (token) => {
      if (chrome.runtime.lastError) {
        sendResponse({ error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ token });
      }
    });
    return true; // 保持消息通道开放
  }
  
  if (request.action === 'removeCachedAuthToken') {
    chrome.identity.removeCachedAuthToken({ token: request.token }, () => {
      sendResponse({ success: true });
    });
    return true;
  }
});

// 监听登录状态变化
chrome.identity.onSignInChanged.addListener((account, signedIn) => {
  console.log('登录状态改变:', account.id, signedIn);
  
  if (signedIn) {
    // 用户登录，可以在这里执行一些初始化操作
    console.log('用户已登录');
  } else {
    // 用户退出登录
    console.log('用户已退出');
  }
});

// 定期自动同步（可选）
// 每30分钟检查一次是否需要同步
chrome.alarms.create('autoSync', { periodInMinutes: 30 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'autoSync') {
    // 这里可以实现自动同步逻辑
    // 但需要考虑用户是否已登录等因素
    console.log('自动同步检查');
  }
});

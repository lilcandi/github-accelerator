importScripts('common.js');

// ---------------- 流量/请求统计（仅本地，不上传） ----------------

let cfgCache = null;

async function getMatcher() {
  if (!cfgCache) cfgCache = await loadCfg();
  return buildAccelMatcher(cfgCache);
}

// 响应头里的 content-length → 估算流量（分块传输没有该头，不计入）
chrome.webRequest.onHeadersReceived.addListener(async details => {
  const m = await getMatcher();
  if (!matchAccel(m, details.url)) return;
  const cl = (details.responseHeaders || []).find(h => h.name.toLowerCase() === 'content-length');
  const bytes = cl ? (parseInt(cl.value, 10) || 0) : 0;
  await recordAccel(bytes, false);
}, { urls: ['<all_urls>'] }, ['responseHeaders']);

// 请求完成 → 计数
chrome.webRequest.onCompleted.addListener(async details => {
  const m = await getMatcher();
  if (!matchAccel(m, details.url)) return;
  if (details.statusCode >= 400) return;
  await recordAccel(0, true);
}, { urls: ['<all_urls>'] });

// ---------------- 自动加速：跟踪 GitHub 相关标签页 ----------------
// 任一 GitHub（或当前线路的镜像/代理）页面打开 → 启用加速；
// 全部关闭 → 自动停止（待命），并把数量写入会话存储供弹窗显示。

function githubTabPatterns(cfg) {
  const base = [
    '*://*.github.com/*',
    '*://github.com/*',
    '*://*.githubusercontent.com/*'
  ];
  const route = (cfg.routes || []).find(r => r.id === cfg.currentId);
  if (route && route.type === 'prefix') {
    try { base.push('*://' + new URL(route.prefix).hostname + '/*'); } catch (e) { /* 忽略非法前缀 */ }
  }
  if (route && route.type === 'mirror') {
    for (const [, dst] of Object.entries(route.hostMap || {})) {
      base.push('*://' + dst + '/*');
      base.push('*://*.' + dst + '/*');
    }
  }
  return base;
}

let recomputeTimer = null;
function scheduleRecompute() {
  clearTimeout(recomputeTimer);
  recomputeTimer = setTimeout(recomputeGithubTabs, 250); // 防抖：合并密集的标签页事件
}

async function recomputeGithubTabs() {
  const cfg = await loadCfg();
  try {
    const tabs = await chrome.tabs.query({ url: githubTabPatterns(cfg) });
    await chrome.storage.session.set({ ghCount: tabs.length });
  } catch (e) { /* 查询失败时沿用上次的数量 */ }
  await applyRules(cfg); // ghCount 缺省时 applyRules 自行从会话存储读取
}

chrome.tabs.onCreated.addListener(scheduleRecompute);
chrome.tabs.onRemoved.addListener(scheduleRecompute);
chrome.tabs.onReplaced.addListener(scheduleRecompute);
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.url || info.status === 'loading' || info.status === 'complete') scheduleRecompute();
});

// 线路配置变化（弹窗里切换/编辑）后：重建匹配器并重算状态
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') {
    cfgCache = null;
    scheduleRecompute();
  }
});

// ---------------- 生命周期 ----------------

// 安装 / 更新 / 重新加载扩展：按当前标签页状态应用规则与图标
chrome.runtime.onInstalled.addListener(() => recomputeGithubTabs());

// 浏览器启动：按已恢复的标签页状态应用
chrome.runtime.onStartup.addListener(() => recomputeGithubTabs());

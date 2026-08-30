// 公共配置与工具函数：被 background.js（importScripts）与弹窗（<script>）共用。
// 内置线路是第三方公共服务、可能随时间失效，可在弹窗里测速、编辑（JSON）或添加自定义线路。

const ALL_TYPES = [
  'main_frame', 'sub_frame', 'stylesheet', 'script', 'image',
  'font', 'media', 'xmlhttprequest', 'other'
];

const DEFAULT_ROUTES = [
  { id: 'direct', name: '官方直连（不加速）', type: 'direct', builtin: true },
  { id: 'ghfast', name: 'ghfast.top（加速前缀）', type: 'prefix', prefix: 'https://ghfast.top', builtin: true },
  { id: 'ghproxycom', name: 'gh-proxy.com（加速前缀）', type: 'prefix', prefix: 'https://gh-proxy.com', builtin: true },
  { id: 'moeyy', name: 'github.moeyy.xyz（加速前缀）', type: 'prefix', prefix: 'https://github.moeyy.xyz', builtin: true },
  { id: 'ghproxynet', name: 'ghproxy.net（加速前缀）', type: 'prefix', prefix: 'https://ghproxy.net', builtin: true },
  {
    id: 'kkgithub', name: 'kkgithub.com（全站镜像）', type: 'mirror', builtin: true,
    hostMap: { 'github.com': 'kkgithub.com', 'raw.githubusercontent.com': 'raw.kkgithub.com' }
  },
  {
    id: 'bgithub', name: 'bgithub.xyz（全站镜像）', type: 'mirror', builtin: true,
    hostMap: { 'github.com': 'bgithub.xyz' }
  }
];

const DEFAULT_CFG = {
  routes: DEFAULT_ROUTES,
  currentId: 'ghfast',
  autoMode: true,      // 自动加速：有 GitHub 页面时启用，全部关闭后自动停止
  accelAvatars: false, // 头像加速（部分前缀线路不支持，失败会显示占位图）
  accelAssets: false   // 页面静态资源加速（部分前缀线路不支持，失败可能影响页面样式）
};

// 「加速前缀」模式下需要重定向的目标域名/路径（flag 对应弹窗中的开关）
const PREFIX_TARGETS = [
  { regex: '^https://raw\\.githubusercontent\\.com/(.*)$', subst: '/https://raw.githubusercontent.com/\\1' },
  { regex: '^https://gist\\.githubusercontent\\.com/(.*)$', subst: '/https://gist.githubusercontent.com/\\1' },
  { regex: '^https://gist\\.github\\.com/([^/]+/[0-9a-f]+/raw/.*)$', subst: '/https://gist.github.com/\\1' },
  { regex: '^https://codeload\\.github\\.com/(.*)$', subst: '/https://codeload.github.com/\\1' },
  { regex: '^https://github\\.com/([^/]+/[^/]+/releases/download/.*)$', subst: '/https://github.com/\\1' },
  { regex: '^https://github\\.com/([^/]+/[^/]+/archive/.*)$', subst: '/https://github.com/\\1' },
  { regex: '^https://github\\.com/([^/]+/[^/]+/raw/.*)$', subst: '/https://github.com/\\1' },
  { regex: '^https://objects\\.githubusercontent\\.com/(.*)$', subst: '/https://objects.githubusercontent.com/\\1' },
  { regex: '^https://avatars\\.githubusercontent\\.com/(.*)$', subst: '/https://avatars.githubusercontent.com/\\1', flag: 'accelAvatars' },
  { regex: '^https://github\\.githubassets\\.com/(.*)$', subst: '/https://github.githubassets.com/\\1', flag: 'accelAssets' }
];

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function defaultCfg() {
  return JSON.parse(JSON.stringify(DEFAULT_CFG));
}

// ---------------- 统计（chrome.storage.session：浏览器会话内有效） ----------------
// stats = { dayKey, bytes, requests, samples:[{t(秒), b(字节)}], enabledAt }

function todayKey() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function emptyStats(keep) {
  return { dayKey: todayKey(), bytes: 0, requests: 0, samples: [], enabledAt: (keep && keep.enabledAt) || null };
}

async function getStats() {
  const { stats } = await chrome.storage.session.get('stats');
  let s = stats;
  if (!s || typeof s !== 'object' || s.dayKey !== todayKey()) s = emptyStats(s);
  if (!Array.isArray(s.samples)) s.samples = [];
  return s;
}

async function saveStats(s) {
  await chrome.storage.session.set({ stats: s });
}

// 累计一次经加速线路的流量/请求
async function recordAccel(bytes, countReq) {
  const s = await getStats();
  if (bytes > 0) {
    s.bytes += bytes;
    const t = Math.floor(Date.now() / 1000);
    const last = s.samples[s.samples.length - 1];
    if (last && last.t === t) last.b += bytes;
    else s.samples.push({ t, b: bytes });
    if (s.samples.length > 180) s.samples = s.samples.slice(-120);
  }
  if (countReq) s.requests++;
  await saveStats(s);
}

async function resetStats() {
  const s = await getStats();
  await saveStats(emptyStats(s));
}

// ---------------- 规则构建 ----------------

// 按当前线路构建 declarativeNetRequest 动态规则
function buildRules(cfg) {
  const route = (cfg.routes || []).find(r => r.id === cfg.currentId);
  if (!route || route.type === 'direct') return [];

  if (route.type === 'prefix') {
    const prefix = (route.prefix || '').replace(/\/+$/, '');
    if (!/^https:\/\//.test(prefix)) return [];
    return PREFIX_TARGETS
      .filter(t => !t.flag || cfg[t.flag])
      .map((t, i) => ({
        id: i + 1,
        priority: 1,
        condition: { regexFilter: t.regex, resourceTypes: ALL_TYPES },
        action: { type: 'redirect', redirect: { regexSubstitution: prefix + t.subst } }
      }));
  }

  if (route.type === 'mirror') {
    return Object.entries(route.hostMap || {}).map(([src, dst], i) => ({
      id: i + 1,
      priority: 1,
      condition: {
        regexFilter: '^https://(?:www\\.)?' + escapeRegex(src) + '(/|$)',
        resourceTypes: ALL_TYPES
      },
      action: { type: 'redirect', redirect: { transform: { scheme: 'https', host: dst } } }
    }));
  }

  return [];
}

// 构建用于「判断请求是否走了加速线路」的匹配器（统计用）
function buildAccelMatcher(cfg) {
  const route = (cfg.routes || []).find(r => r.id === cfg.currentId);
  if (!route || route.type === 'direct') return null;
  const m = { regexes: [], hosts: new Set() };
  if (route.type === 'prefix') {
    try { m.hosts.add(new URL(route.prefix).hostname); } catch (e) { /* 忽略非法前缀 */ }
    PREFIX_TARGETS.filter(t => !t.flag || cfg[t.flag]).forEach(t => m.regexes.push(new RegExp(t.regex)));
  } else {
    for (const [src, dst] of Object.entries(route.hostMap || {})) {
      m.regexes.push(new RegExp('^https://(?:www\\.)?' + escapeRegex(src) + '(/|$)'));
      m.hosts.add(dst);
    }
  }
  return m;
}

function matchAccel(m, url) {
  if (!m) return false;
  for (const re of m.regexes) { if (re.test(url)) return true; }
  try { return m.hosts.has(new URL(url).hostname); } catch (e) { return false; }
}

// ---------------- 配置读写 ----------------

async function loadCfg() {
  const data = await chrome.storage.local.get(['routes', 'currentId', 'autoMode', 'accelAvatars', 'accelAssets']);
  if (!Array.isArray(data.routes) || data.routes.length === 0) return defaultCfg();
  return {
    routes: data.routes,
    currentId: data.currentId || 'direct',
    autoMode: data.autoMode === undefined ? true : !!data.autoMode,
    accelAvatars: !!data.accelAvatars,
    accelAssets: !!data.accelAssets
  };
}

async function saveCfg(cfg) {
  await chrome.storage.local.set({
    routes: cfg.routes,
    currentId: cfg.currentId,
    autoMode: !!cfg.autoMode,
    accelAvatars: !!cfg.accelAvatars,
    accelAssets: !!cfg.accelAssets
  });
}

// 计算当前有效状态：autoMode 下没有 GitHub 标签页时为「待命」（不加速）
function effectiveRoute(cfg, ghCount) {
  const route = (cfg.routes || []).find(r => r.id === cfg.currentId);
  const isAccelRoute = !!(route && route.type !== 'direct');
  const standby = !!(cfg.autoMode && isAccelRoute && (ghCount | 0) === 0);
  return { route, isAccelRoute, standby, on: isAccelRoute && !standby };
}

// 应用规则 + 动态图标（加速=绿色闪电 / 待命与直连=黑色闪电）+ 启用时长
// cfg.ghCount 未提供时自动从会话存储读取（由 background 的标签页跟踪维护）
async function applyRules(cfg) {
  let ghCount = cfg.ghCount;
  if (ghCount === undefined) {
    const d = await chrome.storage.session.get('ghCount');
    ghCount = d.ghCount | 0;
  }

  const { route, standby, on } = effectiveRoute(cfg, ghCount);
  const effCfg = standby ? Object.assign({}, cfg, { currentId: 'direct' }) : cfg;

  const removeRuleIds = Array.from({ length: 100 }, (_, i) => i + 1);
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds,
    addRules: buildRules(effCfg)
  });

  const variant = on ? 'green' : 'dark';
  try {
    await chrome.action.setIcon({
      path: {
        16: `icons/icon-${variant}-16.png`,
        32: `icons/icon-${variant}-32.png`,
        48: `icons/icon-${variant}-48.png`,
        128: `icons/icon-${variant}-128.png`
      }
    });
    let title;
    if (on) title = `GitHub 加速器 · 加速中：${route.name}`;
    else if (standby) title = `GitHub 加速器 · 待命：打开 GitHub 自动加速（${route.name}）`;
    else title = 'GitHub 加速器 · 未加速（官方直连）';
    await chrome.action.setTitle({ title });
    await chrome.action.setBadgeText({ text: '' });
  } catch (e) { /* 图标设置失败不影响加速 */ }

  const s = await getStats();
  s.enabledAt = on ? (s.enabledAt || Date.now()) : null;
  await saveStats(s);

  return route;
}

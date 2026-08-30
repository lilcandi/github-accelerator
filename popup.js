let cfg = null;
let latency = {};    // routeId -> 延迟 ms（-1 表示超时）
let lastTest = null; // { name, latency, bps } 最近一次实测
let ghCount = 0;     // 当前打开的 GitHub 相关标签页数（由 background 维护）

const $ = sel => document.querySelector(sel);

function typeLabel(t) {
  return t === 'prefix' ? '加速前缀' : t === 'mirror' ? '全站镜像' : '直连';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function toast(msg, ms = 3200) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), ms);
}

// ---------------- 格式化 ----------------

function fmtBytes(n) {
  if (!n || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0, v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return (i ? v.toFixed(1) : String(v)) + ' ' + units[i];
}

function fmtSpeed(bps) {
  return bps > 0 ? fmtBytes(bps) + '/s' : '—';
}

function pad2(n) { return String(n).padStart(2, '0'); }

function fmtDur(ms) {
  if (!ms || ms < 0) return '—';
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(ss)}` : `${pad2(m)}:${pad2(ss)}`;
}

// ---------------- 渲染 ----------------

async function persist() {
  await saveCfg(cfg);
  await applyRules(cfg);
  render();
}

function render() {
  updateStatusUI();

  const list = $('#routeList');
  list.innerHTML = '';
  for (const r of cfg.routes) {
    const row = document.createElement('div');
    row.className = 'route' + (r.id === cfg.currentId ? ' active' : '');
    row.dataset.id = r.id;

    const l = latency[r.id];
    const lat = l === undefined ? '' :
      (l >= 0 ? `<b class="ok">${l} ms</b>` : '<b class="bad">超时</b>');
    const del = r.builtin ? '' :
      `<span class="del" data-del="${escapeHtml(r.id)}" title="删除此线路">✕</span>`;

    row.innerHTML = `
      <input type="radio" name="route" ${r.id === cfg.currentId ? 'checked' : ''}>
      <span class="name">${escapeHtml(r.name)}</span>
      <span class="tag tag-${escapeHtml(r.type)}">${typeLabel(r.type)}</span>
      <span class="lat">${lat}</span>
      ${del}`;

    row.addEventListener('click', e => {
      if (e.target.classList && e.target.classList.contains('del')) return;
      if (cfg.currentId !== r.id) {
        cfg.currentId = r.id;
        lastTest = null;
        persist();
        if (cfg.autoMode && r.type !== 'direct' && ghCount === 0) {
          toast('已选择线路：打开 GitHub 页面时自动加速');
        }
      }
    });
    list.appendChild(row);
  }

  $('#chkAvatars').checked = cfg.accelAvatars;
  $('#chkAssets').checked = cfg.accelAssets;

  const lt = $('#lastTest');
  if (lastTest) {
    lt.textContent = `当前线路实测：延迟 ${lastTest.latency} ms · 下载 ${fmtSpeed(lastTest.bps)}`;
    lt.classList.remove('hidden');
  } else {
    lt.classList.add('hidden');
  }
}

// 状态胶囊/副标题：加速中（绿）/ 待命中（橙，自动模式下无 GitHub 页面）/ 直连（灰）
function updateStatusUI() {
  const route = cfg.routes.find(r => r.id === cfg.currentId);
  const isAccelRoute = !!(route && route.type !== 'direct');
  const standby = !!(cfg.autoMode && isAccelRoute && ghCount === 0);
  const on = isAccelRoute && !standby;

  const pill = $('#status');
  if (on) {
    $('#statusText').textContent = '加速中';
    pill.className = 'pill on';
    $('#subline').textContent = cfg.autoMode
      ? `${route.name} · ${ghCount} 个 GitHub 标签页`
      : route.name;
  } else if (standby) {
    $('#statusText').textContent = '待命中';
    pill.className = 'pill wait';
    $('#subline').textContent = `打开 GitHub 页面时自动加速（${route.name}）`;
  } else {
    $('#statusText').textContent = '直连';
    pill.className = 'pill';
    $('#subline').textContent = isAccelRoute
      ? '已选择线路 · 自动加速已关闭'
      : '选择一条线路以启用加速';
  }
  document.body.classList.toggle('accel', on);
}

// ---------------- 统计栏（每秒刷新） ----------------

async function refreshStats() {
  try {
    const d = await chrome.storage.session.get(['stats', 'ghCount']);
    ghCount = d.ghCount | 0;
    const s = d.stats || { bytes: 0, samples: [], enabledAt: null, requests: 0 };
    $('#stBytes').textContent = fmtBytes(s.bytes);
    $('#stBytes').parentElement.title =
      `今日 ${s.requests || 0} 个请求经加速线路（按响应头估算）`;

    let bps = 0;
    if (Array.isArray(s.samples) && s.samples.length) {
      const now = Math.floor(Date.now() / 1000);
      const win = s.samples.filter(p => p.t > now - 10);
      if (win.length) {
        const span = Math.min(10, Math.max(1, now - win[0].t + 1));
        bps = win.reduce((a, p) => a + p.b, 0) / span;
      }
    }
    $('#stSpeed').textContent = fmtSpeed(Math.round(bps));
    $('#stTime').textContent = s.enabledAt ? fmtDur(Date.now() - s.enabledAt) : '—';
    updateStatusUI(); // 标签页开/关后 1 秒内同步状态显示
  } catch (e) { /* 会话存储不可用时静默 */ }
}
setInterval(refreshStats, 1000);

// ---------------- 测速 ----------------

// 延迟探测：小文件 TTFB
function testRoute(r) {
  let url;
  if (r.type === 'prefix') {
    url = (r.prefix || '').replace(/\/+$/, '') +
      '/https://raw.githubusercontent.com/torvalds/linux/master/README';
  } else if (r.type === 'mirror') {
    const host = r.hostMap && r.hostMap['github.com'];
    if (!host) return Promise.resolve(-1);
    url = 'https://' + host + '/';
  } else {
    url = 'https://raw.githubusercontent.com/torvalds/linux/master/README';
  }

  const t0 = performance.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  return fetch(url, { mode: 'no-cors', cache: 'no-store', signal: ctl.signal })
    .then(() => Math.round(performance.now() - t0))
    .catch(() => -1)
    .finally(() => { clearTimeout(timer); ctl.abort(); });
}

// 下载速度：与线路真实转发方式一致的文件流式下载，最多采样 2.5 秒 / 6MB
const SPEED_FILE = 'https://codeload.github.com/microsoft/vscode/tar.gz/refs/tags/1.85.1';

function speedUrl(r) {
  if (r.type === 'prefix') return (r.prefix || '').replace(/\/+$/, '') + '/' + SPEED_FILE;
  if (r.type === 'mirror') {
    const h = r.hostMap || {};
    if (h['github.com']) return 'https://' + h['github.com'] + '/microsoft/vscode/archive/refs/tags/1.85.1.tar.gz';
    return null;
  }
  return SPEED_FILE;
}

async function testSpeed(r) {
  const url = speedUrl(r);
  if (!url) return -1;
  const ctl = new AbortController();
  const kill = setTimeout(() => ctl.abort(), 8000);
  try {
    const resp = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
    if (!resp.body) return -1;
    const reader = resp.body.getReader();
    let bytes = 0, t0 = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!t0) t0 = performance.now();
      bytes += value.length;
      if (performance.now() - t0 > 2500 || bytes > 6 * 1024 * 1024) { ctl.abort(); break; }
    }
    const sec = (performance.now() - t0) / 1000;
    return t0 && sec > 0.05 ? Math.round(bytes / sec) : -1;
  } catch (e) {
    return -1;
  } finally {
    clearTimeout(kill);
    ctl.abort();
  }
}

// ---------------- 事件 ----------------

function bind() {
  $('#routeList').addEventListener('click', async e => {
    const delId = e.target.dataset && e.target.dataset.del;
    if (!delId) return;
    if (!confirm('确定删除该自定义线路？')) return;
    cfg.routes = cfg.routes.filter(x => x.id !== delId);
    if (cfg.currentId === delId) cfg.currentId = 'direct';
    lastTest = null;
    await persist();
  });

  $('#btnTest').addEventListener('click', async () => {
    const btn = $('#btnTest');
    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = '⏳ 测延迟中…';

    await Promise.all(cfg.routes.map(async r => { latency[r.id] = await testRoute(r); }));

    const best = cfg.routes
      .filter(r => r.type !== 'direct' && latency[r.id] > 0)
      .sort((a, b) => latency[a.id] - latency[b.id])[0];

    let target = cfg.routes.find(r => r.id === cfg.currentId);
    if (best) {
      if (cfg.currentId !== best.id) { cfg.currentId = best.id; await persist(); }
      target = best;
      toast(`最快：${best.name}（${latency[best.id]} ms），已启用`);
    } else {
      toast('所有加速线路均超时，请检查网络或添加自定义线路');
    }

    btn.textContent = '⏳ 测下载速度…';
    const bps = target && target.type !== 'direct' ? await testSpeed(target) : -1;
    lastTest = {
      name: target ? target.name : '',
      latency: target && latency[target.id] !== undefined ? latency[target.id] : -1,
      bps
    };

    btn.disabled = false;
    btn.textContent = old;
    render();
  });

  $('#btnDefaults').addEventListener('click', () => {
    if (!confirm('恢复默认线路列表？自定义线路将丢失。')) return;
    cfg = defaultCfg();
    latency = {};
    lastTest = null;
    persist();
    toast('已恢复默认线路列表');
  });

  $('#btnResetStats').addEventListener('click', async () => {
    await resetStats();
    refreshStats();
    toast('统计已清零');
  });

  $('#chkAuto').addEventListener('change', e => {
    cfg.autoMode = e.target.checked;
    persist();
    toast(e.target.checked
      ? '自动加速已开启：打开 GitHub 时启用，全部关闭后停止'
      : '自动加速已关闭：始终按所选线路加速');
  });

  $('#chkAvatars').addEventListener('change', e => { cfg.accelAvatars = e.target.checked; persist(); });
  $('#chkAssets').addEventListener('change', e => { cfg.accelAssets = e.target.checked; persist(); });

  $('#cType').addEventListener('change', () => {
    const mirror = $('#cType').value === 'mirror';
    $('#cValue').style.display = mirror ? 'none' : '';
    $('#cValueMirror').style.display = mirror ? '' : 'none';
  });

  $('#btnAdd').addEventListener('click', () => {
    const name = $('#cName').value.trim() || '自定义线路';
    const type = $('#cType').value;
    let route;
    if (type === 'prefix') {
      const prefix = $('#cValue').value.trim().replace(/\/+$/, '');
      if (!/^https:\/\/.+/.test(prefix)) { toast('前缀地址需以 https:// 开头'); return; }
      route = { id: 'c' + Date.now(), name, type, prefix };
    } else {
      let hostMap;
      try { hostMap = JSON.parse($('#cValueMirror').value || '{}'); }
      catch (e) { toast('镜像域名映射 JSON 格式有误'); return; }
      if (!hostMap['github.com']) { toast('映射中至少需要 {"github.com": "镜像域名"}'); return; }
      route = { id: 'c' + Date.now(), name, type, hostMap };
    }
    cfg.routes.push(route);
    cfg.currentId = route.id;
    lastTest = null;
    $('#cName').value = $('#cValue').value = $('#cValueMirror').value = '';
    persist();
    toast('已添加并启用：' + name);
  });

  $('#jsonBox').addEventListener('toggle', () => {
    if ($('#jsonBox').open) $('#jsonEditor').value = JSON.stringify(cfg.routes, null, 2);
  });

  $('#btnSaveJson').addEventListener('click', () => {
    try {
      const routes = JSON.parse($('#jsonEditor').value);
      if (!Array.isArray(routes)) throw new Error('not array');
      for (const r of routes) {
        if (!r || typeof r.id !== 'string' || typeof r.name !== 'string') throw new Error('bad item');
        if (!['prefix', 'mirror', 'direct'].includes(r.type)) throw new Error('bad type');
        if (r.type === 'prefix' && typeof r.prefix !== 'string') throw new Error('bad prefix');
        if (r.type === 'mirror' && (!r.hostMap || typeof r.hostMap !== 'object')) throw new Error('bad hostMap');
      }
      cfg.routes = routes;
      if (!routes.some(r => r.id === cfg.currentId)) {
        cfg.currentId = routes[0] ? routes[0].id : 'direct';
      }
      lastTest = null;
      persist();
      $('#jsonMsg').textContent = '已保存 ✔';
      setTimeout(() => { $('#jsonMsg').textContent = ''; }, 2000);
    } catch (e) {
      toast('JSON 解析失败或格式不符合要求');
    }
  });
}

// ---------------- 初始化 ----------------

(async () => {
  cfg = await loadCfg();
  try {
    const d = await chrome.storage.session.get('ghCount');
    ghCount = d.ghCount | 0;
  } catch (e) { /* 忽略 */ }
  render();
  bind();
  refreshStats();
})();

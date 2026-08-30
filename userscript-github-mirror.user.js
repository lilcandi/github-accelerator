// ==UserScript==
// @name         GitHub 镜像跳转（国内加速 · 轻量版）
// @namespace    https://github.com/local/gh-cn-accel
// @version      1.0.0
// @description  打开 github.com 时自动跳转到所选镜像站浏览（仅页面）。需要加速 raw / Releases 下载请改用扩展版。通过油猴菜单选择线路。
// @match        https://github.com/*
// @run-at       document-start
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function () {
  'use strict';

  // 镜像站会随时间失效，可自行增删
  const MIRRORS = [
    { name: 'kkgithub.com', host: 'kkgithub.com' },
    { name: 'bgithub.xyz', host: 'bgithub.xyz' }
  ];
  const KEY = 'mirrorHost';
  let host = GM_getValue(KEY, '');

  GM_registerMenuCommand('选择镜像线路 / 直连', () => {
    const list = MIRRORS.map((m, i) => `${i + 1}. ${m.name}`).join('\n') + '\n0. 直连官方（关闭跳转）';
    const n = parseInt(prompt('选择线路：\n' + list), 10);
    if (isNaN(n)) return;
    host = n === 0 ? '' : ((MIRRORS[n - 1] || {}).host || '');
    GM_setValue(KEY, host);
    if (host && onGithub()) location.replace(toMirror());
    else if (!host) toastSkipOnce();
  });

  GM_registerMenuCommand('本次直连官方（10 秒内不再跳转）', toastSkipOnce);

  function onGithub() {
    return /^(www\.)?github\.com$/.test(location.hostname);
  }

  function toMirror() {
    return 'https://' + host + location.pathname + location.search + location.hash;
  }

  // 防循环跳转：镜像站若把你弹回官方，10 秒内不再重跳
  function recent() {
    return Date.now() - (parseInt(sessionStorage.getItem('ghAccelTs'), 10) || 0) < 10000;
  }

  function toastSkipOnce() {
    sessionStorage.setItem('ghAccelTs', String(Date.now()));
  }

  if (host && onGithub() && !recent()) {
    sessionStorage.setItem('ghAccelTs', String(Date.now()));
    location.replace(toMirror());
  }
})();

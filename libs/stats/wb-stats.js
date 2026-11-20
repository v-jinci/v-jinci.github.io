/* ==========================================================
 *  站点计数（访客数 / 总浏览量 / 本页浏览量）
 *
 *  为什么不用主题自带的那份：
 *    主题从第三方域名 busuanzi.ibruce.info 拉脚本，网络不顺时
 *    数字会一直转圈，而且没有任何提示（用户反馈"总是转圈"）。
 *
 *  现在改成：
 *    1) 脚本自托管（/libs/stats/wb-stats.js），不再等第三方 JS；
 *    2) 自带 5 秒超时，超时显示 "—"，绝不停在转圈状态；
 *    3) 结果缓存 30 分钟（二次访问秒出）；
 *    4) 失败后 8 秒自动重试一次；
 *    5) 数字带千分位，方便核对。
 * ========================================================== */
(function () {
  'use strict';

  // 数据归属：不蒜子按「页面域名（请求 Referer 的 host）」统计 site_pv / site_uv，
  // page_pv 按完整 URL 统计。它不认仓库、不认代码、也不认账号 ——
  // 只要页面挂在自己的域名下，拿到的就是这个域名自己累计的数字，
  // 复制别人仓库不会继承别人的计数；换新域名则从 1 重新开始。
  var API = 'https://busuanzi.ibruce.info/busuanzi?jsonpCallback=wbBszCallback';
  var CACHE_KEY = 'wb-bsz-cache-v1';
  var TTL = 30 * 60 * 1000;
  var TIMEOUT = 5000;
  var KEYS = ['site_pv', 'site_uv', 'page_pv'];

  function setText(key, val) {
    var el = document.getElementById('busuanzi_value_' + key);
    if (el) el.innerHTML = val;
  }

  function fmt(n) {
    n = String(n);
    return n.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function apply(data) {
    if (!data) return false;
    var ok = false;
    KEYS.forEach(function (k) {
      if (data[k] !== undefined && data[k] !== null) {
        setText(k, fmt(data[k]));
        ok = true;
      }
    });
    return ok;
  }

  function readCache() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || !o.d || (Date.now() - o.t) > TTL) return null;
      return o.d;
    } catch (e) { return null; }
  }

  function writeCache(data) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), d: data }));
    } catch (e) {}
  }

  function fetchData(cb) {
    var done = false;
    window.wbBszCallback = function (data) {
      if (done) return;
      done = true;
      try { delete window.wbBszCallback; } catch (e) { window.wbBszCallback = undefined; }
      cb(data);
    };
    var s = document.createElement('script');
    s.src = API + '&_=' + Date.now();
    s.async = true;
    s.onerror = function () { if (done) return; done = true; cb(null); };
    (document.head || document.documentElement).appendChild(s);
    setTimeout(function () { if (done) return; done = true; cb(null); }, TIMEOUT);
  }

  function load(cb) {
    fetchData(function (data) {
      if (data) {
        writeCache(data);
        apply(data);
        cb(true);
      } else {
        cb(false);
      }
    });
  }

  function start() {
    // 本地预览（localhost / 127.0.0.1 / file://）不向线上计数接口发请求：
    // 既不把本地调试的访问刷进正式数据，也不会出现「预览页显示别人的数字」。
    // 正式域名（含以后绑定的自定义域名）照常按各自域名独立统计。
    var host = String(location.hostname || '');
    if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|::1)$/i.test(host) || location.protocol === 'file:') {
      KEYS.forEach(function (k) { setText(k, '—'); });
      return;
    }

    var cached = readCache();
    if (cached && apply(cached)) return;   // 缓存命中：立刻显示，不再请求

    // 兜底：5 秒还没数据就显示 "—"，不让它一直转圈
    setTimeout(function () {
      KEYS.forEach(function (k) {
        var el = document.getElementById('busuanzi_value_' + k);
        if (el && el.querySelector('.fa-spinner')) setText(k, '—');
      });
    }, TIMEOUT);

    load(function (ok) {
      if (ok) return;
      // 第一次失败，8 秒后再试一次
      setTimeout(function () { load(function () {}); }, 8000);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();

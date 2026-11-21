/* 写作后台加速：把 Sveltia 脚本缓存到本机，第二次进后台秒开。
   只缓存同源 /libs/sveltia-270/ 下的静态文件，不拦截任何动态请求。
   升级 Sveltia 时把 CACHE 版本号 +1 即可让旧缓存失效。 */
'use strict';
var CACHE = 'wb-cms-v2';
var BASE = '/libs/sveltia-270/';
var PRECACHE = [
  BASE + 'sveltia-cms.js',
  BASE + 'chunks/react-dom.js',
  BASE + 'chunks/git.js',
  BASE + 'chunks/gitlab.js',
  BASE + 'chunks/gitea.js',
  BASE + 'chunks/qrcode.js',
  BASE + 'chunks/map.js',
  BASE + 'chunks/assets/rolldown-runtime-BWaJ3C7D.js',
  BASE + 'chunks/assets/_shared-module_34-fTHtMlms.js',
  BASE + 'chunks/assets/_shared-module_42-aQ1n8ZYI.js',
  BASE + 'fonts/material-symbols-outlined.woff2',
  BASE + 'fonts/source-sans-3.woff2',
  BASE + 'fonts/noto-mono.woff2'
];

self.addEventListener('install', function (e) {
  // 后台预下载，单个失败不影响整体（addAll 全失败才 reject）
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return Promise.all(PRECACHE.map(function (u) {
        return c.add(new Request(u, { cache: 'reload' })).catch(function () {});
      }));
    }).catch(function () {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k.indexOf('wb-cms-') === 0 && k !== CACHE ? caches.delete(k) : null;
      }));
    }).then(function () { return self.clients.claim(); }).catch(function () {})
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf(BASE) !== 0) return;

  // cache-first：命中缓存立即返回，没有就网络拉取并存入
  e.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); }).catch(function () {});
        }
        return res;
      });
    })
  );
});

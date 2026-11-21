/* ==========================================================
 *  站点设置覆盖层：把 source/_data/look.yml 合并进主题配置。
 *
 *  为什么要这一层：
 *    以前只能在电脑上打开 http://localhost:4000/site 改外观，
 *    出门就改不了。现在 look.yml 既能被本地 /site 改，
 *    也能被远程 /admin 改，改完自动构建上线。
 *
 *  规则：
 *    look.yml 里写了什么键，就覆盖主题配置里的同名键；
 *    没写的键仍然用 _config.butterfly.yml 里的原值（不会丢配置）。
 *
 *  写法上的两个便利：
 *    menu / social 在 look.yml 里写成列表（一行一条），
 *    这里自动转成主题要的 map，远程编辑时不用手写 YAML 嵌套。
 * ========================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

function isPlainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(target, src) {
  if (!isPlainObject(src)) return target;
  Object.keys(src).forEach((k) => {
    const v = src[k];
    if (v === undefined || v === null) return;
    if (isPlainObject(v)) {
      if (!isPlainObject(target[k])) target[k] = {};
      deepMerge(target[k], v);
    } else {
      target[k] = v;
    }
  });
  return target;
}

/** "首页: / || fas fa-home"  ->  { "首页": "/ || fas fa-home" } */
function listToMap(list) {
  const out = {};
  (list || []).forEach((line) => {
    const s = String(line == null ? '' : line).trim();
    if (!s) return;
    const i = s.indexOf(':');
    if (i <= 0) { out[s] = ''; return; }
    out[s.slice(0, i).trim()] = s.slice(i + 1).trim();
  });
  return out;
}

/**
 * 主题模板用 theme.comments.use[0] / use[1] 取评论系统名，
 * 所以 use 必须是数组。look.yml 里为了方便 /site 下拉框存的是字符串 "Waline"，
 * 合并进来后会覆盖主题初始化时转好的数组，导致模板取成 'W' / 'a'，
 * 留言板/文章底部就只剩 "W a" 两个字母按钮。这里在合并后统一转回数组。
 */
function normalizeCommentsUse(themeConfig) {
  const c = themeConfig.comments;
  if (!c || c.use == null) return;
  let u = c.use;
  if (typeof u === 'string') {
    u = u.trim() ? u.split(',').map((s) => String(s).trim()).filter(Boolean) : [];
  } else if (!Array.isArray(u)) {
    u = [];
  }
  u = u.map((s) => typeof s === 'string'
    ? s.replace(/\b[a-z]/g, (m) => m.toUpperCase())
    : s);
  c.use = u;
}

hexo.extend.filter.register('before_generate', () => {
  let yaml;
  try { yaml = require('js-yaml'); } catch (e) { return; }

  // 站点文字：source/_data/site.yml 的 hexo 段覆盖 _config.yml 的同名键。
  // 本地 /site 与远程 /admin 都写这一份，避免两个后台各写一份互相打架。
  const siteFile = path.join(hexo.base_dir, 'source', '_data', 'site.yml');
  if (fs.existsSync(siteFile) && hexo.config) {
    try {
      const sd = yaml.load(fs.readFileSync(siteFile, 'utf8'));
      if (sd && isPlainObject(sd.hexo)) {
        deepMerge(hexo.config, sd.hexo);
        console.log('[wb-settings] 已应用站点文字：', Object.keys(sd.hexo).join(', '));
      }
    } catch (e) {
      console.warn('[wb-settings] site.yml 解析失败，已忽略：', e.message);
    }
  }

  const file = path.join(hexo.base_dir, 'source', '_data', 'look.yml');
  if (!fs.existsSync(file)) return;

  let data;
  try {
    data = yaml.load(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.warn('[wb-settings] look.yml 解析失败，已忽略：', e.message);
    return;
  }
  if (!isPlainObject(data)) return;

  if (Array.isArray(data.menu)) data.menu = listToMap(data.menu);
  if (Array.isArray(data.social)) data.social = listToMap(data.social);

  if (!hexo.theme) hexo.theme = {};
  if (!hexo.theme.config) hexo.theme.config = {};
  deepMerge(hexo.theme.config, data);
  // 合并后必须把 comments.use 规范化回数组，否则字符串会被模板逐字取成 W/a
  normalizeCommentsUse(hexo.theme.config);

  console.log('[wb-settings] 已应用站点设置：', Object.keys(data).join(', '));
});

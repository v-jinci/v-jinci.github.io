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

hexo.extend.filter.register('before_generate', () => {
  const file = path.join(hexo.base_dir, 'source', '_data', 'look.yml');
  if (!fs.existsSync(file)) return;

  let yaml;
  try { yaml = require('js-yaml'); } catch (e) { return; }

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

  console.log('[wb-settings] 已应用站点设置：', Object.keys(data).join(', '));
});

/**
 * 页面访问密码（可选，按页面单独设置）
 *
 * 密码存在 source/_data/site.yml 的 sections 里，值是密码的 SHA-256，不是明文。
 * 在 http://localhost:4000/site 的「页面密码」里改。
 *
 * 实现方式：构建时给指定页面注入一个解锁卡片，并在 <head> 里先把正文藏起来，
 * 输入正确密码（浏览器本地算 SHA-256 比对）后显示。
 *
 * ⚠️ 诚实说明：静态站的正文和文件本来就在 HTML / 仓库里，这层只是「挡住随手点进来的人」，
 *    不是真正的权限控制。真要保密请用加密压缩包。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function loadSite(baseDir) {
  const file = path.join(baseDir, 'source', '_data', 'site.yml');
  if (!fs.existsSync(file)) return {};
  try {
    return require('js-yaml').load(fs.readFileSync(file, 'utf8')) || {};
  } catch (e) {
    return {};
  }
}

function keyOf(p) {
  return String(p || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/index\.html$/, '')
    .replace(/\/+$/, '') || 'index';
}

const STYLE = [
  '<style>',
  'html.wb-locked #article-container,html.wb-locked #content-inner{display:none!important}',
  '.wb-gate{max-width:420px;margin:40px auto 60px;padding:30px 26px 26px;border-radius:16px;',
  'background:var(--wbg-card,#fff);border:1px solid var(--wbg-line,#e3e8f7);box-shadow:0 6px 26px rgba(31,36,48,.07);text-align:center;',
  'font-size:15px;color:var(--wbg-text,#4c4948)}',
  '.wb-gate-ico{font-size:30px;line-height:1;margin-bottom:10px}',
  '.wb-gate-t{font-size:17px;font-weight:600;margin-bottom:6px}',
  '.wb-gate-d{font-size:13px;color:var(--wbg-sub,#8b93a1);margin-bottom:18px;line-height:1.7}',
  '.wb-gate form{display:block}',
  '.wb-gate-row{display:flex;gap:8px}',
  '.wb-gate input{flex:1 1 auto;min-width:0;padding:10px 12px;border:1px solid var(--wbg-line,#dfe3ee);border-radius:10px;',
  'font:inherit;background:#fbfcff;color:inherit}',
  '.wb-gate input:focus{outline:none;border-color:#8aa2f7;background:#fff}',
  '.wb-gate button{flex:0 0 auto;border:0;border-radius:10px;padding:10px 20px;background:#4a6cf7;color:#fff;font:inherit;cursor:pointer}',
  '.wb-gate button:disabled{opacity:.6;cursor:default}',
  '.wb-gate .wb-remember{display:flex;align-items:center;justify-content:center;gap:7px;margin-top:12px;',
  'font-size:13px;color:var(--wbg-sub,#8b93a1);cursor:pointer;user-select:none}',
  '.wb-gate .wb-remember input{width:16px;height:16px;flex:0 0 auto;accent-color:#4a6cf7;cursor:pointer}',
  '.wb-gate-msg{min-height:20px;font-size:13px;color:#c62828;margin-top:10px}',
  '.wb-relock{position:fixed;right:18px;bottom:18px;z-index:99999;border:1px solid var(--wbg-line,#dfe3ee);',
  'background:var(--wbg-card,#fff);color:var(--wbg-sub,#8b93a1);border-radius:9999px;padding:9px 15px;',
  'font:600 12px/1 sans-serif;cursor:pointer;box-shadow:0 4px 16px rgba(31,36,48,.14)}',
  '.wb-relock:hover{color:#4a6cf7;border-color:#8aa2f7}',
  'html[data-theme="dark"] .wb-gate,body.dark .wb-gate{--wbg-card:rgba(255,255,255,.05);--wbg-line:rgba(255,255,255,.12);--wbg-text:#c8ccd4;--wbg-sub:#8b93a1}',
  'html[data-theme="dark"] .wb-gate input,body.dark .wb-gate input{background:rgba(255,255,255,.06);color:#c8ccd4}',
  '</style>',
  '<script>',
  '"use strict";',
  'window.__WB_GATE__={key:KEYVAL,hash:HASHVAL};',
  'try{var _g=window.__WB_GATE__,_k="wb_unlock_"+_g.key,',
  '_r="wb_gate_ok_"+_g.key+"_"+String(_g.hash||"").slice(0,12);',
  'if(!sessionStorage.getItem(_k)&&!localStorage.getItem(_r))document.documentElement.classList.add("wb-locked");',
  '}catch(e){document.documentElement.classList.add("wb-locked");}',
  '</script>'
].join('');

const GATE_HTML = [
  '<div class="wb-gate" id="wb-gate">',
  '<div class="wb-gate-ico">🔒</div>',
  '<div class="wb-gate-t">这一页需要密码</div>',
  '<div class="wb-gate-d">输入访问密码后查看内容。忘记密码就来找我。</div>',
  '<form id="wb-gate-form" autocomplete="off">',
  '<div class="wb-gate-row">',
  '<input type="password" id="wb-gate-pw" placeholder="访问密码" autocomplete="current-password">',
  '<button type="submit" id="wb-gate-go">进入</button>',
  '</div>',
  '<label class="wb-remember"><input type="checkbox" id="wb-gate-remember"><span>记住密码（这台设备下次免输，公用电脑别勾）</span></label>',
  '</form>',
  '<div class="wb-gate-msg" id="wb-gate-msg"></div>',
  '</div>'
].join('');

const GATE_JS = [
  '<script>',
  '(function(){',
  '  var cfg = window.__WB_GATE__ || {};',
  '  var PREFIX = String(cfg.hash || "").toLowerCase().slice(0, 12);',
  '  var STORE = "wb_unlock_" + cfg.key;',
  '  var OK = "wb_gate_ok_" + cfg.key + "_" + PREFIX;',
  '  var REM = "wb_gate_pw_" + cfg.key + "_" + PREFIX;',
  '  function b64dec(v){',
  '    try{ var bin = atob(v); var b = new Uint8Array(bin.length);',
  '      for (var i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);',
  '      return new TextDecoder("utf-8").decode(b); }catch(e){ return ""; }',
  '  }',
  '  function reveal(){',
  '    document.documentElement.classList.remove("wb-locked");',
  '    var g = document.getElementById("wb-gate");',
  '    if (g && g.parentNode) g.parentNode.removeChild(g);',
  '    var links = document.querySelectorAll("[data-wb-href]");',
  '    for (var i = 0; i < links.length; i++) {',
  '      var url = b64dec(links[i].getAttribute("data-wb-href"));',
  '      if (url) links[i].setAttribute("href", url);',
  '      links[i].removeAttribute("data-wb-href");',
  '    }',
  '    if (!document.getElementById("wb-relock")) {',
  '      var rb = document.createElement("button");',
  '      rb.id = "wb-relock"; rb.className = "wb-relock"; rb.type = "button";',
  '      rb.textContent = "🔒 重新上锁";',
  '      rb.title = "清除记住的密码，回到输密码状态";',
  '      rb.addEventListener("click", function () {',
  '        try { localStorage.removeItem(OK); localStorage.removeItem(REM); sessionStorage.removeItem(STORE); } catch (e) {}',
  '        location.reload();',
  '      });',
  '      document.body.appendChild(rb);',
  '    }',
  '  }',
  '  if (!document.documentElement.classList.contains("wb-locked")) { reveal(); return; }',
  '  var form = document.getElementById("wb-gate-form");',
  '  if (!form) return;',
  '  var input = document.getElementById("wb-gate-pw");',
  '  var msg = document.getElementById("wb-gate-msg");',
  '  var btn = document.getElementById("wb-gate-go");',
  '  var remember = document.getElementById("wb-gate-remember");',
  '  try { var saved = localStorage.getItem(REM); if (saved && remember) { input.value = saved; remember.checked = true; } } catch (e) {}',
  '  function hex(buf){',
  '    var a = new Uint8Array(buf), s = "";',
  '    for (var i = 0; i < a.length; i++) s += ("0" + a[i].toString(16)).slice(-2);',
  '    return s;',
  '  }',
  '  form.addEventListener("submit", function(ev){',
  '    ev.preventDefault();',
  '    var val = input.value;',
  '    if (!val) { msg.textContent = "请输入密码"; return; }',
  '    if (!(window.crypto && crypto.subtle)) { msg.textContent = "浏览器太旧，换一个再试"; return; }',
  '    btn.disabled = true; msg.textContent = "校验中…";',
  '    crypto.subtle.digest("SHA-256", new TextEncoder().encode(val)).then(function(buf){',
  '      if (hex(buf) === String(cfg.hash || "").toLowerCase()) {',
  '        try {',
  '          if (remember && remember.checked) {',
  '            localStorage.setItem(OK, "1"); localStorage.setItem(REM, val);',
  '          } else {',
  '            sessionStorage.setItem(STORE, "1");',
  '            localStorage.removeItem(OK); localStorage.removeItem(REM);',
  '          }',
  '        } catch (e) {}',
  '        reveal();',
  '      } else {',
  '        msg.textContent = "密码不对，再试一次";',
  '        input.value = ""; input.focus(); btn.disabled = false;',
  '      }',
  '    }).catch(function(){ msg.textContent = "校验出错，刷新页面重试"; btn.disabled = false; });',
  '  });',
  '  input.focus();',
  '})();',
  '</script>'
].join('');

hexo.extend.filter.register('after_render:html', function (str, data) {
  if (typeof str !== 'string') return str;
  const key = keyOf(data && data.path);
  if (!key) return str;
  const site = loadSite(hexo.base_dir);
  const raw = String(((site.sections || {})[key]) || '').trim();
  if (!raw) return str;
  // 存的是 64 位 SHA-256 就直接用；存的是明文就在构建时现算一次哈希，
  // 这样远程后台（/admin）里直接填明文密码也能用。
  const hash = /^[a-f0-9]{64}$/i.test(raw)
    ? raw.toLowerCase()
    : crypto.createHash('sha256').update(raw, 'utf8').digest('hex');

  const head = STYLE.replace('KEYVAL', JSON.stringify(key)).replace('HASHVAL', JSON.stringify(hash));
  if (str.indexOf('</head>') !== -1) str = str.replace('</head>', head + '</head>');

  // 密码卡片必须放在 #content-inner 之外：锁定时 content-inner 会被 display:none，
  // 若卡片插在它内部（旧代码对内页插到 #article-container 前）会连密码框一起藏掉，整页空白。
  // 统一插到 #content-inner 前面，锁定时卡片可见、正文隐藏；解锁后 reveal() 会移除卡片。
  const outer = '<main class="layout" id="content-inner">';
  const inner = '<div class="container" id="article-container">';
  const marker = str.indexOf(outer) !== -1 ? outer : (str.indexOf(inner) !== -1 ? inner : '');
  if (marker) {
    str = str.replace(marker, GATE_HTML + marker);
    if (str.indexOf('</body>') !== -1) str = str.replace('</body>', GATE_JS + '</body>');
  }
  return str;
});

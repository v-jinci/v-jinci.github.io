/**
 * 本地启动器（绕过 hexo-cli 在 Windows 上的路径问题）
 * 用法：
 *   node run.js server    启动本地预览 + 写作后台
 *   node run.js publish   生成并发布到 GitHub Pages
 *   node run.js build     只生成文件到 public
 *   node run.js clean     清理
 *   node run.js new "标题"  新建一篇文章
 */
const Hexo = require('hexo');

// Windows 控制台默认 GBK，切到 UTF-8 后中文提示才不会乱码
const isWin = process.platform === 'win32';
function chcp(cp) {
  if (!isWin) return;
  try {
    require('child_process').execSync('chcp ' + cp, { stdio: 'ignore' });
  } catch (e) {
    /* 没有控制台时切不了，不影响功能 */
  }
}
chcp(65001);

/* ---------------------------------------------------------------
 * 统一打印「可以点的网址」：Windows 控制台里按住 Ctrl 点一下就能打开
 * 不管服务是刚启动、还是已经在跑，都走这里，保证窗口里永远有链接
 * --------------------------------------------------------------- */
function printLinks(title) {  console.log('');
  if (title) console.log('  ' + title);
  console.log('  ┌─────────────────────────────────────────────────────');
  console.log('  │  本地预览：   http://localhost:4000');
  console.log('  │  可视化写作： http://localhost:4000/write   （像 Word，推荐）');
  console.log('  │  站点信息：   http://localhost:4000/site');
  console.log('  │  旧写作后台： http://localhost:4000/admin');
  console.log('  │              账号 admin   密码 weiblog2026');
  console.log('  │');
  console.log('  │  按住 Ctrl 点上面的地址，就能在浏览器里打开');
  console.log('  │  想停止服务：在这个黑窗口按 Ctrl + C');
  console.log('  │  写了新文章要上线：另开「1-发布到网站.bat」');
  console.log('  └─────────────────────────────────────────────────────');
  console.log('');
}

/* bat 里用 WB_OPEN 指定打开哪个页面（/ 首页、/write 写作页） */
function openPath() {
  let v = String(process.env.WB_OPEN || '/write').trim();
  // 个别终端会把 "/write" 当文件路径改写成 D:\...\write，这里纠正回来
  if (v.indexOf('\\') >= 0 || /^[a-zA-Z]:/.test(v)) {
    const seg = v.split(/[\\/]/).filter(Boolean).pop() || '';
    v = '/' + seg;
  }
  if (v.indexOf('http') === 0) v = v.replace(/^https?:\/\/[^/]+/i, '');
  if (!v || v.charAt(0) !== '/') v = '/' + v;
  return v === '/' ? '' : v;
}

/* 用系统默认浏览器打开网址（服务真的起来之后再调用，不会白开一个错误页） */
function openBrowser(url) {
  try {
    const cp = require('child_process');
    if (isWin) {
      cp.spawn(process.env.ComSpec || 'cmd', ['/c', 'start', '', url], {
        stdio: 'ignore',
        detached: true,
        windowsHide: true,
      }).unref();
    } else {
      cp.spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], {
        stdio: 'ignore',
        detached: true,
      }).unref();
    }
    return true;
  } catch (e) {
    return false;
  }
}

/* ---------------------------------------------------------------
 * 分步提示：让每次运行都能看清"现在到第几步、这步在干什么"
 * 用法：beginSteps(总步数)  ->  step('这一步做什么', '给外行的解释')
 * --------------------------------------------------------------- */
const __steps = { total: 0, cur: 0 };
function beginSteps(total) {
  __steps.total = total;
  __steps.cur = 0;
  console.log('');
  console.log('  这次一共 ' + total + ' 步，每一步都会说清楚在做什么：');
}
function step(text, hint) {
  __steps.cur += 1;
  console.log('');
  console.log('  [' + __steps.cur + (__steps.total ? '/' + __steps.total : '') + '] ' + text);
  if (hint) console.log('       ' + hint);
}
/* 某一步内部的细项 */
function sub(text) {
  console.log('       · ' + text);
}

/**
 * 确保 PATH 里有 git.exe。Windows 上常见情况是根本没装 git，
 * 或者只装了不写进系统 PATH 的 PortableGit。这里自己找一遍并补进 PATH。
 */
function ensureGit() {
  if (!isWin) return true;
  const fs = require('fs');
  const path = require('path');
  const cp = require('child_process');

  // 1. 已经在 PATH 里
  try {
    const v = cp.execFileSync('git', ['--version'], { encoding: 'utf8' }).trim();
    console.log('  ' + v + '（来自 PATH）');
    return true;
  } catch (e) {
    /* 继续找 */
  }

  const home = process.env.USERPROFILE || process.env.HOME || '';
  const dirs = [
    'C:\\Program Files\\Git\\cmd',
    'C:\\Program Files (x86)\\Git\\cmd',
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'cmd')
  ];

  // 2. PortableGit（WorkBuddy / 绿色版 Git 常见位置）
  const roots = [
    path.join(home, '.workbuddy', 'binaries', 'PortableGit', 'versions'),
    'D:\\软件\\workbuddy\\resources\\vendor\\PortableGit'
  ];
  for (const root of roots) {
    let list = [];
    try {
      list = fs.readdirSync(root);
    } catch (e) {
      continue;
    }
    for (const d of list) {
      dirs.push(path.join(root, d, 'mingw64', 'bin'));
      dirs.push(path.join(root, d, 'cmd'));
    }
  }

  for (const dir of dirs) {
    try {
      if (!fs.existsSync(path.join(dir, 'git.exe'))) continue;
      process.env.PATH = dir + ';' + process.env.PATH;
      try {
        const v = cp.execFileSync('git', ['--version'], { encoding: 'utf8' }).trim();
        console.log('  ' + v + '（' + dir + '）');
        return true;
      } catch (e) {
        /* 这个目录的 git 跑不起来，继续找 */
      }
    } catch (e) {
      /* 忽略 */
    }
  }

  console.log('  [警告] 没找到可用的 git，发布会失败。');
  return false;
}

/**
 * 读取 ~/.git-credentials 里某个主机的用户名和令牌。
 */
function readCred(host) {
  const fs = require('fs');
  const path = require('path');
  const file = path.join(process.env.USERPROFILE || process.env.HOME || '.', '.git-credentials');
  const res = { user: '', token: '', file: file };
  try {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.trim().match(/^https:\/\/([^:@/]+):(.+)@([^@/]+)$/);
      if (m && m[3].toLowerCase().endsWith(host.toLowerCase())) {
        res.user = m[1];
        res.token = m[2];
        break;
      }
    }
  } catch (e) {
    /* 还没有凭据文件 */
  }
  return res;
}

/**
 * 执行 git 并**完整捕获**输出。不接管控制台，出错时才能看到真正原因。
 */
function runGit(args, cwd, extraEnv, opts) {
  const cp = require('child_process');
  const env = Object.assign({}, process.env, { GIT_TERMINAL_PROMPT: '0' }, extraEnv || {});
  // 这些是 git 的保留变量。若被外部设成别的路径，git 会去错误的地方找仓库
  // （典型报错：fatal: not a git repository: '...\mingw64\bin\'）。
  // 我们需要 git 只在当前目录里找仓库，所以一律清掉。
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  delete env.GIT_OBJECT_DIRECTORY;
  delete env.GIT_ALTERNATE_OBJECT_DIRECTORIES;
  delete env.GIT_CEILING_DIRECTORIES;
  const spawnOpts = {
    cwd: cwd,
    env: env,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024
  };
  if (opts && opts.timeout) spawnOpts.timeout = opts.timeout;
  const r = cp.spawnSync('git', ['-c', 'safe.directory=*'].concat(args), spawnOpts);
  // 超时被杀掉时 error 是 ETIMEDOUT，交给调用方判断
  if (r.error && r.error.code !== 'ETIMEDOUT') throw new Error('执行 git 失败：' + r.error.message);
  const out = r.stdout || '';
  const err = r.stderr || '';
  const code = r.error && r.error.code === 'ETIMEDOUT' ? 'TIMEOUT' : r.status;
  return { code: code, out: out, err: err, text: (out + err).trim() };
}

/**
 * 自己实现发布：初始化 → 拷文件 → 提交 → 带令牌推送。
 * 好处是每一步的 git 报错都能拿到，不会只剩一句 Spawn failed。
 */
async function deployGit() {
  const fs = require('fs');
  const path = require('path');
  const base = hexo.base_dir;
  const pub = path.join(base, 'public');
  const dir = path.join(base, '.deploy_git');
  const cfg = Array.isArray(hexo.config.deploy) ? hexo.config.deploy[0] : hexo.config.deploy || {};
  const branch = cfg.branch || 'master';
  const rawUrl = cfg.repo || cfg.repository || '';
  if (!rawUrl) throw new Error('_config.yml 里的 deploy.repo 没有配置。');
  if (!fs.existsSync(pub)) throw new Error('public 目录不存在，生成步骤可能失败了。');

  // 从地址里拆出主机和路径（支持 https://user@host/path.git 这种写法）
  const m = rawUrl.replace(/^https:\/\/(?:[^@/]+@)?/, '').match(/^([^/]+)(\/.*)?$/);
  const host = m ? m[1] : 'github.com';
  const pathPart = (m && m[2]) || ('/' + 'v-jinci/v-jinci.github.io.git');

  const cred = readCred(host);
  if (!cred.token) {
    const e = new Error('没有找到 GitHub 令牌。请先双击 「5-首次配置GitHub.bat」 粘贴一次。');
    throw e;
  }
  console.log('  使用账号：' + cred.user + '（令牌已读取）');

  // 1. 准备发布目录
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(path.join(dir, '.git'))) {
    console.log('  初始化本地发布仓库…');
    let r = runGit(['init', '-b', branch], dir);
    if (r.code !== 0) {
      runGit(['init'], dir);
      runGit(['checkout', '-B', branch], dir);
    }
    runGit(['config', 'user.name', 'v-jinci'], dir);
    runGit(['config', 'user.email', 'v-jinci@users.noreply.github.com'], dir);
  }

  // 2. 清空旧文件（保留 .git）后拷入新站点
  for (const name of fs.readdirSync(dir)) {
    if (name === '.git') continue;
    fs.rmSync(path.join(dir, name), { recursive: true, force: true });
  }
  fs.cpSync(pub, dir, { recursive: true });

  // 3. 提交
  runGit(['add', '-A'], dir);
  const msg = 'Site updated: ' + new Date().toISOString().replace('T', ' ').slice(0, 19);
  const c = runGit(['commit', '-m', msg], dir);
  if (c.code !== 0 && !/nothing to commit|no changes added|无文件要提交/i.test(c.text)) {
    console.log('  提交提示：' + (c.text.split('\n')[0] || '未知'));
  } else if (c.code === 0) {
    console.log('  已提交：' + msg);
  }

  // 4. 推送：令牌直接写在地址里，不依赖凭据助手（这是 128 的主要来源）
  const authUrl = 'https://' + cred.user + ':' + cred.token + '@' + host + pathPart;
  console.log('  推送到：https://' + cred.user + ':****@' + host + pathPart);
  const p = runGit(['push', '-f', authUrl, 'HEAD:' + branch], dir);
  if (p.code !== 0) {
    const e = new Error('推送失败（git 退出码 ' + p.code + '）');
    e.gitOutput = p.text.split(cred.token).join('****');
    throw e;
  }
  const tail = p.text.split('\n').filter((l) => l.trim()).slice(-2).join('\n  ');
  if (tail) console.log('  ' + tail);
}

// 把「源码」推到 hexo-src 分支，由 GitHub Actions 自动编译并发布到 master。
// 这样「本地 publish」和「网页里写文章」走的是同一条流水线，不会互相覆盖。

const SRC_BRANCH = 'hexo-src';
// 这些是站点真正需要的源码，publish 时整份覆盖到副本上
const MANAGED_FILES = ['_config.yml', '_config.butterfly.yml', 'package.json', 'package-lock.json', '.gitignore', '.pages.yml', 'run.js', 'gh.js', 'site-editor.js', 'write-editor.js', 'README-使用说明.md'];
const MANAGED_DIRS = ['source', 'scaffolds', '.github', 'scripts', 'tools', 'tina'];

/** 解析仓库地址 + 读令牌，返回 { host, pathPart, cleanUrl, cred, authUrl } */
function repoInfo() {
  const cfg = Array.isArray(hexo.config.deploy) ? hexo.config.deploy[0] : hexo.config.deploy || {};
  const rawUrl = cfg.repo || cfg.repository || '';
  if (!rawUrl) throw new Error('_config.yml 里的 deploy.repo 没有配置。');
  const m = rawUrl.replace(/^https:\/\/(?:[^@/]+@)?/, '').match(/^([^/]+)(\/.*)?$/);
  const host = m ? m[1] : 'github.com';
  const pathPart = (m && m[2]) || '/v-jinci/v-jinci.github.io.git';
  const cred = readCred(host);
  if (!cred.token) throw new Error('没有找到 GitHub 令牌。请先双击 「5-首次配置GitHub.bat」 粘贴一次。');
  return {
    host: host,
    pathPart: pathPart,
    cleanUrl: 'https://' + host + pathPart,
    cred: cred,
    authUrl: 'https://' + cred.user + ':' + cred.token + '@' + host + pathPart
  };
}

/**
 * 走 api.github.com 的客户端（github.com 连不上时用这条通道）。
 * 地址里的 /v-jinci/v-jinci.github.io.git 取出 owner/repo。
 */
function ghClient() {
  const info = repoInfo();
  const m = info.pathPart.replace(/\.git$/, '').match(/^\/([^/]+)\/([^/]+)$/);
  if (!m) throw new Error('仓库地址看不懂：' + info.pathPart);
  return require('./gh')({ user: info.cred.user, token: info.cred.token, slug: m[1] + '/' + m[2] });
}

/** 本地所有需要上线的文件（相对路径列表） */
function localManagedFiles() {
  const fs = require('fs');
  const path = require('path');
  const base = hexo.base_dir;
  const out = [];
  for (const f of MANAGED_FILES) {
    if (fs.existsSync(path.join(base, f))) out.push(f);
  }
  for (const d of MANAGED_DIRS) {
    const abs = path.join(base, d);
    if (fs.existsSync(abs)) out.push.apply(out, listFiles(abs, d));
  }
  return out;
}

/* ---------------- 自动备份：发布前先把 source 存一份 ---------------- */
function backupRoot() {
  return require('path').join(hexo.base_dir, '.backup');
}

function backupSource(tag) {
  const fs = require('fs');
  const path = require('path');
  const root = backupRoot();
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  // 目录名只用 ASCII：这台机器上的 Node 22 在「目标路径含中文」时 cpSync 会直接崩溃
  // （Segmentation fault），所以 tag 必须是英文。
  const dir = path.join(root, (tag ? tag + '-' : '') + stamp);
  try {
    fs.mkdirSync(dir, { recursive: true });
    for (const d of ['source', 'scripts']) {
      const src = path.join(hexo.base_dir, d);
      if (fs.existsSync(src)) fs.cpSync(src, path.join(dir, d), { recursive: true });
    }
    for (const f of ['_config.yml', '_config.butterfly.yml', '.pages.yml']) {
      const src = path.join(hexo.base_dir, f);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dir, f));
    }
    // 只保留最近 10 份，免得越堆越多
    const list = fs.readdirSync(root).sort();
    while (list.length > 10) {
      const old = list.shift();
      fs.rmSync(path.join(root, old), { recursive: true, force: true });
    }
    return dir;
  } catch (e) {
    return '';
  }
}

function listBackups() {
  const fs = require('fs');
  const path = require('path');
  const root = backupRoot();
  try {
    return fs
      .readdirSync(root)
      .sort()
      .reverse()
      .map((n) => path.join(root, n));
  } catch (e) {
    return [];
  }
}

/**
 * 把线上 hexo-src 取回本地副本 .src_git，并重置到最新提交。
 * 返回 { dir, info }
 */
function fetchRemoteSource(opts) {
  const fs = require('fs');
  const path = require('path');
  const base = hexo.base_dir;
  const info = repoInfo();
  const dir = path.join(base, '.src_git');
  const timeout = opts && opts.timeout ? { timeout: opts.timeout } : undefined;

  if (!fs.existsSync(path.join(dir, '.git'))) {
    fs.rmSync(dir, { recursive: true, force: true });
    if (!(opts && opts.quiet)) console.log('  首次同步：从线上取回源码…');
    const c = runGit(['clone', '--depth', '1', '--branch', SRC_BRANCH, info.authUrl, dir], base, null, timeout);
    if (c.code !== 0) {
      const e = new Error('取回源码失败（git 退出码 ' + c.code + '）');
      e.gitOutput = c.text.split(info.cred.token).join('****');
      throw e;
    }
    runGit(['remote', 'set-url', 'origin', info.cleanUrl], dir);
  } else {
    const f = runGit(['fetch', '--depth', '1', info.authUrl, SRC_BRANCH], dir, null, timeout);
    if (f.code !== 0) {
      const e = new Error(f.code === 'TIMEOUT' ? '同步线上源码超时（网络太慢或连不上）' : '同步线上源码失败（git 退出码 ' + f.code + '）');
      e.gitOutput = f.text.split(info.cred.token).join('****');
      throw e;
    }
    runGit(['reset', '--hard', 'FETCH_HEAD'], dir);
  }
  runGit(['config', 'user.name', info.cred.user], dir);
  runGit(['config', 'user.email', info.cred.user + '@users.noreply.github.com'], dir);
  runGit(['config', 'core.quotepath', 'false'], dir);
  return { dir: dir, info: info };
}

/** 递归列出目录下所有文件，返回相对 base 的路径（用 / 分隔） */
function listFiles(root, prefix) {
  const fs = require('fs');
  const path = require('path');
  const out = [];
  const walk = (abs, rel) => {
    if (!fs.existsSync(abs)) return;
    for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
      if (ent.name === '.git') continue;
      // Tina 的编译缓存不用上云（TinaCloud 会自己重新编译）
      if (ent.isDirectory() && ent.name === '.cache' && rel.indexOf('tina/__generated__') === 0) continue;
      const a = path.join(abs, ent.name);
      const r = rel ? rel + '/' + ent.name : ent.name;
      if (ent.isDirectory()) walk(a, r);
      else if (ent.isFile()) out.push(r);
    }
  };
  walk(root, prefix || '');
  return out;
}

function sha1(buf) {
  return require('crypto').createHash('sha1').update(buf).digest('hex');
}

/**
 * 内容指纹：文本文件忽略 CRLF/LF 差异，二进制按原样。
 * 不加这一层，本地（CRLF）和线上（LF）会被误判成「每个文件都改过」。
 */
function contentKey(buf) {
  if (buf.includes(0)) return 'b:' + sha1(buf);
  const text = buf.toString('utf8').replace(/\r\n/g, '\n');
  return 't:' + sha1(Buffer.from(text, 'utf8'));
}

function statePath() {
  return require('path').join(hexo.base_dir, '.sync-state.json');
}

function loadSyncState() {
  const fs = require('fs');
  try {
    const d = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
    return d && typeof d.files === 'object' ? d.files : {};
  } catch (e) {
    return {};
  }
}

function saveSyncState(files) {
  const fs = require('fs');
  fs.writeFileSync(statePath(), JSON.stringify({ updated: new Date().toISOString(), files: files }, null, 2));
}

/**
 * 已发布文件清单：记录上次发布时本地有哪些文件。
 * 发布时若发现「线上有、本地没有」的文件，只有在这个清单（或云端同步记录）里
 * 认得的才真正删除——防止改个名就误删掉不认识的线上文件。
 */
function publishStatePath() {
  return require('path').join(hexo.base_dir, '.publish-state.json');
}

function loadPublishState() {
  const fs = require('fs');
  try {
    const d = JSON.parse(fs.readFileSync(publishStatePath(), 'utf8'));
    return Array.isArray(d.files) ? d.files : [];
  } catch (e) {
    return [];
  }
}

function savePublishState(rels) {
  const fs = require('fs');
  let removed = [];
  try {
    const d = JSON.parse(fs.readFileSync(publishStatePath(), 'utf8'));
    if (Array.isArray(d.removed)) removed = d.removed;
  } catch (e) {}
  fs.writeFileSync(publishStatePath(), JSON.stringify({ updated: new Date().toISOString(), files: rels, removed: removed }, null, 2));
}

/** 本地已改名/删除、等待发布时从线上移除的文件 */
function loadRemovedState() {
  const fs = require('fs');
  try {
    const d = JSON.parse(fs.readFileSync(publishStatePath(), 'utf8'));
    return Array.isArray(d.removed) ? d.removed : [];
  } catch (e) {
    return [];
  }
}

function saveRemovedState(rels) {
  const fs = require('fs');
  const old = loadRemovedState();
  const files = loadPublishState();
  const merged = old.concat(rels.filter((r) => old.indexOf(r) === -1));
  fs.writeFileSync(publishStatePath(), JSON.stringify({ updated: new Date().toISOString(), files: files, removed: merged }, null, 2));
}

/** 发布时允许删除的文件 = 上次发布清单 ∪ 云端同步记录 ∪ 已记录的改名/删除（两边「都见过」才算认得） */
function knownPublishedFiles() {
  return new Set(Object.keys(loadSyncState()).concat(loadPublishState()).concat(loadRemovedState()));
}

/**
 * 把线上新增/更新的文章拉到本地。
 * 只在「本地这份没动过」时才覆盖；两边都改过就保留本地并提示。
 *
 * 两条通道：先试 git（快）；github.com 连不上就自动改走 api.github.com。
 */
async function syncSource(opts) {
  const fs = require('fs');
  const path = require('path');
  const base = hexo.base_dir;
  const quiet = !!(opts && opts.quiet);

  // 通道 1：git 克隆 / 拉取
  let entries = null;
  let channel = 'git';
  let gitErr = null;
  try {
    const remote = fetchRemoteSource(opts);
    entries = listFiles(path.join(remote.dir, 'source'), 'source').map((rel) => ({
      rel: rel,
      read: () => fs.readFileSync(path.join(remote.dir, rel))
    }));
  } catch (e) {
    gitErr = e;
  }

  // 通道 2：GitHub API（github.com 被墙 / 502 时）
  if (!entries) {
    try {
      const gh = ghClient();
      const t = await gh.treeMap(SRC_BRANCH);
      channel = 'api';
      entries = Object.keys(t.map)
        .filter((p) => p.indexOf('source/') === 0)
        .map((p) => ({
          rel: p,
          sha: t.map[p].sha,
          read: async () => await gh.readBlob(t.map[p].sha)
        }));
    } catch (e2) {
      const e3 = new Error(
        (gitErr && gitErr.message ? gitErr.message : '取回失败') + '；备用通道也失败：' + (e2 && e2.message ? e2.message : e2)
      );
      throw e3;
    }
  }

  const state = loadSyncState();
  const firstRun = Object.keys(state).length === 0;
  const removedBefore = loadRemovedState();
  const newlyRemoved = [];
  const nextState = {};
  const added = [];
  const updated = [];
  const localOnly = [];
  const localRemoved = [];
  const conflicts = [];

  for (const ent of entries) {
    const rel = ent.rel;
    const lAbs = path.join(base, rel);

    // API 通道的省流量优化：本地文件的 git blob 指纹和线上一样，就不用下载内容了
    if (ent.sha && fs.existsSync(lAbs)) {
      const localBuf = fs.readFileSync(lAbs);
      if (require('./gh').blobSha(localBuf) === ent.sha) {
        nextState[rel] = contentKey(localBuf);
        continue;
      }
    }

    const rBuf = await ent.read();
    const rSha = contentKey(rBuf);
    nextState[rel] = rSha;

    if (!fs.existsSync(lAbs)) {
      // 上次同步时这个文件还在、现在本地没有了 → 说明是改名或主动删除，
      // 不能拉回来（否则改名的文件会永远删不掉）。发布时会把它从线上移除。
      if (state[rel] || removedBefore.indexOf(rel) !== -1) {
        nextState[rel] = rSha;
        newlyRemoved.push(rel);
        continue;
      }
      fs.mkdirSync(path.dirname(lAbs), { recursive: true });
      fs.writeFileSync(lAbs, rBuf);
      added.push(rel);
      continue;
    }
    const lSha = contentKey(fs.readFileSync(lAbs));
    if (lSha === rSha) continue;

    const baseSha = state[rel];
    if (baseSha && lSha === baseSha) {
      // 本地没动过、线上变了 → 放心覆盖
      fs.writeFileSync(lAbs, rBuf);
      updated.push(rel);
    } else if (baseSha && rSha === baseSha) {
      // 只有本地改了、线上没动 → 什么都不做（publish 时才推上去）
      localOnly.push(rel);
    } else {
      // 两边都改了（或首次同步就对不上）→ 保留本地，提示用户
      conflicts.push(rel);
    }
  }

  saveSyncState(nextState);
  if (newlyRemoved.length) {
    saveRemovedState(newlyRemoved);
    if (!quiet) {
      console.log('  本地改名/删除了 ' + newlyRemoved.length + ' 个文件（发布时将从线上移除）：');
      newlyRemoved.slice(0, 8).forEach((f) => console.log('    - ' + f));
    }
  }

  const out = { added, updated, localOnly, conflicts, channel, firstRun };
  if (quiet) return out;
  if (channel === 'api') {
    console.log('  （github.com 连不上，已自动改用 api.github.com 通道，不影响结果）');
  }
  if (!added.length && !updated.length && !localOnly.length && !conflicts.length) {
    console.log('  本地已经是最新的，没有需要拉取的内容。');
  } else {
    if (added.length) {
      console.log('  新增 ' + added.length + ' 个文件（线上有、本地原来没有）：');
      added.forEach((f) => console.log('    + ' + f));
    }
    if (updated.length) {
      console.log('  更新 ' + updated.length + ' 个文件：');
      updated.forEach((f) => console.log('    ~ ' + f));
    }
    if (localOnly.length) {
      console.log('  本地有 ' + localOnly.length + ' 个改动还没发布（publish 时会推上去）：');
      localOnly.slice(0, 8).forEach((f) => console.log('    * ' + f));
    }
    if (conflicts.length) {
      console.log('');
      console.log('  有 ' + conflicts.length + ' 个文件本地与线上不一致' + (firstRun ? '（首次同步，没有比对基准）' : '，两边都改过') + '，已保留【本地】版本：');
      conflicts.forEach((f) => console.log('    ! ' + f));
      console.log('  想要线上那版：把该文件改名备份后重跑本命令；');
      console.log('  想让线上用本地这版：直接 publish 就会覆盖过去。');
    }
  }
  return { added: added, updated: updated, localOnly: localOnly, conflicts: conflicts };
}

async function publishSource() {
  const fs = require('fs');
  const path = require('path');
  const base = hexo.base_dir;

  // 先拉一次：确保手机/网页上写的文章先在本地落地，再一起推回去
  try {
    const s = await syncSource({ quiet: true });
    if (s.added.length || s.updated.length) {
      sub('先从云端取回 ' + (s.added.length + s.updated.length) + ' 个新文件（你在手机或网页上写的）');
    } else {
      sub('云端没有新内容，本地就是最新的');
    }
    if (s.conflicts.length) {
      sub('有 ' + s.conflicts.length + ' 个文件两边都改过，本次以本地版本为准');
    }
  } catch (e) {
    sub('取回云端源码失败，跳过同步直接发布：' + (e && e.message ? e.message : e));
  }

  // 发布前先把整个 source 备份一份，出任何事都能一键还原
  const bk = backupSource('');
  if (bk) sub('已备份当前文章到 ' + bk + '（想还原就双击「6-恢复备份.bat」）');

  // 通道 A：git（快）
  let gitFail = null;
  try {
    await publishViaGit();
    return;
  } catch (e) {
    gitFail = e;
    console.log('');
    sub('git 通道失败：' + (e && e.message ? e.message : e));
    sub('自动改用 api.github.com 通道重试（通常能绕过 github.com 连不上的问题）…');
  }

  // 通道 B：GitHub API
  await publishViaApi();
}

async function publishViaGit() {
  const fs = require('fs');
  const path = require('path');
  const base = hexo.base_dir;

  const remote = fetchRemoteSource({});
  const dir = remote.dir;
  const cred = remote.info.cred;
  const authUrl = remote.info.authUrl;

  // 把本地源码覆盖到副本上（只复制站点真正需要的文件）
  for (const f of MANAGED_FILES) {
    const s = path.join(base, f);
    if (fs.existsSync(s)) fs.copyFileSync(s, path.join(dir, f));
  }
  for (const d of MANAGED_DIRS) {
    const s = path.join(base, d);
    if (fs.existsSync(s)) fs.cpSync(s, path.join(dir, d), { recursive: true });
  }

  // 3. 看看动了哪些文件
  // 防护：Tina 构建会生成 source/admin/.gitignore（忽略 index.html 和 assets/），
  // 它会让 git 把后台的新 bundle 全部跳过不发布（线上 404），必须在 add 前删掉。
  const adminGitignore = path.join(dir, 'source', 'admin', '.gitignore');
  if (fs.existsSync(adminGitignore)) {
    fs.rmSync(adminGitignore);
    sub('已清理 source/admin/.gitignore（Tina 生成，会导致后台资源漏传）');
  }
  runGit(['add', '-A'], dir);
  let st = runGit(['status', '--porcelain'], dir);
  let changed = st.out.split('\n').map((l) => l.trim()).filter(Boolean);
  let deleted = changed.filter((l) => l.startsWith('D'));

  // 删除规则：只删「认得」的（上次发布清单或云端同步记录里有的，= 改名/主动删除）；
  // 不认识的线上文件仍然保留，防误删。
  if (deleted.length) {
    const paths = deleted.map((l) => l.replace(/^D\s+/, '').replace(/^"(.*)"$/, '$1'));
    const known = knownPublishedFiles();
    const keep = [];
    const allow = [];
    for (const p of paths) {
      if (known.has(p)) allow.push(p);
      else keep.push(p);
    }
    if (keep.length) {
      runGit(['restore', '--source=HEAD', '--staged', '--worktree', '--'].concat(keep), dir);
      sub('有 ' + keep.length + ' 个文件本地没有但发布清单里不认识，已按线上版本保留（防误删）：');
      keep.slice(0, 8).forEach((f) => console.log('           保留 ' + f));
    }
    if (allow.length) {
      sub('有 ' + allow.length + ' 个文件是改名/主动删除的（发布后将从线上移除）：');
      allow.slice(0, 12).forEach((f) => console.log('           删除 ' + f));
    }
    st = runGit(['status', '--porcelain'], dir);
    changed = st.out.split('\n').map((l) => l.trim()).filter(Boolean);
    deleted = changed.filter((l) => l.startsWith('D'));
  }

  if (changed.length === 0) {
    console.log('');
    sub('没有检测到任何改动 —— 不用发布。');
    sub('（如果你在网页里改过文章，那些改动已经在线上了，本地不用重复发。）');
    return;
  }
  sub('这次要上传的文件（' + changed.length + ' 个）：');
  changed.slice(0, 12).forEach((l) => console.log('           ' + l.replace(/^([AMDR?]+)\s+/, '$1  ')));
  if (changed.length > 12) console.log('           …还有 ' + (changed.length - 12) + ' 个');

  // 4. 提交并推送源码
  const msg = 'publish from local: ' + new Date().toISOString().replace('T', ' ').slice(0, 19);
  const c = runGit(['commit', '-m', msg], dir);
  if (c.code !== 0) {
    throw new Error('提交失败：' + (c.text.split('\n')[0] || '未知'));
  }
  sub('已提交，正在推送到 ' + SRC_BRANCH + ' 分支…');
  const p = runGit(['push', authUrl, 'HEAD:' + SRC_BRANCH], dir);
  if (p.code !== 0) {
    const e = new Error('推送失败（git 退出码 ' + p.code + '）');
    e.gitOutput = p.text.split(cred.token).join('****');
    throw e;
  }
  sub('上传成功（git 通道）');
  // 记录本次发布的文件清单，下次改名/删除时作为「认得」的依据
  savePublishState(localManagedFiles());
}

/** 走 api.github.com 的发布：只上传内容真的变了的文件，永不删除线上文件 */
async function publishViaApi() {
  const fs = require('fs');
  const path = require('path');
  const base = hexo.base_dir;
  const gh = ghClient();
  const mod = require('./gh');

  let t;
  try {
    t = await gh.treeMap(SRC_BRANCH);
  } catch (e) {
    throw new Error('连 api.github.com 也失败了：' + (e && e.message ? e.message : e) + '。请检查网络或换用手机热点再试。');
  }

  const files = localManagedFiles();
  const upserts = {};
  let same = 0;
  for (const rel of files) {
    const buf = fs.readFileSync(path.join(base, rel));
    const sha = mod.blobSha(buf);
    const r = t.map[rel];
    if (r && r.sha === sha) {
      same++;
      continue;
    }
    upserts[rel] = buf;
  }

  // 线上「认得」但本地没有的文件 → 一并删除（改名/主动删除的旧文件）
  const known = knownPublishedFiles();
  const localSet = new Set(files);
  const deletes = Object.keys(t.map)
    .filter((rel) => {
      const managed = MANAGED_FILES.indexOf(rel) !== -1 || MANAGED_DIRS.some((d) => rel.indexOf(d + '/') === 0);
      return managed && !localSet.has(rel) && known.has(rel);
    });
  if (deletes.length) {
    sub('将同步移除 ' + deletes.length + ' 个已改名/删除的线上文件：');
    deletes.slice(0, 12).forEach((f) => console.log('           -  ' + f));
  }

  const n = Object.keys(upserts).length;
  if (!n && !deletes.length) {
    console.log('');
    sub('没有检测到任何改动 —— 不用发布。');
    return;
  }
  sub('这次要上传的文件（' + n + ' 个，' + same + ' 个没变已跳过）：');
  Object.keys(upserts).slice(0, 12).forEach((f) => console.log('           +  ' + f));
  if (n > 12) console.log('           …还有 ' + (n - 12) + ' 个');

  const msg = 'publish from local: ' + new Date().toISOString().replace('T', ' ').slice(0, 19);
  const r = await gh.apply({ branch: SRC_BRANCH, message: msg, upserts: upserts, deletes: deletes });
  sub('上传成功（api 通道，提交 ' + String(r.sha).slice(0, 7) + '）');
  savePublishState(localManagedFiles());
}

const cmd = (process.argv[2] || 'help').toLowerCase();
const hexo = new Hexo(process.cwd(), { silent: false });
// Hexo 插件（渲染器、后台等）依赖这个全局变量
global.hexo = hexo;

async function main() {
  await hexo.init();

  if (cmd === 'server') {
    console.log('');
    console.log('  启动本地写作服务（启动后浏览器会自动打开）');
    beginSteps(2);

    // 挂一个本地表单页 /site：改标题、头像、首页大图不用手工改 yml
    try {
      require('./site-editor').register(hexo, {
        publish: async () => {
          await hexo.call('clean', {});
          await hexo.call('generate', {});
          ensureGit();
          await publishSource();
          return 'pushed';
        },
      });
    } catch (e) {
      console.log('  （站点信息页没加载成功：' + (e && e.message ? e.message : e) + '）');
    }

    // 先探测端口：已占用就直接说清楚，不要让 hexo 抛一堆 FATAL
    const busy = await new Promise((res) => {
      const s = require('net').createServer();
      s.once('error', (e) => res(e && e.code === 'EADDRINUSE'));
      s.once('listening', () => s.close(() => res(false)));
      s.listen(4000);
    });
    if (busy) {
      console.log('  4000 端口已经有服务在跑了 —— 说明之前那个预览/后台窗口还开着，不用再启动一次。');
      printLinks('直接打开下面任意一个地址就能用：');
      const u = openPath();
      openBrowser('http://localhost:4000' + u);
      try {
        await hexo.exit();
      } catch (e) {}
      return;
    }

    step('检查云端有没有新文章', '有就自动拉下来，保证你看到的是最新版');
    try {
      ensureGit();
      const s = await syncSource({ quiet: true, timeout: 20000 });
      if (s.added.length || s.updated.length) {
        sub('已从云端同步 ' + (s.added.length + s.updated.length) + ' 个文件到本地');
      } else {
        sub('本地已是最新');
      }
      if (s.conflicts.length) {
        sub('有 ' + s.conflicts.length + ' 个文件两边都改过，已保留本地版本');
      }
    } catch (e) {
      // 没网、令牌过期、超时……都不该挡住本地写文章
      sub('跳过自动同步（' + (e && e.message ? e.message : e) + '）');
      sub('不影响写文章；想手动同步就双击「4-同步云端文章.bat」');
    }

    step('启动本地服务', '马上就好，浏览器会自动打开后台页面');
    printLinks('服务已启动，按住 Ctrl 点下面的地址就能打开：');

    try {
      await hexo.call('server', { port: 4000, draft: true, open: false });
    } catch (e) {
      if (e && (e.code === 'EADDRINUSE' || /EADDRINUSE|has been used/.test(String(e.message)))) {
        console.log('');
        console.log('  4000 端口刚才被别的程序抢走了。稍等几秒再双击本文件试试。');
        chcp(936);
        try {
          await hexo.exit();
        } catch (e2) {}
        return;
      }
      throw e;
    }
    // 服务真的监听了才开浏览器（bat 里不再靠固定等 14 秒，避免打开时还是「无法访问」）
    const pagePath = openPath();
    const target = 'http://localhost:4000' + pagePath;
    if (openBrowser(target)) console.log('  已在浏览器打开 ' + target);
    return; // server 常驻，不往下走
  }

  if (cmd === 'build') {
    await hexo.call('generate', {});
    console.log('  已生成到 public/ 目录');
  } else if (cmd === 'clean') {
    await hexo.call('clean', {});
    console.log('  已清理');
  } else if (cmd === 'restore') {
    const fs = require('fs');
    const pathMod = require('path');
    const list = listBackups();
    console.log('');
    if (!list.length) {
      console.log('  目前还没有任何备份。');
      console.log('  备份是每次「发布到网站」时自动生成的，发过一次就会有。');
    } else {
      console.log('  可用的备份（新的在上面，每份都含当时完整的 source 文章目录）：');
      list.forEach((dir, i) => {
        let n = 0;
        try {
          n = listFiles(pathMod.join(dir, 'source'), '').length;
        } catch (e) {}
        console.log('    ' + (i + 1) + ') ' + pathMod.basename(dir) + '   （' + n + ' 个文件）');
      });
      console.log('');
      // 三种进入方式：带编号参数（node run.js restore 2）、交互选、非交互默认最新
      let ans = String(process.argv[3] || '').trim();
      if (!ans && process.stdin.isTTY) {
        const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
        ans = await new Promise((res) => {
          rl.question('  要还原第几份？直接回车 = 第 1 份（最新）：', (a) => {
            res(String(a || '').trim());
            rl.close();
          });
        });
      }
      const idx = Math.max(1, Math.min(list.length, parseInt(ans || '1', 10) || 1)) - 1;
      const pick = list[idx];
      const keep = backupSource('before-restore');
      let n = 0;
      for (const d of ['source', 'scripts']) {
        const src = pathMod.join(pick, d);
        if (!fs.existsSync(src)) continue;
        fs.cpSync(src, pathMod.join(hexo.base_dir, d), { recursive: true });
        n += listFiles(src, '').length;
      }
      for (const f of ['_config.yml', '_config.butterfly.yml', '.pages.yml']) {
        const src = pathMod.join(pick, f);
        if (fs.existsSync(src)) fs.copyFileSync(src, pathMod.join(hexo.base_dir, f));
      }
      console.log('');
      console.log('  已还原 ' + n + ' 个文件，来源：' + pathMod.basename(pick));
      if (keep) console.log('  还原前的状态也留了一份：' + pathMod.basename(keep));
      console.log('  还原只改本地文件。要让线上也变回原样，再双击「1-发布到网站.bat」。');
    }
  } else if (cmd === 'sync') {
    beginSteps(2);

    step('检查本机环境', '确认电脑上找得到 git');
    ensureGit();

    step('从云端取回最新文章', '只下载云端比本地新的文件；你自己改过的不动，不会丢');
    const r = await syncSource({});
    console.log('');
    if (r.added.length || r.updated.length) {
      console.log('  完成！新文章已经放进 source/_posts，可以打开后台编辑了。');
    } else if (r.conflicts.length) {
      console.log('  完成！但有文件两边都改过，已保留你本地这版（明细见上）。');
    } else {
      console.log('  完成！本来就是最新的，没有东西要拉。');
    }
  } else if (cmd === 'build-admin') {
    // 重建 Tina 后台并自动打补丁、同步到发布目录（发布前或后台构建后用）
    const path = require('path');
    const { spawnSync } = require('child_process');
    // 必须用 bin 垫片调用（dist/index.js 只定义不执行）
    const cliBin = path.join(__dirname, 'node_modules', '@tinacms', 'cli', 'bin', 'tinacms');
    sub('正在构建 Tina 后台（约 1-2 分钟）…');
    const r = spawnSync(process.execPath, [cliBin, 'build', '--skip-cloud-checks', '--skip-indexing', '--skip-search-index', '--noTelemetry'], { stdio: 'inherit', cwd: __dirname });
    if (r.status !== 0) { sub('后台构建失败'); process.exit(1); }
    require('./tools/admin-patch').applyAdminPatches(__dirname);
    sub('后台构建完成（已自动打补丁并同步到发布目录）');
  } else if (cmd === 'dev') {
    // 边看边改：本地起 Tina 后台 + Hexo 站点，编辑后刷新查看；退出后自动重建后台
    const path = require('path');
    const { spawnSync, execSync } = require('child_process');
    // 必须用 bin 垫片调用（dist/index.js 只定义不执行）
    const cliBin = path.join(__dirname, 'node_modules', '@tinacms', 'cli', 'bin', 'tinacms');

    // 上次没用 Ctrl+C 正常退出时，4000/4001/9000 会被残留进程占着，导致这次起不来。
    // 这里先把「占着这些端口的 node 进程」清掉（只动 node，不动别的程序）。
    function freeDevPorts() {
      if (process.platform !== 'win32') return;
      let netstatOut = '';
      try {
        netstatOut = execSync('netstat -ano -p tcp', { encoding: 'utf8' });
      } catch (e) {
        return;
      }
      const pids = new Set();
      for (const p of [4000, 4001, 9000]) {
        const re = new RegExp(':' + p + '\\s+[^\\r\\n]*LISTENING\\s+(\\d+)');
        for (const line of netstatOut.split(/\r?\n/)) {
          const m = line.match(re);
          if (m) pids.add(m[1]);
        }
      }
      for (const pid of pids) {
        let name = '';
        try {
          const tl = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, { encoding: 'utf8' });
          name = (tl.split(',')[1] || '').replace(/"/g, '').toLowerCase();
        } catch (e) {}
        if (name.startsWith('node')) {
          try {
            execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
            sub('已清理上次没关干净的本地服务（进程 ' + pid + '，端口被占用会导致这次起不来）');
          } catch (e) {}
        }
      }
    }
    freeDevPorts();

    console.log('');
    sub('正在启动「边看边改」（首次要编译一小会儿，约 30~60 秒，别关窗口）…');
    sub('等服务就绪后，浏览器会自动打开两个标签页：编辑后台 + 本地网站。');
    sub('如果没自动打开，等窗口出现 “TinaCMS Dev Server is active” 后手动访问：');
    sub('① 编辑后台：http://localhost:4001/admin/index.html');
    sub('② 看效果：http://localhost:4000 （你的本地网站）');
    sub('保存一篇文章后，网站那边刷新一下就变了（本地服务会自动重新生成）。');
    sub('注意：这里的改动只保存在本机，想上线还要再双击「1-发布到网站.bat」。');
    sub('用完按 Ctrl+C 退出（不要直接关窗口），脚本会自动恢复后台文件。');
    console.log('');
    // 起一个助手进程：等 4000/4001 真正开始监听后，自动打开浏览器
    try {
      require('child_process')
        .spawn(
          process.execPath,
          [path.join(__dirname, 'tools', 'open-when-ready.js'), '4000', '4001', '--', 'http://localhost:4001/admin/index.html', 'http://localhost:4000'],
          { detached: true, stdio: 'ignore', cwd: __dirname }
        )
        .unref();
    } catch (e) {
      /* 自动打开失败不影响主流程 */
    }
    const r = spawnSync(process.execPath, [cliBin, 'dev', '-c', 'npx hexo server', '--noTelemetry'], { stdio: 'inherit', cwd: __dirname });
    console.log('');
    sub('预览已停止。正在重建后台（dev 会改写后台文件，必须恢复）…');
    const b = spawnSync(process.execPath, [cliBin, 'build', '--skip-cloud-checks', '--skip-indexing', '--skip-search-index', '--noTelemetry'], { stdio: 'inherit', cwd: __dirname });
    if (b.status === 0) {
      require('./tools/admin-patch').applyAdminPatches(__dirname);
      sub('已恢复。想上线改动就双击「1-发布到网站.bat」');
    } else {
      sub('后台自动重建失败，请回到对话里告诉 AI 来处理。');
    }
  } else if (cmd === 'publish') {
    console.log('');
    console.log('  发布路线：本地 → GitHub 仓库(hexo-src) → 云端自动编译 → 网站更新');
    console.log('  全程约 1-2 分钟，中途请不要关这个窗口。');
    beginSteps(4);

    step('检查本机环境', '确认电脑上找得到 node 和 git，缺了会直接提示');
    ensureGit();

    step('先在本地试编译一次', '把 source 里的文章渲染成网页。有语法错误现在就能发现，不会发到线上');
    await hexo.call('clean', {});
    await hexo.call('generate', {});
    sub('编译通过，没有报错');

    step('上传到 GitHub', '先取回云端最新源码（防止手机写的文章被覆盖），再提交和推送');
    await publishSource();

    step('完成', '');
    console.log('');
    console.log('  GitHub 正在编译，约 1-2 分钟后刷新 https://v-jinci.github.io 就能看到。');
    console.log('  想看编译进度：https://github.com/v-jinci/v-jinci.github.io/actions');
  } else if (cmd === 'publish-quick') {
    // 快速通道：跳过本地预编译（适合刚编译过、只想补传文件的场景）
    console.log('');
    console.log('  发布路线：本地 → GitHub 仓库(hexo-src) → 云端自动编译 → 网站更新');
    console.log('  （跳过本地预编译）');
    beginSteps(3);
    step('检查本机环境', '');
    ensureGit();
    step('上传到 GitHub', '先取回云端最新源码（防止手机写的文章被覆盖），再提交和推送');
    await publishSource();
    step('完成', '');
    console.log('');
    console.log('  GitHub 正在编译，约 1-2 分钟后刷新 https://v-jinci.github.io 就能看到。');
    console.log('  想看编译进度：https://github.com/v-jinci/v-jinci.github.io/actions');
  } else if (cmd === 'publish-master') {
    // 备用通道：跳过 Actions，直接把成品推到 master（Actions 出故障时用）
    console.log('');
    console.log('  [备用] 直接推送到 master（不经 GitHub Actions）…');
    console.log('  [1/2] 生成网站…');
    await hexo.call('clean', {});
    await hexo.call('generate', {});
    console.log('  [2/2] 推送到 GitHub…');
    ensureGit();
    await deployGit();
    console.log('');
    console.log('  完成！等 1-2 分钟刷新 https://v-jinci.github.io 就能看到。');
  } else if (cmd === 'new') {
    const title = process.argv.slice(3).join(' ') || '未命名';
    await hexo.call('new', { _: [title] });
    console.log('  已创建：source/_posts/' + title + '.md');
  } else if (cmd === 'gitlogin') {
    const d = Array.isArray(hexo.config.deploy) ? hexo.config.deploy[0] : hexo.config.deploy || {};
    const url = d.repo || d.repository || 'https://github.com/v-jinci/v-jinci.github.io.git';
    const m = url.match(/^https:\/\/(?:[^@/]*@)?([^/]+)\//);
    if (!m) {
      console.log('  _config.yml 里的 repo 不是 https 地址，没法用令牌登录。');
      process.exitCode = 1;
    } else {
      const host = m[1];
      const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
      // 自己维护一个行队列：一次读到多行时不会丢
      const queue = [];
      let pending = null;
      rl.on('line', (l) => {
        if (pending) {
          const done = pending;
          pending = null;
          done(l);
        } else {
          queue.push(l);
        }
      });
      rl.on('close', () => {
        if (pending) {
          const done = pending;
          pending = null;
          done('');
        }
      });
      const ask = (q) => {
        process.stdout.write(q);
        return new Promise((res) => {
          if (queue.length) res(queue.shift());
          else pending = res;
        });
      };

      console.log('');
      console.log('  只需做一次。令牌会保存在本机，之后发布全自动。');
      console.log('  没有令牌的话：GitHub → 头像 → Settings → Developer settings');
      console.log('    → Personal access tokens → Tokens (classic) → Generate new token');
      console.log('    → 勾选 repo → 生成后复制那串字符（只显示一次）');
      console.log('');

      const user = (await ask('  GitHub 用户名（直接回车 = v-jinci）：')).trim() || 'v-jinci';
      const token = (await ask('  粘贴令牌后回车（会显示出来，注意旁边没人）：')).trim();
      rl.close();

      if (!token) {
        console.log('');
        console.log('  没有输入令牌，已取消。');
        process.exitCode = 1;
      } else {
        const fs = require('fs');
        const pathMod = require('path');
        const file = pathMod.join(process.env.USERPROFILE || process.env.HOME || '.', '.git-credentials');
        let old = '';
        try {
          old = fs.readFileSync(file, 'utf8');
        } catch (e) {
          /* 首次：文件不存在 */
        }
        const kept = old
          .split(/\r?\n/)
          .filter((l) => l.trim() && !l.includes('@' + host));
        kept.push('https://' + user + ':' + token + '@' + host);
        fs.writeFileSync(file, kept.join('\n') + '\n', { mode: 0o600 });

        console.log('');
        console.log('  已保存到 ' + file);

        // 当场验证令牌是否真的能用，避免等到发布才失败
        process.stdout.write('  正在向 GitHub 验证令牌…');
        let status = '';
        try {
          const r = await fetch('https://api.github.com/user', {
            headers: { Authorization: 'Bearer ' + token, 'User-Agent': 'hexo-site', Accept: 'application/vnd.github+json' }
          });
          if (r.ok) {
            const j = await r.json();
            status = 'OK:' + j.login;
          } else if (r.status === 401) {
            status = 'BAD';
          } else {
            status = 'HTTP' + r.status;
          }
        } catch (e) {
          status = 'NET';
        }
        process.stdout.write('\n');
        if (status.indexOf('OK:') === 0) {
          const login = status.slice(3);
          console.log('  验证通过：令牌属于账号 ' + login + ' ✔');
          if (login.toLowerCase() !== user.toLowerCase()) {
            console.log('  [注意] 令牌所属账号（' + login + '）和填的用户名（' + user + '）不一致，');
            console.log('         发布时请把用户名改成 ' + login + '，否则会认证失败。');
          }
          console.log('  现在双击 「1-发布到网站.bat」 就能发布了。');
        } else if (status === 'BAD') {
          console.log('  [失败] GitHub 说这个令牌无效（401）。');
          console.log('  多半是复制少了字符，或者令牌已被撤销 / 过期。请重新生成后双击本文件再来一次。');
          process.exitCode = 1;
        } else if (status === 'NET') {
          console.log('  [跳过] 连不上 api.github.com，没法在线验证。');
          console.log('  令牌已保存，直接双击 「1-发布到网站.bat」 试试即可。');
        } else {
          console.log('  [未知] GitHub 返回 ' + status + '，令牌已保存，可先试 「1-发布到网站.bat」。');
        }
      }
    }
  } else if (cmd === 'info') {
    printLinks('写作/预览地址（按住 Ctrl 点一下就打开）：');
    console.log('  写完后点右上角 Publish 即可发布到线上。');
    console.log('  用完关掉那个 hexo-server 窗口就能停止服务。');
    console.log('');
  } else {
    console.log('用法: node run.js [server|publish|build|clean|new 标题]');
  }

  // 结束前切回 GBK，免得后面的「按任意键继续」乱码
  chcp(936);
  await hexo.exit();
}

main().catch(async (err) => {
  chcp(936);
  console.error('');
  console.error('  出错了：' + (err && err.message ? err.message : err));
  if (err && err.code) console.error('  错误码：' + err.code);
  const raw = String((err && (err.gitOutput || err.stderr)) || '');
  if (raw) {
    console.error('  —— git 原始输出 ——');
    const clean = raw.split(process.env.GITHUB_TOKEN || '\u0000').join('****');
    console.error('  ' + clean.split('\n').join('\n  '));
    console.error('  ————————————————');
  }
  console.error('');
  const isPort = err && (err.code === 'EADDRINUSE' || /EADDRINUSE/.test(String(err.message)));
  if (isPort) {
    console.error('  原因：4000 端口被占用了 —— 说明已经有一个预览/后台在运行。');
    console.error('  这不是故障：直接用浏览器打开 http://localhost:4000 就能看到网站。');
    console.error('  想重开的话，先关掉那个黑窗口（或重启电脑）再双击本文件。');
  } else if (!raw) {
    console.error('  这不是 git 的问题（没有 git 输出），把上面「出错了」那一行发给我就行。');
  } else if (/dubious ownership/i.test(raw)) {
    console.error('  原因：git 认为发布目录不属于当前用户（常见于从别处拷过来的目录）。');
    console.error('  处理：删掉 .deploy_git 文件夹后重跑 「1-发布到网站.bat」 即可（这个目录可以随时重建）。');
  } else if (/not a git repository/i.test(raw)) {
    console.error('  原因：环境里有个 GIT_DIR 变量，把 git 指向了错误的目录（不是站点目录）。');
    console.error('  处理：本次运行已自动忽略它；若仍出现，删掉 .deploy_git 后重跑 「1-发布到网站.bat」。');
  } else if (/Authentication failed|Invalid username or password|Permission to .* denied|403|401/i.test(raw)) {
    console.error('  原因：令牌被 GitHub 拒绝（可能已撤销、过期，或没勾 repo 权限）。');
    console.error('  处理：重新生成一个 classic 令牌（勾 repo），再双击 「5-首次配置GitHub.bat」 覆盖一次。');
  } else if (/CONNECT tunnel|Could not resolve host|Failed to connect|Connection (reset|refused)|timed out|proxy|PROXY|Empty reply from server|RPC failed|early EOF|SSL|TLS/i.test(raw)) {
    console.error('  原因：网络没连上 github.com（代理 / 防火墙 / 加速器，或者只是临时抖动）。');
    console.error('  处理：① 过 1-2 分钟重试一次（这种「空响应 / 502」绝大多数是临时的）；');
    console.error('        ② 关掉系统代理或加速器再试；③ 换手机热点试一次，能快速判断是不是网络问题；');
    console.error('        ④ 实在不行把这段发我，我改走 GitHub API 通道帮你推。');
  } else if (/not found|does not appear to be a git repository|Repository not found/i.test(raw)) {
    console.error('  原因：仓库地址不对，或令牌对应账号没有这个仓库的写权限。');
    console.error('  处理：确认 https://github.com/v-jinci/v-jinci.github.io 能在浏览器打开且你能推送。');
  } else {
    console.error('  以上是 git 的原始报错，把它发给我我来判断。');
  }
  console.error('');
  if (isPort) {
    console.error('  （后端已正常启动过，只是这个窗口没抢到端口。）');
  } else {
    console.error('  把上面那几行发给我就行，前面的生成列表不用带。');
  }
  try {
    await hexo.exit();
  } catch (e) {}
  process.exit(1);
});

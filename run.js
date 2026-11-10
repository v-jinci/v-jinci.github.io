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
function runGit(args, cwd, extraEnv) {
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
  const r = cp.spawnSync('git', ['-c', 'safe.directory=*'].concat(args), {
    cwd: cwd,
    env: env,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024
  });
  if (r.error) throw new Error('执行 git 失败：' + r.error.message);
  const out = r.stdout || '';
  const err = r.stderr || '';
  return { code: r.status, out: out, err: err, text: (out + err).trim() };
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
    const e = new Error('没有找到 GitHub 令牌。请先双击 setup-github.bat 粘贴一次。');
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
async function publishSource() {
  const fs = require('fs');
  const path = require('path');
  const base = hexo.base_dir;
  const srcBranch = 'hexo-src';
  const cfg = Array.isArray(hexo.config.deploy) ? hexo.config.deploy[0] : hexo.config.deploy || {};
  const rawUrl = cfg.repo || cfg.repository || '';
  if (!rawUrl) throw new Error('_config.yml 里的 deploy.repo 没有配置。');

  const m = rawUrl.replace(/^https:\/\/(?:[^@/]+@)?/, '').match(/^([^/]+)(\/.*)?$/);
  const host = m ? m[1] : 'github.com';
  const pathPart = (m && m[2]) || '/v-jinci/v-jinci.github.io.git';
  const cleanUrl = 'https://' + host + pathPart;

  const cred = readCred(host);
  if (!cred.token) throw new Error('没有找到 GitHub 令牌。请先双击 setup-github.bat 粘贴一次。');
  const authUrl = 'https://' + cred.user + ':' + cred.token + '@' + host + pathPart;

  // 1. 准备一个干净的源码副本仓库（位于 .src_git，不进版本库）
  const dir = path.join(base, '.src_git');
  if (!fs.existsSync(path.join(dir, '.git'))) {
    fs.rmSync(dir, { recursive: true, force: true });
    console.log('  首次同步：从线上取回源码…');
    const c = runGit(['clone', '--depth', '1', '--branch', srcBranch, authUrl, dir], base);
    if (c.code !== 0) {
      const e = new Error('取回源码失败（git 退出码 ' + c.code + '）');
      e.gitOutput = c.text.split(cred.token).join('****');
      throw e;
    }
    runGit(['remote', 'set-url', 'origin', cleanUrl], dir);
  } else {
    const f = runGit(['fetch', '--depth', '1', authUrl, srcBranch], dir);
    if (f.code !== 0) {
      const e = new Error('同步线上源码失败（git 退出码 ' + f.code + '）');
      e.gitOutput = f.text.split(cred.token).join('****');
      throw e;
    }
    runGit(['reset', '--hard', 'FETCH_HEAD'], dir);
  }
  runGit(['config', 'user.name', cred.user], dir);
  runGit(['config', 'user.email', cred.user + '@users.noreply.github.com'], dir);
  runGit(['config', 'core.quotepath', 'false'], dir);

  // 2. 把本地源码覆盖到副本上（只复制站点真正需要的文件）
  const files = ['_config.yml', '_config.butterfly.yml', 'package.json', 'package-lock.json', '.gitignore', 'run.js', 'README-使用说明.md'];
  for (const f of files) {
    const s = path.join(base, f);
    if (fs.existsSync(s)) fs.copyFileSync(s, path.join(dir, f));
  }
  for (const d of ['source', 'scaffolds', '.github']) {
    const s = path.join(base, d);
    if (fs.existsSync(s)) fs.cpSync(s, path.join(dir, d), { recursive: true });
  }

  // 3. 看看动了哪些文件
  runGit(['add', '-A'], dir);
  const st = runGit(['status', '--porcelain'], dir);
  const changed = st.out.split('\n').map((l) => l.trim()).filter(Boolean);
  const deleted = changed.filter((l) => l.startsWith('D'));
  if (changed.length === 0) {
    console.log('');
    console.log('  没有检测到任何改动 —— 不用发布。');
    console.log('  （如果你在网页里改过文章，改动已经在线上，本地不用重复发。）');
    return;
  }
  console.log('  改动的文件（' + changed.length + ' 个）：');
  changed.slice(0, 12).forEach((l) => console.log('    ' + l.replace(/^([AMDR?]+)\s+/, '$1  ')));
  if (changed.length > 12) console.log('    …还有 ' + (changed.length - 12) + ' 个');
  if (deleted.length) {
    console.log('  注意：有 ' + deleted.length + ' 个文件在线上存在、本地已删除，本次不会删除它们。');
  }

  // 4. 提交并推送源码
  const msg = 'publish from local: ' + new Date().toISOString().replace('T', ' ').slice(0, 19);
  const c = runGit(['commit', '-m', msg], dir);
  if (c.code !== 0) {
    console.log('  提交失败：' + (c.text.split('\n')[0] || '未知'));
    return;
  }
  console.log('  推送到 ' + srcBranch + ' 分支…');
  const p = runGit(['push', authUrl, 'HEAD:' + srcBranch], dir);
  if (p.code !== 0) {
    const e = new Error('推送失败（git 退出码 ' + p.code + '）');
    e.gitOutput = p.text.split(cred.token).join('****');
    throw e;
  }
  console.log('  已推送。');
}

const cmd = (process.argv[2] || 'help').toLowerCase();
const hexo = new Hexo(process.cwd(), { silent: false });
// Hexo 插件（渲染器、后台等）依赖这个全局变量
global.hexo = hexo;

async function main() {
  await hexo.init();

  if (cmd === 'server') {
    console.log('');
    console.log('  本地地址： http://localhost:4000');
    console.log('  写作后台： http://localhost:4000/admin   (账号 admin / 密码 weiblog2026)');
    console.log('  停止服务： 在这个窗口按 Ctrl + C');
    console.log('');

    // 先探测端口：已占用就直接说清楚，不要让 hexo 抛一堆 FATAL
    const busy = await new Promise((res) => {
      const s = require('net').createServer();
      s.once('error', (e) => res(e && e.code === 'EADDRINUSE'));
      s.once('listening', () => s.close(() => res(false)));
      s.listen(4000);
    });
    if (busy) {
      console.log('  4000 端口已经有服务在跑了 —— 说明之前那个预览/后台窗口还开着。');
      console.log('  这不是故障，直接用浏览器打开 http://localhost:4000 就能用。');
      console.log('  想重新启动的话：先把那个黑窗口按 Ctrl + C 关掉，再双击本文件。');
      chcp(936);
      try {
        await hexo.exit();
      } catch (e) {}
      return;
    }

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
    return; // server 常驻，不往下走
  }

  if (cmd === 'build') {
    await hexo.call('generate', {});
    console.log('  已生成到 public/ 目录');
  } else if (cmd === 'clean') {
    await hexo.call('clean', {});
    console.log('  已清理');
  } else if (cmd === 'publish') {
    console.log('');
    console.log('  正在发布：本地源码 → hexo-src 分支 → GitHub 自动编译 → 线上');
    console.log('  大约 1-2 分钟，中途请不要关窗口。');
    console.log('');
    console.log('  [1/3] 先本地编译一次，确认没问题…');
    await hexo.call('clean', {});
    await hexo.call('generate', {});
    console.log('       编译通过。');
    console.log('  [2/3] 同步线上源码并提交本地改动…');
    ensureGit();
    await publishSource();
    console.log('  [3/3] 触发云端构建…');
    console.log('');
    console.log('  完成！GitHub 正在编译，约 1-2 分钟后刷新 https://v-jinci.github.io 就能看到。');
    console.log('  想看进度：https://github.com/v-jinci/v-jinci.github.io/actions');
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
          console.log('  现在双击 publish.bat 就能发布了。');
        } else if (status === 'BAD') {
          console.log('  [失败] GitHub 说这个令牌无效（401）。');
          console.log('  多半是复制少了字符，或者令牌已被撤销 / 过期。请重新生成后双击本文件再来一次。');
          process.exitCode = 1;
        } else if (status === 'NET') {
          console.log('  [跳过] 连不上 api.github.com，没法在线验证。');
          console.log('  令牌已保存，直接双击 publish.bat 试试即可。');
        } else {
          console.log('  [未知] GitHub 返回 ' + status + '，令牌已保存，可先试 publish.bat。');
        }
      }
    }
  } else if (cmd === 'info') {
    console.log('');
    console.log('  写作后台： http://localhost:4000/admin');
    console.log('  账号： admin        密码： weiblog2026');
    console.log('');
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
    console.error('  处理：删掉 .deploy_git 文件夹后重跑 publish.bat 即可（这个目录可以随时重建）。');
  } else if (/not a git repository/i.test(raw)) {
    console.error('  原因：环境里有个 GIT_DIR 变量，把 git 指向了错误的目录（不是站点目录）。');
    console.error('  处理：本次运行已自动忽略它；若仍出现，删掉 .deploy_git 后重跑 publish.bat。');
  } else if (/Authentication failed|Invalid username or password|Permission to .* denied|403|401/i.test(raw)) {
    console.error('  原因：令牌被 GitHub 拒绝（可能已撤销、过期，或没勾 repo 权限）。');
    console.error('  处理：重新生成一个 classic 令牌（勾 repo），再双击 setup-github.bat 覆盖一次。');
  } else if (/CONNECT tunnel|Could not resolve host|Failed to connect|Connection (reset|refused)|timed out|proxy|PROXY/i.test(raw)) {
    console.error('  原因：网络连不上 github.com（代理 / 防火墙 / 加速器导致）。');
    console.error('  处理：① 关掉系统代理或加速器再试；② 或在「设置 → 网络 → 代理」里确认没开无效代理；');
    console.error('        ③ 若用了 hosts 或 DNS 加速，临时关掉；④ 换手机热点试一次可快速判断是不是网络问题。');
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

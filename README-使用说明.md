# 玮的博客 · 本地使用说明

站点用 **Hexo 7 + Butterfly 5** 搭建，写作靠一个网页后台，不用敲命令。

---

## 一、三个 bat，双击就完事

| 双击这个 | 作用 |
| --- | --- |
| `setup-github.bat` | **只需一次**：粘贴 GitHub 令牌，之后发布全自动 |
| `start-admin.bat` | 启动 **写作后台**，自动打开 `http://localhost:4000/admin` |
| `preview.bat` | 只看不改：本地预览网站效果 |
| `publish.bat` | 发布：把源码推到 `hexo-src` 分支 → GitHub 自动编译 → 线上生效 |

后台账号：`admin`
后台密码：`weiblog2026`

> 想改密码跟我说一声，我重新生成一段加密串写进 `_config.yml`。

### 发布是怎么走的

```
改文章（本地后台 / 记事本 / 手机上）
   ↓
hexo-src 分支（源码：_posts、_config.yml）
   ↓  GitHub Actions 自动编译（约 1 分钟，免费）
master 分支（编译后的网页）
   ↓
https://v-jinci.github.io
```

好处：**本地发布和网页编辑走的是同一条流水线，不会互相覆盖**。`publish.bat` 每次会先取回线上最新的源码，再叠加上你的改动，所以你在别处写过的文章不会丢。

- 看构建进度：https://github.com/v-jinci/v-jinci.github.io/actions
- `publish.bat` 若提示「没有检测到任何改动」，说明本地和线上一致，不用发。

---

## 二、写一篇日志（三步）

1. 双击 `start-admin.bat`，浏览器会打开后台。
2. 点 **Posts → 右上角 New Post**，**先填一个真标题**（留空的话会自动叫「日期2026年11月10日」这种名字），再写正文。左边写 Markdown，右边实时预览。
3. 写完点右上角 **Publish**，等 1-2 分钟线上就有了。

不想走后台也行：把 `.md` 文件丢进 `source/_posts/`，一样会被识别。

### Markdown 最常用的几个

```markdown
## 二级标题
**加粗**  *斜体*  [链接](https://example.com)
- 无序列表
1. 有序列表

> 引用一段话

![图片说明](图片名.jpg)
```

---

## 三、在任何设备上写（Pages CMS 表单后台）

不想开电脑、想在手机浏览器里写的时候用这个。保存后 GitHub 自动编译，1-2 分钟上线，电脑可以一直关着。

### 一次性开通（三步，约 2 分钟）

1. 电脑打开 https://pagescms.org → 点 **Sign in with GitHub**，用 `v-jinci` 账号授权。
2. 点 **Add repository**，选 `v-jinci/v-jinci.github.io`。
   若列表里没有它，在 GitHub 的授权页点 **Grant / Select repositories** 把这个仓库加进去。
3. **分支一定选 `hexo-src`**，不要选 `master`。
   `master` 是编译后的成品页面，在那儿改等于白改，下一次构建就被覆盖。

进去之后左侧应看到两组：**文章**、**独立页面**（关于 / 友链 / 留言板 / 编年史）。

### 怎么用

- 点 **文章 → New**：标题、发布日期、摘要、标签、分类都是表单，正文是富文本编辑器，可以直接往里面拖图片。
- 改完点 **Save**，等 1-2 分钟刷新线上就有了。
- 构建进度：https://github.com/v-jinci/v-jinci.github.io/actions

### 四个注意

1. **新建文章的文件名 = 标题**，所以标题别带 `/` `:` `*` 这类字符。
2. 图片会上传到 `source/img/`，正文里自动写成 `/img/xxx.png`，本地 Hexo 同样能用。
3. 表单里没列出的 front-matter（`top_img`、`type` 等）**不会丢** —— `.pages.yml` 里开了 `settings.content.merge: true`，这是关键，别删。
4. 如果保存时它提示要创建 **Pull Request**（部分版本这样），去 GitHub 点一下 **Merge** 即可，同样会触发构建。

> 手机适合短篇和随手记；长文还是本地后台（`start-admin.bat`）或 Typora 更舒服。

---

## 四、图片怎么放

已经开了「文章资源文件夹」。新建文章时，Hexo 会同时建一个**同名文件夹**，
把图片拖进去，正文里写 `![说明](图片名.jpg)` 即可，不用管路径。

---

## 五、想改站点信息，只改这两个文件

| 文件 | 改什么 |
| --- | --- |
| `_config.yml` | 站点标题、副标题、作者、网址、每页文章数 |
| `_config.butterfly.yml` | 顶部导航、头像、个人简介、侧边栏卡片、深色模式、搜索 |

改完 `Ctrl+C` 关掉服务窗口，再双击 `start-admin.bat` 就能看到变化。

---

## 六、第一次发布要准备 GitHub 令牌

发布配置已经写好了：

```yaml
repo: https://github.com/v-jinci/v-jinci.github.io.git
branch: master
```

GitHub 早就不允许用登录密码推送了，需要一次性弄个令牌：

1. 打开 GitHub → 右上头像 → **Settings** → 左侧最下 **Developer settings**
   → **Personal access tokens** → **Tokens (classic)** → **Generate new token**
2. 勾选 `repo` 和 `workflow` 两项（`workflow` 是自动编译必需的），生成后**复制那串字符**（只显示一次）
3. 双击 `setup-github.bat`，粘贴一次令牌。它会当场向 GitHub 验证，通过才算成功。
4. 之后双击 `publish.bat` 就是全自动的，不会再问账号密码。

> 换电脑、令牌过期或被撤销时，重跑一次 `setup-github.bat` 覆盖即可。

---

## 七、目录结构（知道这几个就够）

```
_config.yml            站点主配置
_config.butterfly.yml  主题配置
run.js                 启动器（不用改，除非换端口）
source/_posts/         所有文章，一篇一个 md
source/about/          关于页
source/link/           友链页
source/messageBoard/   留言板
source/history/        编年史
scaffolds/post.md      新建文章时的模板（可自己改默认抬头）
.github/workflows/     自动编译规则（改坏了线上就不会更新，别乱动）
.pages.yml             网页版表单后台（Pages CMS）的字段配置
.src_git/              发布时用的临时副本（可随时删，会自动重建）
public/                生成出来的网页（自动生成，别手动改）
```

---

## 八、遇到问题

- **提示 `'node' 不是内部或外部命令`**：本机没装 Node.js。`_run.bat` 会自动去找可用的 node.exe（
  系统安装的 → `C:\Program Files\nodejs` → WorkBuddy 自带的那份），正常情况下双击 bat 不会报错。
  如果仍然报“Node.js not found”，装一个 [Node.js LTS](https://nodejs.org) 即可。
- **提示 4000 端口被占用**：说明已经有一个预览/后台窗口开着。这不是故障，直接用浏览器打开
  http://localhost:4000 就能用；想重启就先关掉那个黑窗口（按 `Ctrl + C`）再双击。
  实在想换端口：改 `run.js` 里两处 `4000` 为 `4001`。
- **页面样式没更新**：`publish.bat` 会先清理再生成，正常不会出现；本地预览按 `Ctrl+F5` 强刷。
- **文章 404**：检查文件名和 front-matter 里的 `title`、`date` 是否正常。
- **发布失败**：`publish.bat` 现在会把 git 的原始报错原样打出来，并直接说明原因（令牌无效 / 网络代理 / 目录权限）。
  按它给的提示处理即可，不用猜。最常见两种：
  - 令牌被拒（`Authentication failed`）→ 重新生成令牌，跑 `setup-github.bat` 覆盖；
  - 连不上 GitHub（`CONNECT tunnel` / `Could not resolve host`）→ 关掉代理或加速器再试。
- **任何报错**：把黑窗口里 `—— git 原始输出 ——` 那几行发给我即可，前面的生成列表不用带。

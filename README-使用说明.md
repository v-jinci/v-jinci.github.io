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
| `sync.bat` | 把云端（手机/网页上写的）文章拉回本地 |

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

## 四、把云端的文章同步回本地

在手机 / 网页上写的文章，存在 GitHub 上，本地 `source/_posts` 里一开始是**没有**的。三种同步方式：

| 方式 | 怎么触发 | 适合 |
| --- | --- | --- |
| 手动 | 双击 `sync.bat` | 想起来了点一下 |
| **启动时自动** | 双击 `start-admin.bat` 或 `preview.bat` 时，先拉一次再启动 | 推荐，平时不用管 |
| 定时自动 | Windows 任务计划（见本节目末） | 电脑长期开着 |

### 覆盖规则（四句话）

1. 线上有、本地没有 → **直接拉下来**（新文章）
2. 线上改了、本地没动过 → **用线上的覆盖本地**
3. 只有本地改了 → **不动**，等你 `publish` 时推上去（会提示「本地有 N 个改动还没发布」）
4. 两边都改了 → **保留本地**，把文件名列出来让你自己决定

判断依据是根目录的 `.sync-state.json`：记录上次同步时每个文件的指纹（文本文件忽略 CRLF/LF 差异，所以不会因为换行不同就误判）。这个文件可以删，删了不影响使用，只是下次同步没有比对基准，会按「保留本地」处理。

### 让它定时自动跑

`sync.bat` 结尾有 `pause`（方便你看结果），不适合放到计划任务里。用 `_run.bat` 更合适：

```bat
schtasks /Create /TN "BlogSync" /TR "cmd /c \"C:\Users\renwe\WorkBuddy\2026-11-10-18-43-13\_run.bat\" sync" /SC MINUTE /MO 30 /F
```

删掉：`schtasks /Delete /TN "BlogSync" /F`

> 这条命令要改系统计划任务，我没替你执行。想装的话跟我说一声，我帮你跑。

---

## 五、图片怎么放

已经开了「文章资源文件夹」。新建文章时，Hexo 会同时建一个**同名文件夹**，
把图片拖进去，正文里写 `![说明](图片名.jpg)` 即可，不用管路径。

---

## 六、想改站点信息，只改这两个文件

| 文件 | 改什么 |
| --- | --- |
| `_config.yml` | 站点标题、副标题、作者、网址、每页文章数 |
| `_config.butterfly.yml` | 顶部导航、头像、个人简介、侧边栏卡片、深色模式、搜索 |

改完 `Ctrl+C` 关掉服务窗口，再双击 `start-admin.bat` 就能看到变化。

### 换背景大图 / 头像 / favicon

**推荐：用表单页改，不碰代码。** 双击 `start-admin.bat` 启动后，浏览器打开
<http://localhost:4000/site>，页面上直接改：

| 表单里能改 | 效果 |
| --- | --- |
| 站点标题 / 作者 / 副标题 / 描述 / 关键词 | 浏览器标签、左上角、搜索引擎摘要 |
| 首页轮播标语（一行一句） | 首页大图下面逐字打出来的那几句 |
| 首页顶部大图 | 选一张图上传即可，自动存到 `source/img/` |
| 侧边栏头像 | 选图上传，正方形最好 |
| 作者简介 / 公告 / 页脚起始年份 | 侧边栏卡片和页脚文案 |

改完点「保存」，预览页立刻更新；点「保存并发布到线上」就推送并触发云端编译，
1-2 分钟后网站更新。**这个页面只在本机开着服务时能访问，别人打不开，安全。**

想手工改也行：图片都放在 `source/img/` 里，然后改 `_config.butterfly.yml`：

| 想换什么 | 改哪里 |
| --- | --- |
| 首页/内页顶部大图 | `index_img:` 和 `default_top_img:` 两行，改成 `/img/你的图.jpg` |
| 侧边栏头像 | `avatar: img:` 改成 `/img/你的图.jpg` |
| 浏览器标签图标 | `favicon:` 改成 `/img/你的图.ico`（或 .svg/.png） |

当前用的是自带的 `banner.svg`（山景暮色）、`avatar.svg`（"玮"字头像）、`favicon.svg`。

### 留言板（审核制：不花钱，也不需要服务器）

留言存在 `source/_data/comments.yml` 里，构建时直接变成页面上的卡片——纯静态，
没有后端、没有第三方脚本、访客也不用注册任何账号。

**收一条留言的流程（约 1 分钟）**

1. 访客发邮件到 `renweiwei127@163.com`（留言板上写着这个入口）
2. 双击 `start-admin.bat` → 打开 <http://localhost:4000/site>
3. 拉到最下面「留言管理」→ 点「+ 添加一条留言」→ 填昵称、内容（时间默认当前）
4. 「公开」勾着 = 会显示；取消勾选 = 先存着不公开（广告或不想公开的都这么处理）
5. 点「保存并发布到线上」，1-2 分钟后网站就更新了

**能改的**：昵称、时间、内容、站长回复（显示成引用的样子）、公开/隐藏、删除。
内容里的换行会保留，`https://…` 会自动变成可点的链接。

**关于文章底部评论**：那边仍然挂着 Giscus（需要登录 GitHub 才能发）。
觉得两套并存麻烦的话跟我说，我把它关掉，全站统一成「发邮件 → 我审核」。

---

## 七、第一次发布要准备 GitHub 令牌

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

## 八、目录结构（知道这几个就够）

```
_config.yml            站点主配置
_config.butterfly.yml  主题配置
run.js                 启动器（不用改，除非换端口）
source/_posts/         所有文章，一篇一个 md
source/about/          关于页
source/link/           友链页
source/messageBoard/   留言板
source/_data/comments.yml  留言数据（在 /site 的「留言管理」里改，别手写也行）
scripts/               构建时用的小脚本（留言板渲染就在这里）
source/history/        编年史
scaffolds/post.md      新建文章时的模板（可自己改默认抬头）
.github/workflows/     自动编译规则（改坏了线上就不会更新，别乱动）
.pages.yml             网页版表单后台（Pages CMS）的字段配置
.src_git/              发布/同步时用的临时副本（可随时删，会自动重建）
.sync-state.json       上次同步时的文件指纹（删了会重建，不影响内容）
public/                生成出来的网页（自动生成，别手动改）
```

---

## 九、遇到问题

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
- **同步提示「两边都改过」**：说明同一篇本地和线上各改了一版，脚本保留了本地那份。
  想要线上那版：把这篇文章删掉（或改名）再双击 `sync.bat`；想让线上用本地这版：直接 `publish.bat`。
- **任何报错**：把黑窗口里 `—— git 原始输出 ——` 那几行发给我即可，前面的生成列表不用带。

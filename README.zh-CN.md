<div align="center">

# OpenChamber Open With

**在 [OpenChamber](https://openchamber.dev) 里用其它软件打开当前项目。**
侧栏面板列出编辑器、终端与文件管理器 —— 已安装的显示彩色，未安装的显示灰色 ——
点击一下即可用所选软件打开当前打开的项目。

[English](./README.md) · 简体中文

[![License: Apache 2.0](https://img.shields.io/badge/license-Apache_2.0-blue.svg)](./LICENSE)
[![OpenChamber](https://img.shields.io/badge/OpenChamber-%3E%3D%202.0.0-6f42c1.svg)](https://openchamber.dev)
[![Panel languages](https://img.shields.io/badge/panel_en%20%2F%20zh--cn%20%2F%20zh--tw-2ea44f.svg)](#语言)

<img src="./demo/screenshot/panel.png" alt="「打开方式」面板：已安装的软件显示彩色并排在前面，其余显示灰色" width="500" />

</div>

面板会列出它认识的所有软件。在本机检测到的软件以品牌色显示，未安装的则显示灰色。
点击已安装的软件，OpenChamber 当前打开的项目就会在该软件中打开。

> 这是一个 OpenChamber **扩展**（侧栏面板 + 本地服务），不是 OpenCode 插件。

## 目录

- [功能](#功能)
- [工作原理](#工作原理)
- [安装](#安装)
- [使用](#使用)
- [权限](#权限)
- [已知限制](#已知限制)
- [开发](#开发)
- [语言](#语言)
- [许可证](#许可证)

## 功能

- **一键打开** —— 把当前打开的项目交给所选软件。
- **已安装的排在前面、一眼区分** —— 检测到的软件保留品牌色并排在前面，其余显示灰色，
  只点得到的才有效。
- **编辑器、终端、文件管理器** —— VS Code、Cursor、Zed、Sublime Text、TextMate、
  Antigravity、Xcode、Android Studio、终端、iTerm2、Ghostty、Warp，以及各平台的
  文件管理器（Finder／资源管理器／文件）。
- **自定义网页链接** —— 保存形如 `https://example.com/?path={path}` 的链接模板，
  在网页中打开当前项目；`{path}` 与 `{pathUrlEncode}` 会替换为项目路径。
- **按平台检测** —— macOS 查 `.app` 与 PATH；Windows、Linux 查 PATH。
- **随时刷新** —— 装了新软件后点「刷新」重新检测。
- **可事后查看的日志** —— 服务把日志写入
  `~/.config/openchamber-openwith/logs/service.log`（10 MB 滚动），打开失败后可查原因。
- **面板多语言** —— 跟随 OpenChamber 语言（English、简体中文、繁體中文）。
- **不污染项目** —— 不向项目写入任何文件。

## 工作原理

iframe 无法启动进程，因此扩展自带一个**本地服务**（`contributes.service`）。
用户批准后由宿主拉起；面板只通过 `serviceRequest` 与它通信。

```
面板 (iframe) --serviceRequest--> 宿主 --127.0.0.1:port--> 服务 --spawn--> open -a "<软件>" <项目>
```

- **`GET /apps`** 检测本机装了哪些软件。macOS 上，`.app` 位于 `/Applications`、
  `/System/Applications` 或 `~/Applications`，或其命令在 PATH 上，即视为已安装；
  Windows、Linux 上则用 `where` / `which` 查找命令。结果会缓存一小段时间，
  带 `?refresh=1` 可立即重新检测。
- **`POST /open`** 校验项目目录与软件后启动它。macOS 上编辑器优先用自带命令行
  （`code`、`cursor`、`zed`、`subl <目录>`）：它会把目录交给已运行的实例并把窗口带到
  前台；其余软件用 `open -a "<名称>" <目录>`。Windows、Linux 用 `<命令> <目录>`；
  Windows 上 `.cmd` 启动器（VS Code、Cursor）经 `cmd` 运行并转义目录，因为批处理
  文件无法直接作为进程启动，其余真实可执行程序仍直接启动。
  子进程会脱离服务运行，因此服务不会等你一直开着的编辑器；启动器的退出码会被检查，
  失败时如实报错，不再出现「已打开」的假成功。

每一步都会写入 `~/.config/openchamber-openwith/logs/service.log`（10 MB 滚动，保留
3 份备份）并同时输出到 stderr，方便事后排查打开失败的原因。

软件清单（标识、名称、图标、用哪条命令）在 `src/apps.ts` 中，由面板与服务共用。
面板看不到文件系统与 PATH，服务也不负责绘制界面。

自定义网页链接不走本地服务：面板把项目路径填入模板，再把完整 URL 交给宿主
（`openUrl`）在浏览器中打开。链接模板保存在扩展自己的存储里，因此服务未启用时
依然可用，也不会写入项目文件。

## 安装

需要 OpenChamber **2.0.0 或更高版本**（网页版或桌面版）。

1. 打开 **设置 → 扩展**。
2. 在 **文件夹、ZIP 或 URL** 中粘贴以下之一并点击 **添加**：
   - 最新打包的 zip —— 下面的地址始终指向最新构建：
     `https://github.com/open-tecmz/openchamber-openwith/releases/latest/download/openchamber-openwith-latest.zip`
   - 最新 **Releases** 页面上的 `.zip` 文件；
   - 本地克隆的 `dist/` 目录（先执行一次 `make build` 或 `npm run build`）；
   - `release` 分支的 git 地址 ——
     `https://github.com/open-tecmz/openchamber-openwith.git#release`
     （git 安装可在「设置 → 扩展」中 **更新**，只要 `package.json` 版本号变大；
     zip 安装无法自动更新，需手动添加新的 zip）。
3. 在权限弹窗中点击 **允许并启用**。弹窗会列出本地服务，它将以你的完整用户权限
   运行 `open` 与各软件命令。

## 使用

在侧栏扩展区打开 **打开方式** 面板：

1. 面板会跟随当前打开的项目，列出它认识的软件。
2. 本机检测到的软件显示彩色且可点击；其余显示灰色且不可点击。
3. 点击已安装的软件：项目会在其中打开，并弹出提示确认。
4. 安装新软件后点击 **刷新** 即可重新检测。

`contributes.page` 还能把同一面板全屏打开。

### 自定义网页链接

链接方块和软件在同一个宫格里，排在已安装的软件之后。点击虚线边框的 **添加链接**
方块（或已有链接方块角上的铅笔）会弹出编辑框，填写可选的名称与链接模板；可添加多个
链接（最多 8 个），每个占一个方块。模板中的两个占位符会替换为 OpenChamber 当前
打开的项目：

- `{path}` —— 原样插入项目目录（路径中含 `&`、`#`、`?` 时可能破坏查询参数）；
- `{pathUrlEncode}` —— 项目目录经 `encodeURIComponent` 编码，适合放在查询参数里。

例如 `https://example.com/?path={pathUrlEncode}` 会变成
`https://example.com/?path=%2FUsers%2Fyou%2Fproject`，而
`https://example.com/?path={path}` 保留路径中的斜杠。点击链接方块即可在浏览器中
打开；方块角上的铅笔会打开同一个弹窗，可编辑或删除。最多保存 8 个链接，存放在扩展
自己的存储里，重启后仍在，对所有项目通用；打开链接不需要本地服务，因此服务未启用时
链接方块仍可用。

## 权限

| 能力 | 用途 |
| --- | --- |
| `service` | 本地服务负责检测已安装的软件并启动所选软件；它以你的完整用户权限运行 |

服务声明了 `permissions.exec`，列出它可能运行的启动器 —— `open` 以及各软件命令、
`which` / `where` 查找，Windows 上还有 `cmd`（编辑器启动器在那里是 `.cmd` 文件）——
因此权限弹窗会明确说明它打算运行什么。扩展不申请其他能力：既不读取会话数据，也不
访问项目文件。自定义网页链接保存在扩展自己的存储里，同样不需要额外能力。

## 已知限制

- **必须批准本地服务** —— 没有它，面板既无法查看你的机器也无法启动进程，面板会明确提示。
- **冷启动** —— OpenChamber 按需拉起服务，因此 OpenChamber 进程重启后，面板会先显示
  「连接中」，直到第一次请求把服务带回来。
- **检测是尽力而为的扫描** —— 装在非常规位置的软件可能被判定为未安装；不过编辑器在
  PATH 上的命令也算数，装上 `code` 这类启动器即可被识别。
- **各平台软件不同** —— 清单以 macOS 为主；Windows、Linux 只列出当地有命令的编辑器。
- **进程无沙箱** —— 服务以你的账号权限运行，没有操作系统沙箱，正如权限弹窗所警告的。
- 扩展不支持 VS Code 与移动端。

## 开发

```bash
npm install
make build          # 组装可安装包到 dist/
make typecheck
make test           # 先构建，再运行服务测试与 i18n 测试
```

`npm run build`（或 `make build`）会把完整的可安装包写入 `dist/`：
`dist/package.json`、`dist/icon.svg`、`dist/panel/index.html`，以及两个打包产物
`dist/panel/main.js`（浏览器 IIFE）与 `dist/service/main.js`（Node ESM）。宿主会
按包内位置直接加载已构建的 `.js`，因此页面与其产物必须位于同一目录。`dist/` 为生成
产物，**不提交**；CI 会在每次推送到 `main` 时构建它。

开发时可用文件夹方式安装 `dist/`（设置 → 扩展）：它直接从你的文件夹运行，改完重新
构建再重载即可。

宿主不会编译扩展：只发布已构建文件。修改 `src/i18n.ts` 并重新构建即可新增语言。这
些是本项目仅有的 `devDependencies`；不会打包任何 `node_modules`。完成前请在
`changelog.md` 中记录每一处变更 —— 仓库规则见 `AGENTS.md`。

## 语言

面板跟随 OpenChamber 语言，找不到时回退到英文。面板文案内置 `en`、`zh-cn`、
`zh-tw`；在 `src/i18n.ts` 的 `DICTIONARIES` 中新增一段即可添加语言 —— 字典类型会
让缺失的键在编译期报错。文档提供英文（[README.md](./README.md)）与简体中文
（本文件）。

## 许可证

[Apache-2.0](./LICENSE)。大部分软件图标取自 [Simple Icons](https://simpleicons.org)
（CC0-1.0）；TextMate 与 Finder 取自
[File Icons](https://github.com/file-icons/icons)（ISC），Antigravity 取自 Google 官方
素材，终端图标沿用 macOS Terminal 的标记。相关品牌标识归各自所有者所有。

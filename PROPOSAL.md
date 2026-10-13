# OpenChamber Open With（openchamber-openwith）设计说明

> 目标：在 OpenChamber 侧栏提供一块面板，列出可用编辑器、终端与文件管理器；已安装的
> 软件以品牌色显示，未安装的显示灰色，点击已安装的软件即可用它打开**当前打开的项目**。
>
> 本项目由 `openchamber-makefile` 复制演进而来：原来的「运行 Makefile 目标」整体替换为
> 「用其它软件打开项目」，面板标识、图标与文档随之更新。

---

## 1. 结论先行：为什么必须有本地服务

| 运行形态 | 能否启动进程 | 能否查看文件系统 / PATH |
| --- | --- | --- |
| `panel`（侧栏 iframe） | ❌ 沙箱 iframe 不能 `spawn` | ❌ 不能 |
| `background.entry`（后台帧） | ❌ 同上 | ❌ 不能 |
| `contributes.service`（宿主拉起的本地 Node 进程） | ✅ 可以 | ✅ 可以 |

「用软件打开项目」本质是启动一个进程，并判断机器上装了哪些软件；沙箱 iframe 两样都
做不到，因此只能用 `service`。面板只负责界面，一切检测与启动都在服务里完成。

服务以用户完整权限运行（审批框已明示），只监听 `127.0.0.1`，每个请求都校验宿主下发的
`OPENCHAMBER_SERVICE_TOKEN`。

---

## 2. 架构

```
panel (iframe) --serviceRequest--> host --http 127.0.0.1:port--> service --spawn--> open -a "<app>" <directory>
```

- 面板：绘制软件宫格、显示安装状态、发起打开请求。
- 服务：检测本机已安装的软件、启动所选软件。
- 宿主：负责拉起服务并把面板的请求代理到服务的回环端口。

软件清单（`src/apps.ts`）是纯数据，面板与服务共用：面板用其中的标识、名称与图标，
服务用其中的 `macApp` / `command` 决定如何检测与启动。

---

## 3. 接口（服务回环上的 JSON）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/health` | 就绪探测，宿主用它判断服务是否可用 |
| `GET` | `/apps?refresh=<0\|1>` | 返回平台标识与「每个软件是否已安装」的映射；`refresh=1` 跳过缓存重新检测 |
| `POST` | `/open` `{ directory, app }` | 校验目录与软件后启动它 |

`/open` 的错误码：`invalid-request`（缺参数）、`no-directory`（目录不存在）、
`not-a-directory`、`unknown-app`、`unsupported`（该平台无启动方式）、
`not-installed`（检测为未安装）。所有响应未携带正确令牌的一律 401。

相比 Makefile 版本，这里不再需要事件流：检测结果是静态的（带缓存），打开是一次性动作，
因此服务只提供请求／应答，面板不再维护事件游标。

---

## 4. 检测与启动

- **检测**（`GET /apps`）：
  - macOS：`.app` 位于 `/Applications`、`/System/Applications` 或 `~/Applications`，
    或命令在 PATH 上（`which`），即视为已安装。
  - Windows / Linux：命令在 PATH 上（`where` / `which`）即视为已安装。
  - 结果缓存 30 秒；`?refresh=1` 立即重跑。
- **启动**（`POST /open`）：
  - macOS：编辑器优先用自带命令行（`code` / `cursor` / `zed` / `subl <目录>`），
    它会把目录交给已运行的实例并把窗口带到前台；其余软件用 `open -a "<macApp>" <目录>`。
    无界面服务里 `open -a` 常常只返回成功却不真正启动/前置应用，命令行可绕开这一点。
  - 其它平台：`<command> <directory>`。Windows 上 `.cmd` 启动器（VS Code、Cursor）
    经 `cmd.exe` 运行并转义目录，真实可执行程序（PowerShell、资源管理器）直接启动。
  - 子进程 `detached` 且 `unref()`，服务不会等待用户一直开着的编辑器；启动器退出码会被检查。

---

## 5. 软件清单

面板按平台给出不同清单（`src/apps.ts`）：

- **macOS**：VS Code、Cursor、Zed、Sublime Text、TextMate、Antigravity、Xcode、
  Android Studio、iTerm2、Ghostty、Warp、终端、Finder。
- **Windows**：VS Code、Cursor、Zed、Sublime Text、PowerShell、资源管理器。
- **Linux**：VS Code、Cursor、Zed、Sublime Text、文件。

图标（`src/icons.ts`）为 24×24 圆角方块：品牌色底 + 白色标记。标记一律用各家
官方 logo：多数取自 [Simple Icons](https://simpleicons.org)（CC0-1.0），TextMate 与
Finder 取自 [File Icons](https://github.com/file-icons/icons)（ISC），Antigravity 取自
Google 官方素材，终端沿用 macOS Terminal 的「>_」标记。

---

## 6. 边界与限制

- **冷启动**：OpenChamber 进程重启后，服务不会自动起，需要一次面板交互（`serviceRequest`）
  把它拉起；面板在此之前显示「连接中」。
- **检测是尽力而为**：装在非常规位置的软件可能被判为未安装；编辑器在 PATH 上的命令也算数。
- **平台差异**：清单以 macOS 为主，Windows / Linux 只列出当地有命令的编辑器。
- **无沙箱**：服务以用户完整权限运行，权限弹窗已明确提示。
- **不落盘**：扩展不向项目写入任何文件。
- **日志**：服务把启动、检测结果与每次打开的经过写入
  `~/.config/openchamber-openwith/logs/service.log`（10 MB 滚动，保留 3 份备份），
  打开失败后可据此排查。

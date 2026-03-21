# Dashboard 工程计划：自定义 UI + 连接体验

## 目标

1. **打开即为我们定制 UI**：用户点击「打开 Dashboard」后，18789 页面必须是 SuperClaw 定制版（dashboard-renderer），而非 OpenClaw 官方默认 UI。
2. **打开即连上**：避免先出现 disconnect 1006、等 heartbeat 才连上的不良体验。
3. **可维护性**：确认通过 `gateway.controlUi.root` 指向自有静态目录是官方支持方式，不涉及 fork 官方代码或法律阻力。

## 现状与根因

- **为何看到官方 UI**：网关进程在**启动时**读取 `openclaw.json` 的 `gateway.controlUi.root`。若网关在写入我们配置**之前**就已启动（或从未重启），则一直使用旧配置/默认 control-ui。
- **为何 1006 / 延迟**：页面加载时网关可能尚未就绪，或 WebSocket 未完成握手，前端先显示断开再重连。

## 已做修改（本会话）

1. **installer.js**
   - `stopProcessOnPort(port)`：结束占用 18789 的进程。
   - `restartBundledGateway()`：先 stop 再 start，使网关重新读取配置。
   - `getOpenClawConfigPathForGateway()`：与主进程一致的 config 路径；`startBundledGateway()` 时传入 `OPENCLAW_CONFIG_PATH`，保证网关读到我们写入的 controlUi.root。
2. **index.js（open-dashboard）**
   - 打开前先 `ensureDashboardRendererAsControlUiRoot()`，再在存在 dashboard-renderer 时 `restartBundledGateway()`，等待约 1.2s 后 `waitForGateway(8000, 400)`（探针改为 `/healthz`），就绪后再等 1.5s，再 `createDashboardWindow()`。
   - 目的：每次打开 Dashboard 时网关都用我们的 UI 配置；就绪后多等一会再开窗口，减轻 disconnect 1006。

## 子任务（可分配 subagent）

| 任务 | 说明 | 产出 |
|------|------|------|
| **A. 确认配置生效** | 验证网关进程读取的 config 路径与主进程写入的 `getOpenClawConfigPath()` 一致；验证 `controlUi.root` 在重启后是否被网关使用。 | 结论 + 必要时传 `OPENCLAW_CONFIG_PATH` 给 gateway 子进程 |
| **B. 连接体验** | 在打开 Dashboard 窗口前增加「网关 HTTP + WebSocket 就绪」的检测（或延长 wait），减少 1006；可选：前端「连接中」态。 | 代码改动 + 可选 UI 文案 |
| **C. 自定义 UI 方案文档** | 说明我们通过 `controlUi.root` 指向自有目录、不修改 OpenClaw 源码，属于官方支持的定制方式；第三方可维护性、升级兼容。 | docs 内简短说明 |

## 自定义 UI 方案说明（结论）

- OpenClaw 设计上即通过 **`gateway.controlUi.root`** 指定「Control UI 静态资源根目录」，网关从该目录 serve 文件。我们只是把该目录设为我们的 **dashboard-renderer**（自有构建产物），不修改 OpenClaw 源码，不涉及官方「禁止第三方修改」问题。
- 升级 OpenClaw 时，只要网关仍支持 `controlUi.root`，我们只需继续部署自己的 dashboard-renderer 目录即可。

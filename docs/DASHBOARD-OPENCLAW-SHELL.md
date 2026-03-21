# Dashboard 作为 OpenClaw「外壳」实施计划

## 目标

让当前 Dashboard UI 与用户电脑中的 OpenClaw 配置及状态**双向联动**，使 Dashboard 成为本地 OpenClaw 的**唯一操作入口**（外壳）：  
在 Dashboard 里看到的 = OpenClaw 的；在 Dashboard 里改的 = 写入 OpenClaw。

---

## 连接图（已梳理）

- **配置源**: `~/.openclaw/openclaw.json`（或 `OPENCLAW_CONFIG_PATH`）
- **状态源**: `~/.openclaw`（会话等：`agents/main/sessions/sessions.json`）
- **网关**: 固定 18789，Dashboard 用 token 接 18789 做 Chat

| Dashboard 能力 | 当前状态 | 目标 |
|----------------|----------|------|
| 读 token / port / 默认模型 | ✅ config.getField | 保持 |
| 读会话列表 | ✅ session.search | 保持 |
| 读模型列表 | ✅ openclaw.getModels | 保持 |
| **写配置**（如改默认模型） | ✅ config.updateField | 已实现 |
| 设置默认模型 | ✅ openclaw.setDefaultModel | 已暴露 |
| 会话「撤销最后一条」 | ✅ session.trimLastExchange(sessionKey) | 已实现 |
| 外壳初始状态 | ✅ openclaw.getShellState() | 已实现 |
| 进程启停 | 不实现（用户自管 OpenClaw） | 保持 |

---

## 分阶段实施

### Phase 1：连接点梳理（已完成）

- Preload API 与 OpenClaw 读写点已对照文档与代码梳理完毕，见上方连接图及 subagent 报告。

### Phase 2：配置双向同步（已完成）

1. **config.updateField 实现** ✅
   - 主进程已实现 `dashboard:config:updateField`，白名单 `DASHBOARD_CONFIG_UPDATE_ALLOWED`（含 `agents.defaults.model.primary`），按 dot path 写入、原子写（先写临时文件再 rename）。
2. **Preload** ✅
   - `config.updateField(partialConfig)` 已改为调用 `dashboard:config:updateField`。
3. **设置默认模型** ✅
   - 主进程已实现 `dashboard:openclaw:setDefaultModel(modelId)`，内部调用 `installer.setDefaultModel(modelId)`；Preload 已暴露 `openclaw.setDefaultModel(modelId)`。

### Phase 3：会话 / 模型 / Chat 深度联动（已完成）

1. **会话** ✅
   - UI 当前会话：control-ui 等已通过下拉与 `sessionKey` 与网关联动；Dashboard 可通过 `session.search('')` 从本地 `sessions.json` 拉列表，切换时把 `sessionKey` 传给 Chat（网关 connect 已支持）。
   - **trimLastExchange**：已实现。主进程 `dashboard:session:trimLastExchange(sessionKey)` 读 `~/.openclaw/agents/main/sessions/<sessionKey>.jsonl`，截掉最后一条 user+assistant 后原子写回；Preload 暴露 `session.trimLastExchange(sessionKey)`。
2. **模型**
   - Dashboard 下拉选择模型后调用 `openclaw.setDefaultModel(id)` 或 `config.updateField({ 'agents.defaults.model.primary': id })`，并刷新 UI。初始默认模型可通过 `config.getField('agents.defaults.model.primary')` 或 `openclaw.getShellState()` 获取。
3. **Chat**
   - 已通过 18789 + token 与 OpenClaw 网关通信；请求体可带 `sessionKey`（与 OpenClaw 约定一致）。
4. **Shell 状态**
   - 新增 `dashboard:shell:getState` / `openclaw.getShellState()`：一次返回 `{ defaultModel, sessions }`，供 UI 初始化时拉取并展示 OpenClaw 当前默认模型与会话列表。

### Phase 4（可选）

- 进程启停：若希望从 Dashboard 启动/停止本地 OpenClaw 进程，需主进程 spawn 管理 + 状态轮询，工作量大，可后续再做。

---

## 文件与职责

| 文件 | 职责 |
|------|------|
| `src/main/index.js` | IPC：config 读/写、session 列表、getModels、setDefaultModel |
| `src/main/dashboard-preload.js` | 暴露 config.updateField、openclaw.setDefaultModel 等 |
| `src/main/installer.js` | 已有 setDefaultModel（openclaw models set），可被 IPC 复用 |
| `~/.openclaw/openclaw.json` | 唯一配置源，Dashboard 只通过主进程读写 |

---

## 安全与兼容

- **写配置白名单**：只允许 `agents.defaults.model.primary`、`gateway.controlUi.*` 等，禁止写 `gateway.auth.token`、`models.providers.*.apiKey` 等敏感或复杂结构，避免破坏 OpenClaw。
- **原子写入**：先写临时文件，再 rename，避免写坏 openclaw.json。
- **兼容**：未安装 OpenClaw 或文件不存在时，getField 返回 null，updateField 拒绝并返回错误信息。

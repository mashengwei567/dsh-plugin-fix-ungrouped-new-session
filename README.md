# dsh-plugin-fix-ungrouped-new-session

修复 DeepSeek Harness (DSH) 原生「未分组」会话区两处关键缺陷的 Cordis 客户端独立插件：

1. **缺陷一**：「未分组」组标题旁的「＋ 新建会话」按钮点击无反应；
2. **缺陷二**：新建未分组会话后，因未关联项目工作区被宿主判定为首屏空白态（Hero State），导致输入框被锁定为 `cardWorkspaceTrigger`、强制弹出工作区选择菜单且无法打字输入。

---

## 缺陷根因

### 缺陷一：「＋ 新建会话」按钮空操作
在 DSH 宿主客户端源码 `packages/client/ui-workspace/src/client/rows/WorkspaceBrowser.tsx` 中，`ProjectRowItem` 的 `onCreate` 回调定义如下：
```tsx
onCreate={() => {
  if (group.workspaceId !== undefined) {
    setGroupExpanded(group.key, true)
    startSession(group.workspaceId)
  }
}}
```
因为原生「未分组」分组的 `workspaceId` 严格为 `undefined`（`group.key` 为 `UNGROUPED_KEY = ''`），所以点击该按钮时直接落入 `false`，导致点击毫无反应。

### 缺陷二：输入框强制选工作区与锁定
在 DSH 宿主源码 `packages/client/ui-conversation/src/client/skeleton/ConversationContent.tsx` 中：
```tsx
const inert = sessionId === undefined || (hero && chipTitle === undefined)
```
- 新创建的未分组空白会话处于首屏空白态（`hero === true`）；
- 因未分组会话不挂靠任何工作区，`chipTitle` 计算为 `undefined`；
- 宿主作者断言“无工作区的空白会话必须强制选工作区”，导致 `inert = true`；
- 输入框卡片被强制添加 `cardWorkspaceTrigger` 样式类，禁用输入（`contenteditable = false`），并将点击事件绑定为打开工作区菜单。

---

## 插件修复原理

本插件**无需侵入修改宿主任何源码**，完全基于客户端插件运行时解决：

1. **新建会话拦截**：
   - 在 DOM 捕获阶段拦截未分组行（`data-row-key="workspace:"`）上的「＋」按钮点击；
   - 阻止宿主默认空操作，触发展开未分组列表；
   - 调用 `ctx.sessions.create({})` 分配原生独立未分组会话（Loose Session）；
   - 调用 `ctx.uiWorkspace.openSession(sessionId)` 聚焦导航到该会话。
2. **输入框解冻与直接对话**：
   - 识别当前主会话为未分组空白态时，拦截卡片的捕获阶段点击，彻底阻止弹出工作区选择菜单；
   - 动态移除 `cardWorkspaceTrigger` / `disabled` 样式，激活输入框 `contentEditable = true`；
   - 用户敲击回车或点击发送按钮时，直接调用底层 Session API 提交首条 Prompt；
   - 首条消息发送后会话自动由 `blank` 转为 `active` 态，DSH 原生 Lexical 输入系统全面自动接管，后续对话完全走原生链路。

---

## 目录结构

```
dsh-plugin-fix-ungrouped-new-session/
├── package.json         # 插件包声明（含 dsh.bundle 和 dsh.client 配置）
├── cordis.patch.yml     # Loader patch 插入层
├── lib/
│   ├── index.js         # 宿主半边（空实现与插件声明）
│   └── client.js        # 客户端半边（window.__ModuleLoader__.load 格式）
├── src/
│   └── index.ts         # TypeScript 声明源码
└── README.md
```

---

## 安装与启用

1. 克隆或下载本插件到本地，如 `C:/Users/msw/Downloads/demo2`。
2. 在 DSH 桌面配置文件 `~/.dsh/profiles/desktop/package.json` 的 `dependencies` 中添加软链接：
   ```json
   "dependencies": {
     "dsh-plugin-fix-ungrouped-new-session": "link:C:/Users/msw/Downloads/demo2"
   }
   ```
3. 在 `package.json` 的 `dsh.profile.bundles` 数组中添加插件名称：
   ```json
   "bundles": [
     "dsh-plugin-fix-ungrouped-new-session"
   ]
   ```
4. 启动或刷新 DeepSeek Harness 客户端，即可生效。

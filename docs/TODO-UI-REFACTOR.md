# UI Refactoring Checklist

> Preact + TSX 重构 Chat/Config 页面

---

## Step 1 — 基础设施

- [x] 创建设计文档 `docs/01-ui-design.md`
- [ ] `bun add preact` 安装依赖
- [ ] 创建 `src/web/ui/styles/variables.css` — CSS 变量主题
- [ ] 创建 `src/web/ui/styles/base.css` — Reset + 排版
- [ ] 创建 `src/web/ui/styles/chat.css` — Chat 布局样式
- [ ] 创建 `src/web/ui/styles/config.css` — Config 布局样式

## Step 2 — 共享层

- [ ] 创建 `src/web/ui/shared/types.ts` — 前端类型
- [ ] 创建 `src/web/ui/shared/api.ts` — 类型化 fetch
- [ ] 创建 `src/web/ui/shared/utils.ts` — formatTime, escapeHtml, toast

## Step 3 — Chat 页面组件

- [ ] `pages/chat/App.tsx` — 根组件: state + 布局 + SSE + 全局事件
- [ ] `pages/chat/Header.tsx` — 连接状态点 + 导航
- [ ] `pages/chat/Sidebar.tsx` — 会话列表 + 新建
- [ ] `pages/chat/ChatArea.tsx` — 消息区 + 滚动按钮
- [ ] `pages/chat/MessageList.tsx` — 消息列表渲染
- [ ] `pages/chat/MessageBubble.tsx` — 单条消息气泡 + 头像 + 时间戳
- [ ] `pages/chat/InputBar.tsx` — 输入 + 发送 + 取消
- [ ] `pages/chat/TypingIndicator.tsx` — 打字动画

## Step 4 — Config 页面组件

- [ ] `pages/config/App.tsx` — 根组件: tab 切换 + 数据加载
- [ ] `pages/config/Header.tsx` — 返回按钮 + 标题
- [ ] `pages/config/NavSidebar.tsx` — 分类导航 (AI/Agent/通道/系统)
- [ ] `pages/config/ConfigSection.tsx` — 卡片容器
- [ ] `pages/config/ConfigRow.tsx` — 配置项 (label + input + desc)
- [ ] `pages/config/FeishuCard.tsx` — QR 扫码 + 测试连接
- [ ] `pages/config/ActionBar.tsx` — 保存 + 重置 (浮动底部)

## Step 5 — 入口 + 构建

- [ ] 创建 `src/web/ui/index.html` — Chat 入口壳
- [ ] 创建 `src/web/ui/config.html` — Config 入口壳
- [ ] 更新 `src/web/server.ts` — 添加 `/config` + `/ui/*` 路由
- [ ] 更新 `package.json` — 添加 `build:ui` script

## Step 6 — 验证

- [ ] `bun run build` — 编译全部成功
- [ ] `bun test` — 75 测试通过
- [ ] 浏览器访问 `/` — Chat 页面正常
- [ ] 浏览器访问 `/config` — Config 页面正常
- [ ] API 功能正常 (发送消息, 切换 session, 保存配置)
- [ ] Responsive: ≤768px 侧栏折叠正常
- [ ] Commit + deploy

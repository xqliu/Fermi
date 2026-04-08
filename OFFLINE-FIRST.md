# Fermi Offline-First 改造（启动版）

## 已确认现状

### 1. 静态壳
- 已有 Service Worker：`src/webpage/service.ts`
- 已有 CacheStorage 预缓存：通过 `files.json` 抓取 html/css/js/icons 等
- 当前更像 **offline shell**，不是完整 offline app

### 2. 消息历史
- 当前消息主要在内存：`Localuser.messages`
- 频道打开时直接拉远端：`GET /channels/:id/messages?limit=100`
- 代码位置：`src/webpage/channel.ts#putmessages()`
- **目前没有 IndexedDB / 本地消息持久化层**

### 3. 用户体感问题根因
- 安装了 PWA，但内容层不是 local-first
- 急用时：
  - 壳能开
  - 频道/消息/图片仍依赖远端
  - 网络差或 WS/API 慢时，体感还是“打不开”

---

## 目标

把 Fermi 从“在线网页客户端”改成“本地优先客户端”：

1. 启动先读本地
2. 后台再同步远端
3. 最近消息离线可看
4. 静态资源 100% 本地壳启动
5. 远端是同步层，不是首屏依赖

---

## 第一阶段（马上做）

### A. 壳资源缓存加固
目标：断网也能秒开主界面

要做：
- precache manifest / app / login / invite / template / service.js / version.json
- 静态资源改成 cache-first + 后台更新
- 失败时不要清空旧 cache 再下载，避免“更新失败 = 壳损坏”

### B. 最近频道消息本地化（IndexedDB）
目标：断网时至少能看最近会话

数据结构：
- channels
- messages
- users
- guilds
- drafts
- media metadata（后面扩）

最小范围：
- 最近 20 个活跃频道/DM
- 每频道最近 100 条消息
- 当前频道优先写入

### C. 启动链路改造
目标：先本地显示，再后台补齐

顺序：
1. 启动 → 加载静态壳
2. 读 IndexedDB → 渲染最近频道列表 / 最近消息
3. WS/API 连上后增量同步
4. 同步完成后局部刷新，不白屏重建

### D. 图片/头像策略
目标：体感像本地 app，但不把存储打爆

策略：
- 头像：长期缓存
- 最近查看过的图片缩略图：LRU 缓存
- 原图：按需缓存
- 不做全量附件离线

---

## 第二阶段（下一批）

- 草稿本地保存
- 断网 banner + 离线模式提示
- 本地搜索最近消息
- 发送队列（联网后补发）

---

## 明确不做（当前阶段）

- 全量历史离线
- 全量附件离线
- 所有频道永久镜像到本地

原因：iOS PWA 存储不稳定，收益/风险比太差。

---

## 代码落点

### 现有代码
- SW: `src/webpage/service.ts`
- 消息拉取: `src/webpage/channel.ts`
- 启动: `src/webpage/index.ts`
- 用户主状态: `src/webpage/localuser.ts`

### 新增建议
- `src/webpage/utils/storage/idb.ts`
- `src/webpage/utils/storage/offlineMessages.ts`
- `src/webpage/utils/storage/offlineChannels.ts`
- `src/webpage/utils/storage/offlineDrafts.ts`

---

## 第一批实施顺序

1. 建 IndexedDB 封装
2. 把 `putmessages()` 拉到的消息写入本地
3. `loadChannel()` 先读本地消息再发网络请求
4. 启动时先恢复最近频道/DM 列表
5. SW 更新策略改成“新缓存完整成功后再切换”

---

## 判断完成的标准

做到下面 4 条才算第一阶段完成：

1. 飞行模式下能打开 Fermi 主壳
2. 飞行模式下能看到最近频道列表
3. 飞行模式下能看到最近消息（至少 100 条）
4. 恢复网络后能自动补齐最新消息

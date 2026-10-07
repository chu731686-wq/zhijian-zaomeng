# T-007 外观交接

查看：已有项目进入 `/canvas/[id]`；六种状态的独立样板在 `/canvas/style-preview`；首页左导航显示新 Logo。

已完成：统一变量调色板（点阵、连线与预览底色从 SPEC 第 1 节变量派生）、全宽顶栏与项目标签外观、左工具条、底部助手开关、小地图、节点状态与完整媒体预览、批次图片 2×2 编号预览、选中节点小工具条、类型色端口与连线、SVG Logo 和多尺寸 favicon。修正节点头行拥挤、未接入标题颜色、长错误文案；助手统一为 360px，窄屏浮层、关闭立即释放画布宽度；素材与关联节点缩略图改为完整显示，侧栏状态色统一。

留给下一张交互卡：

- `[id]/canvas-client-page.tsx`：标签暂按现有项目列表展示，关闭按钮占位；需要真正的已打开标签集合、关闭与会话恢复。
- `[id]/canvas-client-page.tsx`：运行流程入口目前只展示错误列表；需要接入流程调度与运行前校验。
- `components/canvas-node-hover-toolbar.tsx`：复制按钮禁用占位，运行打开现有生成参数；需要接入复制与直接运行，删除沿用已有回调。
- `components/infinite-canvas.tsx`、`[id]/canvas-client-page.tsx`：保留现有缩放和平移逻辑；25%–200% 限制与首次完整适应内容交给交互卡。
- `constants.ts`、`utils/canvas-node-size.ts`、`[id]/canvas-client-page.tsx`：普通新建节点默认宽 248；历史节点和生成结果仍沿用原有尺寸逻辑，后续需要统一实际边界与交互命中区，避免改动本卡禁止的生成、存储和拖拽逻辑。

- `components/canvas-assistant-panel.tsx`：本卡仅统一现有助手外观，保留执行逻辑；技能选择、关联标签、计划卡/建议卡及可调整宽度留给后续交互卡（尺寸拖动入口暂隐藏）。

验证：任务卡命令 `cd app/web && npx tsc --noEmit -p .` 通过；核对 SVG 与 favicon 多尺寸结构。当前浏览器工具没有可用浏览器，本次未完成浏览器实看。

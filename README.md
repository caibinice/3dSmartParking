# 智慧停车三维数字孪生

Angular 21 + Babylon.js 9 的全屏沉浸式前端演示。桌面与手机使用同一精细园区的不同 LOD，保留建筑、道路、窗户和车辆材质；统计、图表、记录与设置默认隐藏，点击底部操作栏才展开。

- [桌面版](https://caibinice.com/smartParking/)
- [手机版](https://caibinice.com/smartParking/mobile)
- [源码](https://github.com/caibinice/3dSmartParking)
- [优化记录](docs/optimization-plan.md)
- [验证记录](docs/test-results.md)
- [智能体业务流程、架构与拓展方案](docs/parking-agent-design.md)
- [智能助手联调与发布验证](docs/parking-agent-validation.md)

## 本地运行

需要 Node.js 20.19+ / 22.12+ / 24.0+；本次验证版本为 24.14.1。

```powershell
npm ci
npm start
# http://localhost:8699/
# http://localhost:8699/mobile
npm run typecheck
npm test
npm run build
```

生产 base 路径为 `/smartParking/`；根路径静态预览使用 `npm run build:local`。

`npm start` 通过 `proxy.conf.json` 将 `/smartCockpit/api/**` 代理到现有线上座舱服务；本地调试仍验证座舱操作密码。离线联调可把代理目标改为同一座舱的本地地址（后端路径需要去掉 `/smartCockpit` 前缀）。模型密钥、SSH 密码和操作密码都不进入前端构建。

## 停车智能助手

点击右下角“停车助手”，验证原企业智能座舱操作密码后，可使用文字或语音请求：

- “查看停车报表”“推荐停车区”“查看出入记录”“查看运行告警”。
- “定位门诊停车区”“切换俯视”“跟随巡行车”。
- “开始园区导览”，随后可暂停、继续或结束；手动拖动镜头自动暂停导览。
- 自由组合请求，例如“展示急诊区，并列出当前告警”。

助手默认隐藏，打开不缩小画布；后端复用 `enterprise-ai-cockpit` 原有服务，Flash + thinking max 为默认，Pro 为可选。新独立停车知识库需要由受保护的 `POST /smartCockpit/api/parking-agent/knowledge/bootstrap` 幂等初始化。

“语音”一次识别一句；“语音唤醒”需要主动开启并同意浏览器麦克风权限，再说“你好停车助手”。浏览器识别服务可能使用云端音频处理；识别 API 未提供或网络中断时可继续使用文字与按钮。隐藏面板时有监听指示，停止播报可立即打断；页面切入后台关闭监听。没有调用座舱原有模拟音频接口。

所有报表带模拟来源与采样时刻，程序计算数值，模型只规划白名单工具；当前不发送抬杆、收费、医疗或停车设备指令。

## 沉浸交互

- 默认全屏三维画布，底部圆形菜单打开数据、分区、记录、提醒、视角、设置浮层；浮层不改变画布尺寸。
- 拖动旋转、滚轮缩放、右键平移；点击区域定位点平滑飞入，可回到全景、俯视或自动巡航。
- 点击真实车辆实例进入近景；三辆巡行车复用三条原始道路轨迹，进入场景后自动运行，车头与行进方向一致，四个轮胎连同轮毂按行驶距离转动。
- 车辆特写使用车后固定距离、固定高度的尾随镜头；可切换三辆巡行车、停止跟随自由查看或暂停演示。
- 保留原电路开场动画，文字脱敏为“智慧停车”；模型加载期间循环，准备完成后自然结束，也可点击进入场景。视频播放失败时保留进度提示。
- 模拟泊位推荐、记录筛选/CSV 导出、告警确认；纯净模式隐藏信息层，Esc 关闭浮层或恢复操作界面。
- 手机单指旋转、双指缩放；竖屏自动呈现横向场景，点击全屏后尝试系统横屏锁定。
- 自动画质以清晰度优先：默认 2× CSS 像素，移动/桌面像素预算分别为 400 万/800 万；持续低帧率时先减少光效与绘制频率，不自动降到原生分辨率以下。
- 默认 WebGL2，`?renderer=webgpu` 显式选择 WebGPU；能力检测和后端初始化发生在模型加载之前。

## 精细资产与脱敏

| 发布资源 | 字节数 | 图像纹理 |
|---|---:|---:|
| 桌面园区 | 18,953,916 | 18 |
| 手机园区 | 16,444,988 | 18 |
| 桌面车辆模板 v3 | 1,420,956 | 7 |
| 手机车辆模板 v3 | 1,350,928 | 7 |
| 开场动画（H.264） | 3,652,049 | — |

原始默认园区为 164,807,820 字节。通过共享车辆模板、126 辆 thin instances、静态网格按材质合批和保守减面，桌面/手机园区与车辆的合计发布体积约为 20.37 MB / 17.80 MB。手机版保留同样的材质层次，不以盒体园区替代原建模。

网页使用某某公司、某某医院；模型招牌节点和楼体内嵌文字几何单独清理，动态双面招牌为“某某中医院”。删除供应商水印和带游戏品牌的车牌纹理，其余精细纹理保留。开场视频保留电路动效并替换旧名称；原监控视频、真实监控地址不发布。脱敏检查包含源码、GLB 元数据与近景视觉检查。

模型中的 126 辆停放车辆保留原始布局。300 个泊位为演示统计口径，不与模型实例逐个映射；统计数据、告警、记录和巡行行为均为模拟，未连接真实设备。

## 代码结构

- `src/app/core/parking-data.ts`：数据契约、模拟纯函数与分辨率预算。
- `src/app/core/parking-store.ts`：signals 演示状态。
- `src/app/core/parking-scene.ts`：资产、渲染、相机飞行、实例拾取、触控与释放。
- `src/app/core/parking-traffic.ts`：轨迹插值、方向、距离驱动轮胎和固定尾随相机的纯函数。
- `src/app/dashboard/`：全屏场景界面与按需信息浮层。
- `src/app/assistant/`：座舱 SSE 客户端、可隐藏助手、用户主动开启的浏览器语音。
- `src/app/core/parking-agent.ts`：场景工具、有限导览、快照和双重协议校验。
- `scripts/optimize-model.mjs`：从外部原始资产生成桌面/手机 LOD、实例矩阵和道路轨迹。
- `scripts/prepare-traffic.mjs`：将车模规范到 +Z 前向/+Y 向上，拆出四个轮胎及轮毂，生成 v3 车模、实例矩阵和三条巡行轨迹。
- `scripts/audit-assets.mjs`：纹理保留、名称脱敏、体积、实例与轨迹契约。
- `scripts/deploy.py`：带备份和回滚的原子静态 release 发布。

重新生成模型时提供外部原资产，原文件不进入公开仓库：

```powershell
npm run optimize:model -- "SOURCE_CAMPUS.glb" "SOURCE_VEHICLE.glb"
npm run prepare:traffic -- "SOURCE_CAMPUS.glb" "SOURCE_VEHICLE.glb"
```

## 发布与提交

兄弟目录保留 `ai-blog` 与 `ai-quantitative-trading`，共享凭据只放博客的忽略文件 `credentials.txt`。

```powershell
npm run build
E:\codes\ai-quantitative-trading\.venv\Scripts\python.exe scripts\deploy.py
E:\codes\ai-blog\scripts\github-push.ps1 -Project parking -Message "Your commit message" -Files README.md,src,scripts,docs,deploy,public,package.json,package-lock.json,angular.json
```

Nginx 片段在 `deploy/nginx-location.conf`；发布静态 gzip、指纹 JS/CSS 和版本化 GLB，手机深链接可直接刷新。服务器保留旧 release 与配置备份；共享提交脚本使用 token 和本地 `http://127.0.0.1:20808` 代理，不把凭据写入仓库。

# 智慧停车三维数字孪生

Angular 21 + Babylon.js 9 的全屏沉浸式前端演示。桌面与手机使用同一精细园区的不同 LOD，保留建筑、道路、窗户和车辆材质；统计、图表、记录与设置默认隐藏，点击底部操作栏才展开。

- [桌面版](https://caibinice.com/smartParking/)
- [手机版](https://caibinice.com/smartParking/mobile)
- [源码](https://github.com/caibinice/3dSmartParking)
- [优化记录](docs/optimization-plan.md)
- [验证记录](docs/test-results.md)
- [智能体业务流程、架构与拓展方案](docs/parking-agent-design.md)
- [智能助手联调与发布验证](docs/parking-agent-validation.md)
- [二期业务优化实施清单](docs/parking-operations-plan.md)
- [二期数据、交互与发布验证](docs/parking-operations-validation.md)
- [车辆转弯平滑与三维保真优化](docs/rendering-optimization.md)
- [区域校准与第二轮渲染优化](docs/rendering-phase2.md)
- [模型几何只读审计](docs/model-geometry-audit.json)

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

点击右下角“停车助手”：访客可直接探索，安保和运营使用独立账号，管理员沿用企业智能座舱操作密码。业务台与对话均可隐藏，不改变三维画布尺寸。可使用文字或语音请求：

- “查看停车报表”“推荐停车区”“查看出入记录”“查看运行告警”。
- “定位门诊停车区”“切换俯视”“跟随巡行车”。
- “开始访客导览”“开始运营巡检”“开始夜间巡检”，随后可暂停、继续或结束；手动拖动镜头自动暂停导览。
- “查看年经营报表”“准备告警工单”；经营支持日期/分区查询、完整 CSV 导出，工单必须人工核验确认。
- 自由组合请求，例如“展示急诊区，并列出当前告警”。

后端复用 `enterprise-ai-cockpit` 原有服务，Flash + thinking max 为默认，Pro 为业务账号的可选项。二期接口位于 `/smartCockpit/api/parking`，使用 AG-UI 1.0 标准事件及前后端白名单；管理员的 `POST /setup` 幂等初始化路径图、14 篇独立知识指南与四类报表缓存。旧 `/parking-agent` 接口和 v1 知识库保留作为兼容链路。

“语音”一次识别一句；“语音唤醒”需要主动开启并同意浏览器麦克风权限，再说“你好停车助手”。连续对话可在请求/播报期间监听，显式唤醒词打断播报，过滤自身回声，并取消旧计划后处理新指令。浏览器识别服务可能使用云端音频处理；识别 API 未提供或网络中断时可继续使用文字与按钮。隐藏面板时有监听指示，页面切入后台关闭监听。手机的模型/语音控制收纳到“设置”，保持触控按钮至少 40px。没有新增语音后台服务。

业务台的“看图”截取三维画布，预览并确认后请求真正支持图像输入的 `deepseek-flash`；图片不含聊天/业务面板，后端不保存图像。大小、像素、并发与超时都有边界，上游错误直接可见。

## 一年合成数据库与业务闭环

以 [UCI Parking Birmingham](https://archive.ics.uci.edu/dataset/482/parking%2Bbirmingham) 的日间占用规律为参考，固定种子生成 **2025-10-03 至 2026-10-02** 的一年数据，存放在原座舱 MySQL：105,120 条分区快照、167,906 次停车、365 条合成告警。数据明确标记 `database-synthetic`；生成的夜间、车辆别名、收费和医院场景规则均为演示，不当作现场实测。原 CSV、署名、转换说明和可重复生成脚本保存在 [后端源码](https://github.com/caibinice/enterprise-ai-cockpit/tree/main/scripts/data)。

- 后端读取数据库快照，忽略浏览器传入的统计数字；在场量与出入流水保持守恒。
- 收入来自逐笔已结算停车账本，不由车流量估算；日/分区汇总与全年账本核对一致。
- 访客只读泊位、路线、推荐与访客导览；安保处理告警工单，运营查询经营账本并审核；管理员维护版本化路径图和业务账号。
- 17 个稳定道路/点位节点，Dijkstra 排除关闭节点/道路；充电、无障碍、急诊预留与距离联合推荐。B 区定位到俯视图右下停车区，C 区覆盖左上和左侧，同一 C 区容量不重复累计。三维距离是模型尺度估算。
- 工单经过待审核、批准、领取、核验、复核关闭；确认、幂等键、乐观锁和审计均在服务端执行。
- 原座舱进程每天北京时间 **02:15** 做四类数据库报表汇总，不调用模型。固定数据集不会自动变成今天的现场数据。
- 在原 5 篇指南基础上新增 9 篇：公开数据、权限、路径、推荐、工单、账本、语音视觉、协议评测，以及区域空间定位与镜头操作。

## 沉浸交互

2026-10-04 新增常州当前天气、8 篇脱敏医院指南与院内流光导航；修复助手完成后继续等待连接及异常覆盖回答的问题。巡行车辆照常行驶，巡航轨迹线不再显示，只有主动导航时点亮路线，结束即清除。见 [院内助手与流光导航](docs/assistant-hospital-navigation.md)。

- 默认全屏三维画布，底部圆形菜单打开数据、分区、记录、提醒、视角、设置浮层；浮层不改变画布尺寸。
- 拖动旋转、滚轮缩放、右键平移；点击区域定位点平滑飞入，可回到全景、俯视或自动巡航。
- 点击真实车辆实例进入近景；三辆巡行车复用三条原始道路轨迹，进入场景后自动运行，车头与行进方向一致，四个轮胎连同轮毂按行驶距离转动。
- 车辆特写使用车后固定距离、固定高度的尾随镜头；可切换三辆巡行车、停止跟随自由查看或暂停演示。
- 道路采样使用保形三次 Hermite 连续插值，朝向取曲线切线，转弯不再每 0.2 秒跳角度；闭环接缝连续，不抄近路穿出采样道路范围。
- 保留原电路开场动画，文字脱敏为“智慧停车”；模型加载期间循环，准备完成后自然结束，也可点击进入场景。视频播放失败时保留进度提示。
- 模拟泊位推荐、记录筛选/CSV 导出、告警确认；纯净模式隐藏信息层，Esc 关闭浮层或恢复操作界面。
- 手机单指旋转、双指缩放；竖屏自动呈现横向场景，点击全屏后尝试系统横屏锁定。
- 自动画质以清晰度优先：默认 2× CSS 像素，移动/桌面像素预算分别为 400 万/800 万；持续低帧率时先减少光效与绘制频率，不自动降到原生分辨率以下。
- 默认 WebGL2，`?renderer=webgpu` 显式选择 WebGPU；能力检测和后端初始化发生在模型加载之前。

## 精细资产与脱敏

| 发布资源 | 字节数 | 图像纹理 |
|---|---:|---:|
| 桌面园区 | 15,626,580 | 18 |
| 手机园区 | 13,117,660 | 18 |
| 桌面车辆模板 v3 | 1,420,956 | 7 |
| 手机车辆模板 v3 | 1,350,928 | 7 |
| 开场动画（H.264） | 3,652,049 | — |

原始默认园区为 164,807,820 字节。通过共享车辆模板、126 辆 thin instances、静态网格按材质合批和已有保守 LOD，再加入无损索引/顶点重排与无引用数据清理，桌面/手机园区与车辆的合计发布体积约为 17.05 MB / 14.47 MB。默认四个 GLB 的材质参数、纹理字节、三角形与布局均校验保留，第二轮也没有覆盖它们。透明网格保持原三角形绘制顺序。手机版保留同样的材质层次，不以盒体园区替代原建模。

第二轮增加了单批次空间筛选、进入场景前的 shader/Glow 预热，以及隐藏设置中的 CPU 分通道采样和真实 GPU 整帧查询。KTX2 高质量纹理和远景车辆 LOD 为**显式可选项**，默认仍是原纹理、精细模型和 WebGL；KTX2 失败会回退原图，解码器与 WASM 自托管。高质量 UASTC 的下载文件比原资源更大，它优化的是支持 BC7/ASTC 设备的纹理显存，不宣称下载加速。近景和巡行车辆始终用原几何。详见 [质量对照、性能样本与回退参数](docs/rendering-phase2.md)。

网页使用某某公司、某某医院；模型招牌节点和楼体内嵌文字几何单独清理，动态双面招牌为“某某中医院”。删除供应商水印和带游戏品牌的车牌纹理，其余精细纹理保留。开场视频保留电路动效并替换旧名称；原监控视频、真实监控地址不发布。脱敏检查包含源码、GLB 元数据与近景视觉检查。

模型中的 126 辆停放车辆保留原始布局。300 个泊位为演示统计口径，不与模型实例逐个映射；未登录的离线场景仍使用浏览器演示，登录后使用一年合成数据库的最后快照。巡行车辆是视觉演示，未连接真实设备。

## 代码结构

- `src/app/core/parking-data.ts`：数据契约、模拟纯函数与分辨率预算。
- `src/app/core/parking-store.ts`：signals 演示状态。
- `src/app/core/parking-scene.ts`：资产、渲染、相机飞行、实例拾取、触控与释放。
- `src/app/core/parking-traffic.ts`：轨迹插值、方向、距离驱动轮胎和固定尾随相机的纯函数。
- `src/app/core/campus-layout.json`、`parking-layout.ts`：前后端共享的区域坐标、道路节点和镜头参数。
- `src/app/core/parking-batches.ts`：空间分组筛选后压紧同一 thin-instance 缓冲，保持实例拾取 ID 和透明顺序。
- `src/app/core/parking-profiler.ts`、`parking-textures.ts`：按需性能采样与本地 KTX2 解码配置。
- `src/app/dashboard/`：全屏场景界面与按需信息浮层。
- `src/app/assistant/`：座舱 SSE 客户端、可隐藏助手、用户主动开启的浏览器语音。
- `src/app/core/parking-agent.ts`：场景工具、有限导览、快照和双重协议校验。
- `src/app/core/parking-operations.ts`：AG-UI 官方 schema 适配、数据库/路径合同。
- `src/app/core/parking-charts.ts`：容量加权历史曲线与完整账本 CSV。
- `src/app/assistant/parking-business*`：路线、账本、确认工单、视觉问答与审计工作台。
- `scripts/optimize-model.mjs`：从外部原始资产生成桌面/手机 LOD、实例矩阵和道路轨迹。
- `scripts/prepare-traffic.mjs`：将车模规范到 +Z 前向/+Y 向上，拆出四个轮胎及轮毂，生成 v3 车模、实例矩阵和三条巡行轨迹。
- `scripts/optimize-gpu.mjs`：保真顶点缓存/获取重排，验证三角形绕序、属性、材质、纹理和节点描述；仅输出到显式指定的暂存目录，不覆盖源资产。
- `scripts/audit-assets.mjs`：纹理保留、名称脱敏、体积、实例与轨迹契约。
- `scripts/prepare-render-variants.mjs`、`audit-render-variants.mjs`：可选 KTX2/远景资产生成与保真门槛校验。
- `scripts/audit-model-geometry.mjs`、`audit-model-blender.py`：只读几何/材质审计；Blender 脚本为后续工具入口，不直接导出或覆盖模型。
- `scripts/sync-campus-layout.mjs`：校验兄弟目录座舱后端的共享坐标；加 `--write` 显式同步。
- `scripts/deploy.py`：带备份和回滚的原子静态 release 发布。

重新生成模型时提供外部原资产，原文件不进入公开仓库：

```powershell
npm run optimize:model -- "SOURCE_CAMPUS.glb" "SOURCE_VEHICLE.glb"
npm run prepare:traffic -- "SOURCE_CAMPUS.glb" "SOURCE_VEHICLE.glb"
npm run optimize:gpu -- --output-dir "E:/Documents/AI/codex/tmp/parking-gpu/models"
# 验证暂存模型与截图后，再替换四个发布 GLB 和 asset-gpu-report.json。
# 模型加载 URL 的 rev 必须随新的二进制版本更新，避免长期缓存旧模型。
npm run sync:layout
npm run prepare:decoder
npm run prepare:render -- --output-dir "E:/Documents/AI/codex/tmp/parking-variants" --encoder "FULL_PATH_TO_TOKTX.exe"
# 先审阅质量报告和对照图，再复制可选变体；默认模型保持原文件。
```

## 发布与提交

兄弟目录保留 `ai-blog` 与 `ai-quantitative-trading`，共享凭据只放博客的忽略文件 `credentials.txt`。

```powershell
npm run build
E:\codes\ai-quantitative-trading\.venv\Scripts\python.exe scripts\deploy.py
E:\codes\ai-blog\scripts\github-push.ps1 -Project parking -Message "Your commit message" -Files README.md,src,scripts,docs,deploy,public,package.json,package-lock.json,angular.json
```

Nginx 片段在 `deploy/nginx-location.conf`；发布静态 gzip、指纹 JS/CSS 和版本化 GLB，手机深链接可直接刷新。服务器保留旧 release 与配置备份；共享提交脚本使用 token 和本地 `http://127.0.0.1:20808` 代理，不把凭据写入仓库。

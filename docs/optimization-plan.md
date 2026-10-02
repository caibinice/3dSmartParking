# 智慧停车三维前端优化记录

更新：2026-10-02。范围：全屏沉浸式桌面/手机体验、精细资产与交互。

## 目标与纠偏

首轮整理完成依赖升级、模块化和静态发布，但压缩过度：桌面纹理被剥离，手机用程序化盒体代替建模，图表常驻占用场景。2026-10-02 依据实际体验反馈重新确定验收标准：**原精细园区是主界面，业务内容按需浮现；移动端优化成本，不牺牲主体细节。** 历史实现保留在 Git，本文以当前版本为准。

原工程 Angular 18 / Babylon.js 7，两个主组件各约 58 KB；资源目录约 616 MB，默认园区 GLB 为 164,807,820 字节。原代码、视频、模型保留在外部备份。

## 优化项与实现

| # | 优化项 | 实现位置 | 当前结果 |
|---|---|---|---|
| 1 | 现代依赖与延迟加载 | package.json、app.routes.ts | Angular 21.2.25 / Babylon.js 9.29.0；无 Zone；3D 与路由按需导入 |
| 2 | 数据、状态、场景、界面分层 | core/、dashboard/ | 删除重复大组件；每帧绘制与五秒业务更新分开 |
| 3 | 保留精细资产 | optimize-model.mjs | 桌面/手机均保留 18 个园区纹理；建筑、窗户、路面和泊位结构完整 |
| 4 | 移动 LOD | public/models/*-mobile-v2.glb | 保守减面、纹理尺寸控制；使用原园区，不使用盒体替代场景 |
| 5 | 重复车辆实例化 | vehicle-placements-v2.json、ParkingScene | 从源模型恢复 126 辆布局；共享 7 个精细材质部件，支持实例拾取 |
| 6 | 静态合批与冻结 | flatten/join、freezeWorldMatrix | 按材质合批；当前完整场景 77 个 Mesh，避免重复大车模顶点 |
| 7 | 多层脱敏 | pipeline、createSign、audit-assets | 删除招牌节点和两处楼体内嵌文字簇；清理元数据/水印/品牌车牌；动态双面通用招牌 |
| 8 | 沉浸式信息层 | dashboard.component.* | 全屏画布；图表、记录、告警、设置点击后展开，关闭后回到纯场景 |
| 9 | 空间探索 | fly、focusZone、focusVehicle | 缓动飞行、俯视、巡航、实际车辆近景、巡行跟随、纯净模式 |
| 10 | 原道路轨迹复用 | demo-route-v2.json | 从源动画采样轨迹，避免用穿越楼体的矩形演示路径 |
| 11 | 清晰度与节能 | resolutionScale、render | 默认 2× CSS 像素；4M/8M 像素预算；低帧率先减光效/频率，不静默降到原生以下 |
| 12 | 触控横屏 | /mobile、attachTouch | 单指旋转、双指缩放、CSS 横向适配与坐标逆变换；操作底栏 44px 按钮 |
| 13 | 一致的演示统计 | parking-data、parking-store | 容量 300；空位、在场、分区和推荐同源；3000 次边界/守恒检查 |
| 14 | 生命周期与失败重试 | init/dispose、ngOnDestroy | 隐藏页暂停；路由离开释放引擎、观察器、监听与定时器；加载中断提供原精细场景重试 |
| 15 | 发布与门禁 | audit-assets、deploy.py | 类型检查、4 个数据测试、4 个 GLB 契约审计；HTTPS 深链接、gzip、release 原子切换、失败回滚 |

## 资产结果

| 资源 | 字节 | 顶点 | 纹理 |
|---|---:|---:|---:|
| 桌面园区 | 18,953,916 | 346,842 | 18 |
| 手机园区 | 16,444,988 | 298,797 | 18 |
| 桌面车辆模板 | 1,416,044 | 21,230 | 7 |
| 手机车辆模板 | 1,357,092 | 19,842 | 7 |

桌面园区+车辆约 20.37 MB，手机约 17.80 MB，分别相对原默认园区单文件减少约 87.6% / 89.2%。这里有意不追求历史 7 MB 的极限体积，以纹理、轮廓和近景质量为约束。每个客户端只下载对应 LOD，不同时下载两套园区。

## 体验与业务边界

- 统计总容量 300 为演示口径；原布局的 126 辆模型车辆不伪装为实时业务占用映射。
- 图表浮层覆盖画面但不挤压画布；关闭浮层、Esc 和纯净模式都有明确恢复入口。
- WebGPU 是显式可选后端，默认 WebGL2。新后端不替代资产、实例化与生命周期优化。
- 全屏后的系统横屏锁定受浏览器支持影响；CSS 旋转提供页面级横向布局，触控坐标对应逆变换。
- 自动性能调整保留像素清晰度。FPS 为实际 scene.render 计数；真机性能仍应结合 GPU、热量和功耗测试。
- 精细资源加载失败不显示盒体替代物，保留进度和重试入口，避免给出失真的视觉效果。

## 验证与发布

执行 `npm run typecheck`、`npm test`、`npm run build`、`npm audit`；浏览器检查默认信息隐藏、分区飞行、车辆实例拾取/跟随、记录筛选/CSV、告警、巡航、纯净模式及手机双指操作。详见 [验证记录](test-results.md)。

桌面：[https://caibinice.com/smartParking/](https://caibinice.com/smartParking/)；手机：[https://caibinice.com/smartParking/mobile](https://caibinice.com/smartParking/mobile)。发布前备份 Nginx 片段，产物进入 `/opt/3d-smart-parking/releases/` 后原子切换 `www`。失败自动恢复配置与旧链接。

## 参考

- [Babylon.js 场景优化](https://doc.babylonjs.com/features/featuresDeepDive/scene/optimize_your_scene)
- [Babylon.js 实例化](https://doc.babylonjs.com/features/featuresDeepDive/mesh/copies/instances)
- [Babylon.js WebGPU](https://doc.babylonjs.com/setup/support/webGPU)
- [glTF Transform](https://gltf-transform.dev/)
- [Angular 兼容性](https://angular.dev/reference/versions)

# 智慧停车三维前端优化记录

日期：2026-10-01。范围：独立前端演示、桌面园区和移动端轻量页面。

## 基线与资源审计

原工程为 Angular 18 / Babylon.js 7，两个主要停车组件各约 58 KB，路由还包含多个重复演示页。资源目录约 616 MB；三个园区 GLB 合计约 479 MB，当前默认园区单文件 164,807,820 字节。固定大屏布局、开场视频、频繁重绘、缺少释放逻辑、真实名称和固定监控地址同时存在。

原始源码、模型和图片存放在本地外部备份，公开工程只保留脱敏后的发布资源。删除旧实体名称不等同于修改界面标题：GLB 中的招牌是几何节点，车辆和楼体图片也可能含有文字，必须单独处理。

## 优化项及落地结果

| # | 优化项 | 实现位置 | 验收标准 / 结果 |
|---|---|---|---|
| 1 | 依赖与框架升级 | package.json、app.config.ts | Angular 21.2.25、Babylon.js 9.29.0；支持当前 Node 24.14；无 Zone.js；构建通过 |
| 2 | 模块化与延迟加载 | core/、dashboard/、app.routes.ts | 页面、数据、状态和渲染分层；路由与 3D 动态导入；删除重复组件与未使用视频/图表依赖 |
| 3 | 模型与公开素材精简 | scripts/optimize-model.mjs、public/models/ | 去掉高面数车辆、动画、图像纹理、远景大平面；dedup/weld/simplify/prune；7,089,576 字节，约减少 95.7% |
| 4 | 多层名称脱敏 | index.html、dashboard、模型转换脚本 | UI 使用某某公司/某某医院；移除实体招牌几何、重命名 GLB 元数据；动态招牌为某某中医院；旧监控视频及地址不发布 |
| 5 | 一致的业务数据 | parking-data.ts、parking-store.ts | 总容量300；总数、分区、空位、推荐区和模型占用比例来自同一状态；每5秒模拟更新；3000次边界/守恒测试通过 |
| 6 | 实用交互与内容丰富度 | dashboard.component.* | 分区定位、俯视/全景、巡航、模拟告警确认、记录搜索、CSV导出、停车推荐、图例与说明弹窗 |
| 7 | 自适应渲染质量 | parking-scene.ts | 像素密度封顶、四档画质；桌面目标60、移动目标30帧；低帧率自动降分辨率；统计实际渲染帧，不使用RAF回调数冒充FPS |
| 8 | 现代后端与兼容策略 | parking-scene.ts | 默认WebGL2；可用 ?renderer=webgpu 选择WebGPU；创建场景前检测并初始化，能力不足时回退WebGL |
| 9 | 生命周期与后台节能 | parking-scene.ts、dashboard.component.ts | ResizeObserver代替全局resize；不可见页停止渲染/数据更新；路由离开时清理引擎、场景、观察器、定时器和触控监听 |
| 10 | 手机专用页面 | /mobile、mobile样式、attachTouch | 不请求园区GLB；低面数程序化楼体、实例化车位/车辆；单指旋转/双指缩放；主要按钮44px；竖屏旋转横向工作台；全屏手势后尝试系统横屏锁定 |
| 11 | 加载与错误降级 | loadScene、ParkingScene.init | 显示模型进度；取消开场等待视频；模型失败使用轻量园区；引擎失败提供重试 |
| 12 | 发布与质量门禁 | scripts/audit-assets.mjs、deploy.py、deploy/nginx-location.conf | 类型、纯函数、资产审计、生产构建；GLB预算40MiB；Nginx SPA深链接、gzip、分级缓存、release原子切换及失败回滚 |

## 关键取舍

- 手机页保留业务分区和交互语义，但使用代表性楼体与车位布局，不复刻桌面模型全部细节。车位三维数量表示占用比例，准确容量以数据面板为准。
- WebGPU是显式可选项，现代渲染后端不会自动消除大资产、重复Draw Call或错误生命周期的成本。默认WebGL更方便广泛设备访问。
- 车位和车辆使用两个thin-instance源网格。批量矩阵在数据变化时更新，渲染帧不会逐个修改业务对象。
- 竖屏CSS旋转与系统方向锁定是不同机制。浏览器拒绝方向锁定时，页面仍自动呈现横向工作台；触控坐标同时逆变换。
- 去掉失效的远程监控，明确标注模拟数据。当前版本没有真实门禁、摄像头或收费后端。
- 桌面模型以小几何误差精简，优先保留主体结构；移动版进一步简化。未启用依赖远程CDN解码器的压缩，模型可直接被本地GLTF加载器读取。

## 本地验证步骤

```powershell
npm ci
npm run typecheck
npm test
npm run build
npm start
```

浏览器检查：桌面1600×900及更窄尺寸；手机844×390、390×844；分区定位、重置、俯视、巡航、数据暂停、告警确认、记录筛选和导出；反复切换桌面与手机版；查看Console与模型网络请求。手机号页必须有0个GLB请求。性能数值只记录本机浏览器测试，不外推为所有真机帧率承诺。

## 发布与回滚

生产：`https://caibinice.com/smartParking/`；手机：`https://caibinice.com/smartParking/mobile`。

```powershell
npm run build
E:\codes\ai-quantitative-trading\.venv\Scripts\python.exe scripts\deploy.py
```

发布器读取博客共享凭据对应的RemoteClient，上传静态文件，不增加后端服务。服务器保留`/opt/3d-smart-parking/releases/`，`www`指向当前release；Nginx片段修改前生成`nginx-routes-<时间>.backup`。失败会恢复旧配置及链接；手工回滚时切换`www`到旧release并执行`nginx -t`和reload。

## 后续扩展边界

真实系统接入应新增API数据适配器和明确的鉴权/权限边界，不直接把设备控制塞进组件。若扩展跨楼宇/城市场景，可按区域分包、视锥与距离调度加载。进一步美术调整应在脱敏资产上完成，并保持手机不加载全量模型的契约。

## 参考资料

- [Angular版本支持](https://angular.dev/reference/releases)
- [Angular与Node/TypeScript兼容表](https://angular.dev/reference/versions)
- [Babylon.js实例化](https://doc.babylonjs.com/features/featuresDeepDive/mesh/copies/instances)
- [Babylon.js场景优化](https://doc.babylonjs.com/features/featuresDeepDive/scene/optimize_your_scene)
- [Babylon.js WebGPU](https://doc.babylonjs.com/setup/support/webGPU)
- [glTF Transform](https://gltf-transform.dev/)

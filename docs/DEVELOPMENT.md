# 开发、配置与安装

## 环境和工程目录

Node.js >=22.13；npm。设备构建和预览另需aix CLI，安装另需ADB及眼镜开发者授权。Ink源包要求>=0.17.0，但实际语音与物理按键必须在目标宿主测试，不能仅看最低版本声明。

| 路径 | 职责 |
| --- | --- |
| `aiui/pages/index/index.ink` | 原生界面、焦点、语音与生命周期 |
| `aiui/lib/` | 布局和控件映射，设备业务bundle为本地生成 |
| `shared/` | 会话状态机、点餐意图、菜单匹配、真实金额和确认保护 |
| `device/` | 设备MCP网关、传输、存储、静态契约验证器 |
| `server/src/` | 可选Node HTTP兼容入口和隔离Mock |
| `server/test/`、`device/test/` | 业务、状态、布局、语音与按键回归 |
| `docs/mcp-tool-contracts.json` | 工具契约快照，用于校验，不代表全部工具都实现 |
| `scripts/` | 本地配置、构建、打包、检查及Ink验证 |

## 凭证与身份

在终端环境中设置 `MCD_MCP_TOKEN`，或将自己的配置写入被忽略的 `.env.local`。`.env.example`和`mcp-config.example.json`仅展示占位形式，不应直接当作有效Token使用。配置命令拒绝空值及占位符。

- `MCD_MCP_TOKEN`：真实眼镜连接必填，自行在官方平台申请。
- `AMAP_WEB_KEY`：可选，只辅助地址解析；不用于门店距离计算。
- `APP_ACCESS_KEY`：仅Node HTTP服务需要，自行生成至少20字符；不是麦当劳Token。

```bash
npm ci
npm run configure
npm run build:device
npm run pack
```

`configure`生成被Git忽略的 `aiui/lib/credentials.js`、`aiui/agent.json`和`local/app-identity.json`。配置不打印凭证；本地文件并非已验证硬件加密存储。设备使用打包后的凭证连接官方MCP，因此个人AIX也必须保密。

首次配置生成独立身份；再次配置保留身份。不要删除 `local/app-identity.json` 来做普通升级，不要复用作者的私人身份或设备数据。`--mock`显式生成测试占位值，只用于隔离验证；普通预览不会自动把生产网关改成Mock。

## 打包和安装

打包使用当前aix安装内的源包构建器，已验证CLI0.10.1。构建器API变化会停止打包，需按目标CLI适配，不强行猜测。

```bash
npm run pack
# 检查自己本地生成的包（不要上传）
aix show artifacts/mcdonalds-rokid.aix
aix list artifacts/mcdonalds-rokid.aix
# ADB已授权，且只有一个目标设备
npm run install:device
# 多设备时显式选择
npm run install:device -- YOUR_AUTHORIZED_DEVICE_SERIAL
# 打开源Page
npm run preview
```

安装脚本通过开发者provider上传确切AIX并校验哈希，复用本地身份，不清应用数据。`npm run preview`用于开发预览；在眼镜打开已安装应用可使用设备应用入口，或在对应开发环境执行 `aix launch-page aiui pages/index/index`。安装和设备报告写入被忽略的`local/`。

本次公开版整理未安装到作者眼镜，原个人应用保持不变。安装你自己构建的版本前，确认配置所属账号和目标设备。

## 测试和演示

```bash
npm run build:device
npm test
npm run typecheck
npm run check:docs
npm run check:public
# 隔离的实际Ink键控验证，需要aix及macOS Chrome
npm run configure:mock
npm run verify:ink
```

Mock真实写操作只修改隔离测试状态。实际Ink脚本会启动本地预览、用模拟识别文本驱动Page并输出本地产物到被忽略的`artifacts/`。它不能证明实际麦克风、门店网络或系统桌面退出通过。

## 可选Node兼容服务

眼镜默认直连MCP，不依赖此服务。需要本地调试HTTP入口时，先设置自己的至少20字符`APP_ACCESS_KEY`：

```bash
export APP_ACCESS_KEY="$(openssl rand -hex 24)"
npm run demo
```

`demo`仅启动Mock；真实Node模式另需自己的`MCD_MCP_TOKEN`，然后执行`npm start`。默认只监听127.0.0.1:8787，HTTP入口仍要求Bearer访问密钥，不能将`APP_ACCESS_KEY`混同MCP Token。数据库在被忽略的`server/data/`，不要上传账号状态。

## 发布前检查

仅提交源码和精选脱敏资料。禁止提交生成的凭证、身份、AIX、ZIP、数据库、日志或设备报告。`npm run check:public`只检查Git将公开的文件，不将被忽略的本地配置视作可发布内容。CI从干净检出重新构建和测试，不使用仓库秘密或个人账号。

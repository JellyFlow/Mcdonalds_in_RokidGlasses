# 贡献指南

先阅读README、MCP_INTEGRATION及docs/PRODUCT.md。使用自己的本地环境变量，或用隔离Mock开发；不要把凭证、数据库、设备编号、个人订单或地址加入Issue和PR。

验证命令：npm run build:device、npm test、npm run typecheck、npm run check:docs、npm run check:public。涉及Ink时补充实际运行时检查，并区分模拟识别和真实麦克风结果。

改动不应绕过运行时工具契约、真实金额、确认键或待核实提交保护。不要为了运行测试执行真实领券、地址创建、下单或取消。保持官方CONTEST_DECLARATION.md内容不变。

自有代码贡献按MIT提交；第三方素材须有明确来源与可用范围说明。

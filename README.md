# PALM：个人物品资产生命周期管理平台

面向单用户的本地网页系统，记录物品从购买、使用、维修、闲置到处置的过程，并统计资产结构和使用成本。前端使用 HTML、CSS、原生 JavaScript；后端使用 Python Flask；数据保存在 SQLite。

## 启动

需要 Python 3.10 或更新版本。以下命令在项目目录执行（Windows PowerShell）：

```powershell
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe app.py
```

浏览器打开 <http://127.0.0.1:5000>。首次启动会自动创建数据库 `instance/palm.sqlite3`。停止服务后再次启动，数据会保留。

如需演示数据，在**空数据库**中运行：

```powershell
.venv\Scripts\python.exe seed_demo.py
```

演示数据包含使用中的笔记本电脑、闲置音箱、维修后出售的自行车，以及丢弃的雨伞。脚本检测到已有物品时不会写入，以免混入真实数据。

## 功能与规则

- 添加、编辑、删除物品；按名称或分类搜索，按状态筛选。
- 添加、编辑、删除使用和维修记录；处置物品及修改或撤销处置记录。
- 首页显示物品数量、费用合计、状态分布和分类资产金额；详情页显示时间线和单件成本。
- 净成本 = 购买价格 + 维修费用 − 处置回收金额；持有天数 = 处置日（未处置则为今天）− 购买日。
- 分类资产金额按购买价格累计，已处置物品也计入历史总额。金额保留两位小数，使用整数分存储。
- 新增使用或维修记录需要物品尚未处置。更正已有记录时，日期仍必须在购买日至处置日之间。删除处置记录后，物品设为“闲置”，可再手动改为“使用中”。
- 删除物品会同时删除其所有记录；系统仅在本机 `127.0.0.1` 提供服务，没有账号系统。

## 接口

所有写入接口接收 JSON；金额字段使用元，返回的金额也是两位小数的字符串。

| 用途 | 接口 |
| --- | --- |
| 物品列表、新增 | `GET/POST /api/items`，列表支持 `?q=关键词` |
| 物品详情、修改、删除 | `GET/PUT/DELETE /api/items/<id>` |
| 使用记录列表、新增 | `GET/POST /api/items/<id>/usage` |
| 使用记录修改、删除 | `PUT/DELETE /api/usage/<id>` |
| 维修记录列表、新增 | `GET/POST /api/items/<id>/maintenance` |
| 维修记录修改、删除 | `PUT/DELETE /api/maintenance/<id>` |
| 处置记录查看、新增 | `GET/POST /api/items/<id>/disposal` |
| 处置记录修改、删除 | `PUT/DELETE /api/disposal/<id>` |
| 统计 | `GET /api/stats` |

## 验收与演示

运行自动化测试：

```powershell
.venv\Scripts\python.exe -m unittest discover -s tests -v
```

建议演示顺序：打开首页查看分类和状态分布 → 查看笔记本电脑的使用、维修记录与净成本 → 查看音箱的闲置状态 → 查看自行车的出售记录与回收金额 → 新增一个物品并尝试输入负数金额，展示校验提示 → 重启服务，确认记录保留。

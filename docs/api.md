# 接口说明

## 接口

除照片上传使用 `multipart/form-data` 外，写入接口接收 JSON；金额字段使用元，返回的金额也是两位小数的字符串。先调用 `GET /api/auth/me` 获取 `csrf_token`，之后 `POST`、`PUT`、`DELETE` 请求均需发送 `X-CSRF-Token` 请求头。登录或注册后令牌会更新。业务接口未登录时返回 `401`，访问其他账号的记录返回 `404`，令牌缺失或错误返回 `403`。

| 用途 | 接口 |
| --- | --- |
| 当前会话 | `GET /api/auth/me`，返回 `user`（未登录为 `null`）和 `csrf_token` |
| 注册、登录、登出 | `POST /api/auth/register`、`POST /api/auth/login`（JSON：`username`、`password`）；`POST /api/auth/logout`。注册和登录返回 `user`、`csrf_token` |
| 修改自己的用户名 | `PUT /api/account/username`；JSON：`username`、`current_password`，返回更新后的 `user` |
| 修改自己的密码 | `PUT /api/account/password`；JSON：`current_password`、`new_password`，成功返回 `204` 并清除当前会话；其他旧会话也随即失效 |
| 更换或恢复头像 | `PUT /api/account/avatar`；JSON：`avatar_key`，可为 `sprout`、`cat`、`book`、`sun`、`bike`、`star`，传 `null` 恢复默认；返回更新后的 `user` |
| 物品列表、新增 | `GET/POST /api/items`，列表支持 `?q=关键词` |
| 物品详情、修改、移入回收站 | `GET/PUT/DELETE /api/items/<id>`；删除成功返回 `204`，物品在回收站保留 30 天 |
| 回收站列表、恢复、永久删除 | `GET /api/trash`、`POST /api/trash/<id>/restore`、`DELETE /api/trash/<id>`；恢复返回物品，永久删除返回 `204`；到期恢复返回 `410` |
| 导出物品清单 | `GET /api/exports/items.csv`；下载当前账号全部未删除物品的 CSV |
| 月度回顾 | `GET /api/reports/monthly?month=YYYY-MM`；仅允许当前月及历史月份 |
| 物品照片 | `GET/POST/DELETE /api/items/<id>/photo`；`POST` 使用 `multipart/form-data`，字段名 `photo`，返回更新后的物品详情 |
| 置顶 | `PUT /api/items/<id>/pin`；JSON：`{"is_pinned":true}` 或 `false`，返回更新后的列表物品 |
| 快捷记录今天使用 | `POST /api/items/<id>/usage/today`；新建返回 `201`，已存在返回 `200`，均包含 `record` 和 `created` |
| 日均购买价目标 | `PUT /api/items/<id>/daily-target`；JSON：`{"amount":"1.00"}` 设置／更新，`{"amount":null}` 取消，返回更新后的完整物品详情 |
| 使用记录列表、新增 | `GET/POST /api/items/<id>/usage` |
| 使用记录修改、删除 | `PUT/DELETE /api/usage/<id>` |
| 维修记录列表、新增 | `GET/POST /api/items/<id>/maintenance` |
| 维修记录修改、删除 | `PUT/DELETE /api/maintenance/<id>` |
| 处置记录查看、新增 | `GET/POST /api/items/<id>/disposal` |
| 处置记录修改、删除 | `PUT/DELETE /api/disposal/<id>` |
| 统计 | `GET /api/stats` |
| 近 12 个月费用与智能分析 | `GET /api/insights`，返回 `months`、`analysis_as_of`、`analysis_cards`，并保留 `review_items`、`unknown_usage_items` 和 `review_threshold_days` |

物品新增和编辑接口支持 `icon_type`：`digital`、`home`、`daily`、`clothing`、`books`、`mobility`、`sports`、`tools`、`other`。新增时省略使用 `other`；编辑时省略则保留原类型；无效值返回 `400`。列表和详情均返回 `icon_type`、`holding_days`、`daily_purchase_cost`、`daily_net_cost`；两种日均值在持有不足一天时为 `null`。详情还返回 `last_recorded_use`（无记录时为 `null`）。

物品新增和编辑接口也支持 `warranty_expires_on`，格式为 `YYYY-MM-DD`，允许未来日期。新增时省略或提交 `null`、空字符串表示未填写；编辑时省略保留原值，提交 `null` 或空字符串清空。日期早于购买日或格式错误时返回 `400`。列表与详情均返回该字段，未填写时为 `null`。

物品列表和详情还返回 `photo_url`（无照片为 `null`）、`is_pinned` 和 `used_today`。照片接口会验证文件内容和 5 MB 大小，读取、替换、删除均核对物品所属账号。快捷记录以服务端本机日期为准，对同一物品同一天的并发请求只写入一条；若已有手动记录，返回当天最新记录。该接口不修改闲置状态。

`analysis_cards` 每项包含 `kind`、`label`、`headline`、`explanation` 及相关 `items`（`id`、`name`、`icon_type`），用于页面展示结论、依据和详情入口。`analysis_as_of` 是生成分析所用的本机日期。旧复盘字段继续返回，月度费用图表仍读取 `months`。

回收站列表返回数组，每项含 `id`、`name`、`category`、`icon_type`、`status`、`deleted_at`、`expires_at`。月度回顾返回 `month`、`through`、`is_current`、`purchase_count`、`purchase_total`、`maintenance_total`、`proceeds_total`、`usage_count`、`purchased_items` 和 `highlights`。金额为两位小数字符串；回收站、新增的导出与月度接口均按当前账号隔离。恢复及永久删除需要 CSRF 令牌；无权访问返回 `404`。

`GET /api/auth/me` 及注册、登录返回的 `user` 包含 `id`、`username`、`avatar_key`；`avatar_key` 为 `null` 时页面显示默认新芽。账号修改接口仅供当前登录用户调用，沿用 CSRF 校验；未登录返回 `401`，输入无效或当前密码错误返回 `400`。

列表和详情还返回：

- `milestones`：`earned` 为已达成纪念章（`id`、`label`、`number`、`date`、`is_today`），`next` 为下一纪念章并带 `remaining_days`，已处置时为 `null`。
- `daily_target`：未设置时为 `null`；否则包含 `amount`、`status`（`pending`、`reached`、`closed`）、`required_days`、`remaining_days`、`progress_percent`、`estimated_date`、`reached_on`、`is_today`。预计日期仅在进行中且可表示时返回，达成日期仅在达成后返回。

目标接口与现有接口采用相同的认证和 CSRF 规则；缺少金额、非法金额或修改已处置物品的目标返回 `400`，访问他人物品返回 `404`。普通物品编辑不会清除已设目标。

# 物物记：小程序接口

基础地址：`/api/mp`。除 `POST /auth/login` 外，请求须带 `Authorization: Bearer <token>`。登录凭证由 `wx.login` 获取，后端通过微信 `jscode2session` 换取 OpenID，建立独立用户并返回 7 天有效的随机 token；数据库只保存 token 的 SHA-256 摘要。错误统一为 JSON `{ "error": "原因" }`，无凭证为 401，无权访问或记录不存在为 404，回收站物品到期为 410。响应禁用缓存。

| 用途 | 方法与路径 |
|---|---|
| 微信登录／当前用户／登出 | `POST /auth/login`、`GET /auth/me`、`POST /auth/logout` |
| 修改资料 | `PUT /profile` |
| 物品列表／新增 | `GET /items`、`POST /items` |
| 详情／编辑／移入回收站 | `GET/PUT/DELETE /items/<id>` |
| 照片 | `GET/POST/DELETE /items/<id>/photo`，上传使用字段 `photo` |
| 置顶／日均目标 | `PUT /items/<id>/pin`、`PUT /items/<id>/daily-target` |
| 使用／维修 | `GET/POST /items/<id>/usage`、`GET/POST /items/<id>/maintenance` |
| 修改／删除记录 | `PUT/DELETE /usage/<id>`、`PUT/DELETE /maintenance/<id>` |
| 今天用过 | `POST /items/<id>/usage/today` |
| 处置 | `GET/POST /items/<id>/disposal`、`PUT/DELETE /disposal/<id>` |
| 统计／规则发现 | `GET /stats`、`GET /insights` |
| 月度收藏小报 | `GET /reports/monthly?month=YYYY-MM`，省略月份时为后端当前月 |
| 回收站／恢复／永久删除 | `GET /trash`、`POST /trash/<id>/restore`、`DELETE /trash/<id>` |

创建或修改物品示例：

```json
{
  "name": "相机", "category": "摄影器材", "icon_type": "digital",
  "purchase_date": "2025-01-01", "purchase_price": "1200.00",
  "warranty_expires_on": "2027-01-01", "status": "active", "notes": "旅行用"
}
```

`icon_type` 可为 `digital/home/daily/clothing/books/mobility/sports/tools/other`。状态由 `active`（使用中）、`idle`（闲置）、`disposed`（已处置）表示。已处置状态由处置记录决定。金额是最多两位小数的非负十进制值；后端使用整数分存储。记录日期不得早于购买日，处置不能早于已有使用或维修记录。

示例记录：`POST /items/1/usage` 为 `{ "used_on": "2025-02-01", "notes": "拍照" }`；维修为 `{ "maintained_on": "2025-03-01", "cost": "100.00", "description": "清洁" }`；处置为 `{ "disposed_on": "2025-04-01", "method": "sold", "proceeds": "500.00", "notes": "" }`。

## 纪念与目标

物品列表和详情已有 `milestones: { earned, next }` 与可为空的 `daily_target`。纪念包含 `id`、`label`、`date`；下一次纪念另有 `remaining_days`。周年遇到非闰年时，2 月 29 日按 2 月 28 日计算。已处置物品只计算至处置日；回收站物品不返回。

`PUT /items/<id>/daily-target` 接收 `{ "amount": "5.00" }` 或 `{ "amount": null }`（取消）；金额须大于零。目标以购买价均摊计算，`daily_target` 返回 `amount`、`progress_percent`、`status`（`pending/reached/closed`）、`estimated_date`、`reached_on` 与天数。购买当天日均仍为空，已处置物品目标只读。

## 月度小报

月份严格使用 `YYYY-MM`，非法或未来月份返回 400。日期以现有后端当天口径为准，当前月截止今天，历史月截止当月最后一天。

```json
{
  "month": "2026-10", "today": "2026-10-03", "cutoff_date": "2026-10-03", "is_current": true,
  "totals": { "purchase_count": 1, "purchase_total": "48.00", "maintenance_total": "0.00", "disposal_total": "0.00", "usage_count": 1 },
  "purchases": [{ "id": 1, "name": "陶杯", "icon_type": "daily", "purchase_date": "2026-10-02", "purchase_price": "48.00" }],
  "memories": [{ "key": "2-year-1", "item_id": 2, "name": "相机", "date": "2026-10-01", "label": "相伴 1 年", "kind": "milestone" }],
  "has_activity": true
}
```

`memories.kind` 为 `milestone` 或 `target`。费用和使用次数按各自事件日期归月，金额继续使用整数分汇总后返回两位小数字符串。仅查询当前账号未删除物品，包含已处置物品的历史记录；零金额事件也属于有记录的月份。历史小报不保存快照，更正记录、调整目标或删除恢复物品后会重新计算。没有新增数据库字段或迁移。

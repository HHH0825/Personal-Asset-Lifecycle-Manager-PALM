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

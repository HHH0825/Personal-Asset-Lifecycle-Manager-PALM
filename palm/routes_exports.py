"""Account-scoped spreadsheet export."""

import csv
from io import BytesIO, StringIO
from flask import Blueprint, g, send_file
from .repository import list_item_rows
from .services import item_payload

bp = Blueprint("exports", __name__)

HEADERS = ("名称", "分类", "物品类型", "状态", "购买日期", "购买价格", "保修到期日",
           "维修合计", "处置回收金额", "累计净成本", "持有天数", "购买价/天",
           "净成本/天", "使用次数", "最近记录使用日", "备注")
TYPE_NAMES = {"digital": "数码", "home": "家居", "daily": "日常用品", "clothing": "衣物",
              "books": "书籍文具", "mobility": "出行", "sports": "运动", "tools": "工具", "other": "其他"}
STATUS_NAMES = {"active": "使用中", "idle": "闲置", "disposed": "已处置"}


def safe_text(value):
    text = str(value or "")
    return "'" + text if text.lstrip().startswith(("=", "+", "-", "@")) else text


@bp.get("/api/exports/items.csv")
def items_csv():
    output = StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(HEADERS)
    for row in list_item_rows(g.user_id):
        item = item_payload(row)
        writer.writerow((safe_text(item["name"]), safe_text(item["category"]),
                         TYPE_NAMES.get(item["icon_type"], "其他"), STATUS_NAMES[item["status"]],
                         item["purchase_date"], item["purchase_price"],
                         item["warranty_expires_on"] or "", item["maintenance_total"],
                         item["disposal_proceeds"], item["net_cost"], item["holding_days"],
                         item["daily_purchase_cost"] or "", item["daily_net_cost"] or "",
                         item["usage_count"], item["last_recorded_use"] or "", safe_text(item["notes"])))
    data = BytesIO(output.getvalue().encode("utf-8-sig"))
    return send_file(data, mimetype="text/csv; charset=utf-8", as_attachment=True,
                     download_name="PALM-物品清单.csv")

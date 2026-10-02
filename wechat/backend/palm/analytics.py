from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP
from .services import item_payload
from .validation import money


def recent_months(today):
    months = []
    for offset in range(11, -1, -1):
        absolute_month = today.year * 12 + today.month - 1 - offset
        year, month_index = divmod(absolute_month, 12)
        months.append(f"{year:04d}-{month_index + 1:02d}")
    return months


def build_stats(rows):
    category = {}
    for row in rows:
        category[row["category"]] = category.get(row["category"], 0) + row["purchase_cents"]
    return {
        "total_items": len(rows),
        "status_counts": {state: sum(row["status"] == state for row in rows) for state in ("active", "idle", "disposed")},
        "purchase_total": money(sum(r["purchase_cents"] for r in rows)),
        "maintenance_total": money(sum(row["maintenance_cents"] for row in rows)),
        "disposal_total": money(sum(row["proceeds_cents"] or 0 for row in rows)),
        "net_cost_total": money(sum(row["purchase_cents"] + row["maintenance_cents"] - (row["proceeds_cents"] or 0) for row in rows)),
        "categories": [{"name": name, "amount": money(amount)} for name, amount in sorted(category.items(), key=lambda x: -x[1])],
    }


def build_insights(today, all_rows, months, monthly, repairs):
    review = []
    unrecorded = []
    for row in (row for row in all_rows if row["status"] != "disposed"):
        item = item_payload(row, today=today)
        last_used = item["last_recorded_use"]
        days_since = (today - date.fromisoformat(last_used)).days if last_used else None
        item["days_since_last_recorded_use"] = days_since
        if row["status"] == "idle":
            item["review_reason"] = "manual_idle"
            review.append(item)
        elif days_since is not None and days_since >= 90:
            item["review_reason"] = "no_recent_record"
            review.append(item)
        elif last_used is None:
            unrecorded.append(item)
    review.sort(key=lambda item: (item["review_reason"] != "manual_idle", -(item["days_since_last_recorded_use"] or 0)))

    cards = []

    def card(kind, label, headline, explanation, items=()):
        cards.append({"kind": kind, "label": label, "headline": headline,
                      "explanation": explanation,
                      "items": [{"id": item["id"], "name": item["name"], "icon_type": item["icon_type"]}
                                for item in items]})

    held = [row for row in all_rows if row["status"] != "disposed"]
    held_total = sum(row["purchase_cents"] for row in held)
    digital_total = sum(row["purchase_cents"] for row in held if row["icon_type"] == "digital")
    if held_total:
        share = (Decimal(digital_total) * 100 / Decimal(held_total)).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
        card("digital_share", "资产结构", f"数码物品占当前持有物品购入价值的 {share}%。",
             f"数码物品购买价合计 {money(digital_total)} 元；当前持有物品购买价合计 {money(held_total)} 元。按物品类型统计，闲置物品计入，已处置物品不计入。")

    due, expired = [], []
    for row in held:
        if not row["warranty_expires_on"]:
            continue
        days_left = (date.fromisoformat(row["warranty_expires_on"]) - today).days
        if 0 <= days_left <= 30:
            due.append(row)
        elif days_left < 0:
            expired.append(row)
    due.sort(key=lambda row: (row["warranty_expires_on"], row["id"]))
    expired.sort(key=lambda row: (row["warranty_expires_on"], row["id"]), reverse=True)
    if due:
        card("warranty_due", "保修提醒", f"{len(due)} 件物品将在 30 天内过保。",
             f"统计今天至 {today + timedelta(days=30)}（含到期当天及第 30 天）的未处置物品；未填写保修日期的不参与。", due)
    if expired:
        card("warranty_expired", "保修提醒", f"{len(expired)} 件持有物品已过保。",
             "保修到期日早于今天；仅提醒核对，不改变物品状态。", expired)

    manual = [item for item in review if item["review_reason"] == "manual_idle"]
    if manual:
        card("manual_idle", "使用复盘", f"你手动标记了 {len(manual)} 件闲置物品。",
             "依据物品当前状态；这些物品仍计入当前持有资产。", manual)
    inactive = [item for item in review if item["review_reason"] == "no_recent_record"]
    for item in inactive:
        card("inactive", "使用复盘", f"{item['name']} 距最近一次记录的使用已 {item['days_since_last_recorded_use']} 天。",
             f"最近一条使用记录：{item['last_recorded_use']}。满 90 天提示核对；记录可能不完整，不自动判定闲置。", [item])
    if unrecorded:
        card("unknown_use", "记录缺口", f"{len(unrecorded)} 件使用中物品的使用情况未知。",
             "这些物品从未填写使用记录，因此不参与 90 天判断。", unrecorded)

    if repairs and repairs[0]["total"] > 0:
        leaders = [row for row in repairs if row["total"] == repairs[0]["total"]]
        headline = (f"{leaders[0]['name']} 的历史累计维修费用最高。" if len(leaders) == 1
                    else f"{leaders[0]['name']} 等 {len(leaders)} 件物品的历史累计维修费用并列最高。")
        card("repair_leader", "费用发现", headline,
             f"每件累计维修费用 {money(leaders[0]['total'])} 元；包含已处置物品，并列时全部列出。", leaders)

    previous_end = today.replace(year=today.year - 1) if not (today.month == 2 and today.day == 29) else date(today.year - 1, 2, 28)
    this_start, last_start = f"{today.year}-01-01", f"{today.year - 1}-01-01"
    this_spend = sum(row["purchase_cents"] for row in all_rows if this_start <= row["purchase_date"] <= today.isoformat())
    last_spend = sum(row["purchase_cents"] for row in all_rows if last_start <= row["purchase_date"] <= previous_end.isoformat())
    if this_spend or last_spend:
        if not last_spend:
            headline = f"去年同期没有购置支出；今年已支出 {money(this_spend)} 元。"
        else:
            change = ((Decimal(this_spend - last_spend) * 100) / Decimal(last_spend)).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
            headline = ("今年购置支出与去年同期持平。" if change == 0 else
                        f"今年购置支出较去年同期{'增加' if change > 0 else '减少'} {abs(change)}%。")
        card("purchase_yoy", "费用发现", headline,
             f"今年 1 月 1 日至今天：{money(this_spend)} 元；去年 1 月 1 日至 {previous_end}：{money(last_spend)} 元。按购买日期统计，包含已处置物品。")
    return {
        "months": [{"month": month, **{key: money(value) for key, value in monthly[month].items()}}
                   for month in months],
        "review_threshold_days": 90,
        "review_items": review,
        "unknown_usage_items": unrecorded,
        "analysis_as_of": today.isoformat(),
        "analysis_cards": cards,
    }

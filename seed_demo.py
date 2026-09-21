"""Add a small demonstration dataset to an empty PALM database."""

from datetime import date, timedelta

from app import app


def day(days_ago):
    return (date.today() - timedelta(days=days_ago)).isoformat()


with app.test_client() as client:
    if client.get("/api/items").json:
        raise SystemExit("数据库已有物品，未导入演示数据。请在空数据库中运行。")

    def add_item(name, category, days_ago, price, status="active", notes=""):
        response = client.post("/api/items", json={
            "name": name, "category": category, "purchase_date": day(days_ago),
            "purchase_price": price, "status": status, "notes": notes,
        })
        assert response.status_code == 201, response.json
        return response.json["id"]

    laptop = add_item("学习笔记本电脑", "数码设备", 400, "4699.00", notes="用于课程作业与编程实践")
    client.post(f"/api/items/{laptop}/usage", json={"used_on": day(2), "notes": "完成课程项目开发"})
    client.post(f"/api/items/{laptop}/maintenance", json={"maintained_on": day(70), "cost": "180.00", "description": "更换电池"})

    add_item("旧款蓝牙音箱", "数码设备", 550, "299.00", "idle", "长期未使用，可考虑出售")

    bicycle = add_item("通勤自行车", "出行用品", 320, "899.00")
    client.post(f"/api/items/{bicycle}/usage", json={"used_on": day(15), "notes": "骑行通勤"})
    client.post(f"/api/items/{bicycle}/disposal", json={
        "disposed_on": day(10), "method": "sold", "proceeds": "450.00", "notes": "二手出售",
    })

    umbrella = add_item("折叠雨伞", "日常用品", 210, "39.90")
    client.post(f"/api/items/{umbrella}/disposal", json={
        "disposed_on": day(12), "method": "discarded", "proceeds": "0", "notes": "伞骨损坏",
    })

    keyboard = add_item("机械键盘", "数码设备", 240, "359.00")
    client.post(f"/api/items/{keyboard}/usage", json={"used_on": day(120), "notes": "完成一次长篇写作"})
    add_item("备用充电宝", "数码设备", 100, "129.00", notes="尚未填写使用记录")

print("已导入 6 件演示物品，覆盖费用分析、闲置复盘、记录缺口与处置试算。")

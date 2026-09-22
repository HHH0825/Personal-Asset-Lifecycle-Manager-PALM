"""Add a small demonstration dataset to an empty PALM database."""

from datetime import date, timedelta
from getpass import getpass

from app import app


def day(days_ago):
    return (date.today() - timedelta(days=days_ago)).isoformat()


with app.test_client() as client:
    username = input("导入到哪个已注册用户名：").strip()
    password = getpass("该账号密码：")
    client.environ_base["HTTP_X_CSRF_TOKEN"] = client.get("/api/auth/me").json["csrf_token"]
    login = client.post("/api/auth/login", json={"username": username, "password": password})
    if login.status_code != 200:
        raise SystemExit("登录失败，未导入演示数据。请先在网页注册账号。")
    client.environ_base["HTTP_X_CSRF_TOKEN"] = login.json["csrf_token"]
    if client.get("/api/items").json:
        raise SystemExit("该账号已有物品，未导入演示数据。请使用空档案账号。")

    def add_item(name, category, days_ago, price, status="active", notes="", icon_type="other"):
        response = client.post("/api/items", json={
            "name": name, "category": category, "purchase_date": day(days_ago),
            "purchase_price": price, "status": status, "notes": notes, "icon_type": icon_type,
        })
        assert response.status_code == 201, response.json
        return response.json["id"]

    laptop = add_item("学习笔记本电脑", "数码设备", 400, "4699.00", notes="用于课程作业与编程实践", icon_type="digital")
    client.post(f"/api/items/{laptop}/usage", json={"used_on": day(2), "notes": "完成课程项目开发"})
    client.post(f"/api/items/{laptop}/maintenance", json={"maintained_on": day(70), "cost": "180.00", "description": "更换电池"})

    add_item("旧款蓝牙音箱", "数码设备", 550, "299.00", "idle", "长期未使用，可考虑出售", "digital")

    bicycle = add_item("通勤自行车", "出行用品", 320, "899.00", icon_type="mobility")
    client.post(f"/api/items/{bicycle}/usage", json={"used_on": day(15), "notes": "骑行通勤"})
    client.post(f"/api/items/{bicycle}/disposal", json={
        "disposed_on": day(10), "method": "sold", "proceeds": "450.00", "notes": "二手出售",
    })

    umbrella = add_item("折叠雨伞", "日常用品", 210, "39.90", icon_type="daily")
    client.post(f"/api/items/{umbrella}/disposal", json={
        "disposed_on": day(12), "method": "discarded", "proceeds": "0", "notes": "伞骨损坏",
    })

    keyboard = add_item("机械键盘", "数码设备", 240, "359.00", icon_type="digital")
    client.post(f"/api/items/{keyboard}/usage", json={"used_on": day(120), "notes": "完成一次长篇写作"})
    add_item("备用充电宝", "数码设备", 100, "129.00", notes="尚未填写使用记录", icon_type="digital")

print(f"已向 {username} 导入 6 件演示物品，覆盖费用分析、闲置复盘、记录缺口与处置试算。")

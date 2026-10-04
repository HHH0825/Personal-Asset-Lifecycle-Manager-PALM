"""Measure authenticated HTTP payloads using generated photos and temporary data."""
import io
import json
from pathlib import Path
import random
import sys
import tempfile
from time import perf_counter

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from palm import create_app, initialize_app


def main():
    with tempfile.TemporaryDirectory(prefix="wwj-photo-benchmark-") as directory:
        root = Path(directory)
        app = initialize_app(create_app({"TESTING": True, "DATABASE": str(root / "db.sqlite3"),
            "PHOTO_DIR": str(root / "photos"), "WECHAT_CODE_EXCHANGER": lambda code: "benchmark"}))
        client = app.test_client()
        headers = {"Authorization": "Bearer " + client.post("/api/mp/auth/login", json={"code": "fixture"}).json["token"]}
        fixtures = []
        for index in range(6):
            item = client.post("/api/mp/items", headers=headers, json={"name": f"生成照片 {index+1}", "category": "测试",
                "purchase_date": "2025-01-01", "purchase_price": "1", "status": "active"}).json
            width, height = (1400, 1000) if index % 2 == 0 else (1000, 1400)
            image = Image.frombytes("RGB", (width, height), random.Random(index).randbytes(width * height * 3))
            stream = io.BytesIO(); image.save(stream, "PNG"); stream.seek(0)
            response = client.post(f"/api/mp/items/{item['id']}/photo", headers=headers, data={"photo": (stream, "fixture.png")})
            assert response.status_code == 200, response.json
            fixture = {"id": item["id"], "photo_version": response.json["photo_version"], "photo_url": response.json["photo_url"]}
            for size in ("full", "thumb"):
                start = perf_counter()
                with client.get(f"/api/mp/items/{item['id']}/photo?size={size}", headers=headers) as download:
                    assert download.status_code == 200
                    fixture[size] = len(download.data)
                fixture[size + "_http_ms"] = round((perf_counter() - start) * 1000, 2)
            fixtures.append(fixture)
        print(json.dumps(fixtures))


if __name__ == "__main__": main()

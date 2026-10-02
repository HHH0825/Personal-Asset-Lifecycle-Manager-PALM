from io import BytesIO
from pathlib import Path
import os
import secrets
import tempfile
from flask import current_app
from PIL import Image, ImageOps, UnidentifiedImageError
from .repository import swap_photo_key
from .validation import InputError

PHOTO_MAX_BYTES = 5 * 1024 * 1024
Image.MAX_IMAGE_PIXELS = 24_000_000

def remove_photo_file(photo_key):
    if not photo_key:
        return
    try:
        (Path(current_app.config["PHOTO_DIR"]) / photo_key).unlink(missing_ok=True)
    except OSError:
        current_app.logger.warning("无法清理旧物品照片：%s", photo_key)

def normalized_photo(upload):
    if not upload or not upload.filename:
        raise InputError("请选择照片")
    raw = upload.stream.read(PHOTO_MAX_BYTES + 1)
    if len(raw) > PHOTO_MAX_BYTES:
        raise InputError("照片不能超过 5 MB")
    try:
        with Image.open(BytesIO(raw)) as source:
            if source.format not in ("JPEG", "PNG", "WEBP"):
                raise InputError("照片只支持 JPEG、PNG 或 WebP")
            if source.width * source.height > Image.MAX_IMAGE_PIXELS:
                raise InputError("照片尺寸过大")
            photo = ImageOps.exif_transpose(source)
            photo.load()
            photo.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
            rgba = photo.convert("RGBA")
            canvas = Image.new("RGB", rgba.size, "#f7f4ec")
            canvas.paste(rgba, mask=rgba.getchannel("A"))
            output = BytesIO()
            canvas.save(output, "JPEG", quality=85, optimize=True)
            return output.getvalue()
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as exc:
        raise InputError("照片文件无效，请换一张 JPEG、PNG 或 WebP 图片") from exc


def save_photo(item_id, upload):
    encoded = normalized_photo(upload)
    folder = Path(current_app.config["PHOTO_DIR"])
    folder.mkdir(parents=True, exist_ok=True)
    new_key = secrets.token_hex(16) + ".jpg"
    descriptor, temporary = tempfile.mkstemp(prefix="palm-photo-", suffix=".tmp", dir=folder)
    new_file = folder / new_key
    try:
        with os.fdopen(descriptor, "wb") as output:
            output.write(encoded)
        os.replace(temporary, new_file)
        old_key = swap_photo_key(item_id, new_key)
    except Exception:
        Path(temporary).unlink(missing_ok=True)
        new_file.unlink(missing_ok=True)
        raise
    remove_photo_file(old_key)


def delete_photo(item_id):
    remove_photo_file(swap_photo_key(item_id, None))

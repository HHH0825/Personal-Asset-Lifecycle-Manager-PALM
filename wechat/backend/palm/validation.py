from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from flask import request

ICON_TYPES = frozenset(("digital", "home", "daily", "clothing", "books", "mobility", "sports", "tools", "other"))
AVATAR_KEYS = frozenset(("sprout", "cat", "book", "sun", "bike", "star"))

class InputError(Exception):
    pass

def body():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise InputError("请提交 JSON 对象")
    return data

def value(data, key, label, max_length=120, required=True):
    raw = data.get(key, "")
    if not isinstance(raw, str):
        raise InputError(f"{label}格式不正确")
    result = raw.strip()
    if required and not result:
        raise InputError(f"请填写{label}")
    if len(result) > max_length:
        raise InputError(f"{label}不能超过 {max_length} 字")
    return result

def date_value(data, key, label):
    raw = value(data, key, label, 10)
    try:
        parsed = date.fromisoformat(raw)
    except ValueError as exc:
        raise InputError(f"{label}必须是有效日期") from exc
    if parsed.isoformat() != raw or parsed > date.today():
        raise InputError(f"{label}必须是不晚于今天的有效日期")
    return raw

def warranty_value(data, purchase_date, default=None):
    raw = data.get("warranty_expires_on", default)
    if raw is None or raw == "":
        return None
    if not isinstance(raw, str):
        raise InputError("保修到期日必须是有效日期")
    try:
        parsed = date.fromisoformat(raw)
    except ValueError as exc:
        raise InputError("保修到期日必须是有效日期") from exc
    if parsed.isoformat() != raw:
        raise InputError("保修到期日必须是有效日期")
    if raw < purchase_date:
        raise InputError("保修到期日不能早于购买日期")
    return raw

def cents_value(data, key, label):
    raw = data.get(key)
    if isinstance(raw, bool) or raw is None:
        raise InputError(f"请填写{label}")
    try:
        number = Decimal(str(raw))
    except (InvalidOperation, ValueError) as exc:
        raise InputError(f"{label}必须是非负金额") from exc
    if not number.is_finite() or number < 0 or number > 999999999 or number.as_tuple().exponent < -2:
        raise InputError(f"{label}必须是非负金额，最多两位小数")
    return int(number * 100)

def money(cents):
    return f"{cents / 100:.2f}"

def daily_cost(cents, days):
    if days == 0:
        return None
    return str((Decimal(cents) / (Decimal(days) * 100)).quantize(
        Decimal("0.01"), rounding=ROUND_HALF_UP))

def icon_type_value(data, default):
    icon_type = data.get("icon_type", default)
    if not isinstance(icon_type, str) or icon_type not in ICON_TYPES:
        raise InputError("请选择有效的物品类型")
    return icon_type

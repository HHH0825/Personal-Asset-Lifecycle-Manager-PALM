"""Date-based keepsakes and purchase-cost goals, independent of storage."""

from datetime import date, timedelta


def add_days(start, days):
    """An expensive item and a tiny target can exceed Python's date range."""
    return start + timedelta(days=days) if days <= (date.max - start).days else None


def item_journey(purchased, end, purchase_cents, target_cents, today, disposed=False):
    candidates = []
    hundred = add_days(purchased, 100)
    if hundred:
        candidates.append((hundred, "hundred", "相伴百日", "100"))
    for year in range(purchased.year + 1, min(end.year + 1, 9999) + 1):
        try:
            anniversary = purchased.replace(year=year)
        except ValueError:
            anniversary = date(year, 2, 28)
        years = year - purchased.year
        candidates.append((anniversary, f"year-{years}", f"相伴 {years} 年", str(years)))
    candidates.sort()
    earned, upcoming = [], None
    for occurred, key, label, number in candidates:
        entry = {"id": key, "label": label, "number": number, "date": occurred.isoformat(),
                 "is_today": occurred == today}
        if occurred <= end:
            earned.append(entry)
        elif not disposed and upcoming is None:
            upcoming = {**entry, "remaining_days": (occurred - end).days}
    target = None
    if target_cents is not None:
        days = (end - purchased).days
        required = max(1, (purchase_cents + target_cents - 1) // target_cents)
        target_date = add_days(purchased, required)
        reached = days >= required
        target = {
            "amount": f"{target_cents / 100:.2f}",
            "status": "reached" if reached else "closed" if disposed else "pending",
            "required_days": required, "remaining_days": max(0, required - days),
            "progress_percent": min(100, days * 10000 // required / 100),
            "estimated_date": target_date.isoformat() if target_date and not disposed and not reached else None,
            "reached_on": target_date.isoformat() if reached else None,
            "is_today": reached and target_date == today,
        }
    return {"milestones": {"earned": earned, "next": upcoming}, "daily_target": target}

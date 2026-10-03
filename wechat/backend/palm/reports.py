"""Monthly snapshots from currently saved, non-deleted records."""
import calendar
import re
from datetime import date
from .database import get_db
from .journey import item_journey
from .repository import list_item_rows
from .validation import InputError, money


def month_bounds(month, today):
    if not isinstance(month, str) or not re.fullmatch(r'\d{4}-\d{2}', month):
        raise InputError('月份格式应为 YYYY-MM')
    try:
        start = date.fromisoformat(month + '-01')
    except ValueError:
        raise InputError('月份无效') from None
    if start > today:
        raise InputError('不能查看未来月份')
    return start, min(today, date(start.year, start.month, calendar.monthrange(start.year, start.month)[1]))


def monthly_events(user_id, start, end):
    result = {}
    for kind, table, column, amount in (
        ('maintenance', 'maintenance_records', 'maintained_on', 'cost_cents'),
        ('disposal', 'disposal_records', 'disposed_on', 'proceeds_cents'),
        ('usage', 'usage_records', 'used_on', None),
    ):
        aggregate = f'COALESCE(SUM(e.{amount}), 0)' if amount else '0'
        result[kind] = dict(get_db().execute(
            f'''SELECT COUNT(*) AS count, {aggregate} AS cents FROM {table} e
                JOIN items i ON i.id = e.item_id
                WHERE i.user_id = ? AND i.deleted_at IS NULL AND e.{column} BETWEEN ? AND ?''',
            (user_id, start.isoformat(), end.isoformat()),
        ).fetchone())
    return result


def build_monthly_report(month, today, rows, events):
    start, cutoff = month_bounds(month, today)
    first, last = start.isoformat(), cutoff.isoformat()
    purchases, memories = [], []
    purchase_cents = 0
    for row in rows:
        if first <= row['purchase_date'] <= last:
            purchase_cents += row['purchase_cents']
            purchases.append({'id': row['id'], 'name': row['name'], 'icon_type': row['icon_type'],
                              'purchase_date': row['purchase_date'], 'purchase_price': money(row['purchase_cents'])})
        disposed = row['disposal_id'] is not None
        end = date.fromisoformat(row['disposed_on']) if disposed else today
        journey = item_journey(date.fromisoformat(row['purchase_date']), end, row['purchase_cents'],
                               row['daily_target_cents'], today, disposed)
        earned = journey['milestones']['earned']
        target = journey['daily_target']
        if target and target['status'] == 'reached':
            earned = [*earned, {'id': 'daily-target', 'date': target['reached_on'],
                               'label': f"购买价 / 天达到 ¥{target['amount']}"}]
        for stamp in earned:
            if first <= stamp['date'] <= last:
                memories.append({'key': f"{row['id']}-{stamp['id']}", 'item_id': row['id'],
                                 'name': row['name'], 'date': stamp['date'], 'label': stamp['label'],
                                 'kind': 'target' if stamp['id'] == 'daily-target' else 'milestone'})
    purchases.sort(key=lambda item: (item['purchase_date'], item['id']), reverse=True)
    memories.sort(key=lambda item: (item['date'], item['item_id'], item['key']), reverse=True)
    return {
        'month': month, 'today': today.isoformat(), 'cutoff_date': last,
        'is_current': month == today.strftime('%Y-%m'),
        'totals': {'purchase_count': len(purchases), 'purchase_total': money(purchase_cents),
                   'maintenance_total': money(events['maintenance']['cents']),
                   'disposal_total': money(events['disposal']['cents']), 'usage_count': events['usage']['count']},
        'purchases': purchases, 'memories': memories,
        'has_activity': bool(purchases or memories or any(event['count'] for event in events.values())),
    }


def monthly_report(user_id, month=None, today=None):
    today = today or date.today()
    month = month if month is not None else today.strftime('%Y-%m')
    start, cutoff = month_bounds(month, today)
    return build_monthly_report(month, today, list_item_rows(user_id, today=today.isoformat()),
                                monthly_events(user_id, start, cutoff))

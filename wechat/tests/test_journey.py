import sys
import unittest
from pathlib import Path
from datetime import date
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from palm.journey import item_journey

class JourneyTest(unittest.TestCase):
    def test_leap_anniversary_disposal_and_hundred_days(self):
        result = item_journey(date(2024, 2, 29), date(2025, 2, 28), 10000, None, date(2026, 3, 1), True)
        self.assertEqual([e['date'] for e in result['milestones']['earned']], ['2024-06-08', '2025-02-28'])
        self.assertIsNone(result['milestones']['next'])

    def test_target_today_zero_price_and_cancel(self):
        start = date(2025, 1, 1)
        self.assertEqual(item_journey(start, start, 0, 500, start)['daily_target']['status'], 'pending')
        self.assertEqual(item_journey(start, date(2025, 1, 2), 0, 500, start)['daily_target']['status'], 'reached')
        self.assertEqual(item_journey(start, date(2025, 1, 2), 10000, 500, start, True)['daily_target']['status'], 'closed')
        self.assertIsNone(item_journey(start, start, 100, None, start)['daily_target'])

if __name__ == '__main__': unittest.main()

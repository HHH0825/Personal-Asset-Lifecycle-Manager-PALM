import unittest
from datetime import date, timedelta

from journey import item_journey


class JourneyTest(unittest.TestCase):
    def test_hundred_day_boundary(self):
        purchased = date(2025, 1, 1)
        for days in (99, 100, 101):
            today = purchased + timedelta(days=days)
            milestones = item_journey(purchased, today, 10000, None, today)["milestones"]
            self.assertEqual(len(milestones["earned"]), 0 if days == 99 else 1)
            if days == 99:
                self.assertEqual(milestones["next"]["remaining_days"], 1)
            else:
                self.assertEqual(milestones["earned"][0]["is_today"], days == 100)
                self.assertEqual(milestones["next"]["date"], "2026-01-01")

    def test_leap_anniversaries_and_disposal_cutoff(self):
        purchased = date(2024, 2, 29)
        for end, expected in ((date(2025, 2, 27), False), (date(2025, 2, 28), True)):
            result = item_journey(purchased, end, 10000, None, end)["milestones"]
            self.assertEqual(any(entry["id"] == "year-1" for entry in result["earned"]), expected)
        leap = item_journey(purchased, date(2028, 2, 28), 10000, None, date(2028, 2, 28))["milestones"]
        self.assertEqual(leap["next"]["date"], "2028-02-29")
        disposed = item_journey(purchased, date(2025, 2, 27), 10000, None, date(2028, 3, 1), True)
        self.assertIsNone(disposed["milestones"]["next"])
        self.assertEqual([entry["id"] for entry in disposed["milestones"]["earned"]], ["hundred"])

    def test_exact_target_does_not_use_rounded_daily_cost(self):
        purchased = date(2025, 1, 1)
        today = purchased + timedelta(days=300)
        target = item_journey(purchased, today, 30001, 100, today)["daily_target"]
        self.assertEqual(target["required_days"], 301)
        self.assertEqual(target["status"], "pending")
        self.assertEqual(target["remaining_days"], 1)
        self.assertLess(target["progress_percent"], 100)
        tomorrow = today + timedelta(days=1)
        reached = item_journey(purchased, tomorrow, 30001, 100, tomorrow)["daily_target"]
        self.assertEqual((reached["status"], reached["progress_percent"], reached["is_today"]), ("reached", 100, True))
        closed = item_journey(purchased, today, 30001, 100, tomorrow, True)["daily_target"]
        self.assertEqual(closed["status"], "closed")
        self.assertIsNone(closed["estimated_date"])

    def test_zero_price_same_day_and_date_overflow(self):
        purchased = date(2026, 9, 22)
        same_day = item_journey(purchased, purchased, 0, 100, purchased)["daily_target"]
        self.assertEqual((same_day["status"], same_day["required_days"], same_day["progress_percent"]), ("pending", 1, 0))
        tomorrow = purchased + timedelta(days=1)
        self.assertEqual(item_journey(purchased, tomorrow, 0, 100, tomorrow)["daily_target"]["status"], "reached")
        overflow = item_journey(purchased, tomorrow, 99999999900, 1, tomorrow)["daily_target"]
        self.assertIsNone(overflow["estimated_date"])
        self.assertEqual(overflow["remaining_days"], 99999999899)
        self.assertEqual(overflow["status"], "pending")

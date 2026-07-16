import importlib.util
import json
import sys
import unittest
from datetime import date
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW_PATH = ROOT / "hermes-plugin" / "japan_hotel_research" / "workflow.py"


def load_workflow():
    spec = importlib.util.spec_from_file_location("japan_hotel_research_workflow", WORKFLOW_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class JapanHotelResearchContractTest(unittest.TestCase):
    def test_parses_exact_vietnamese_telegram_payload(self):
        workflow = load_workflow()
        request = workflow.parse_request(
            """kiểm tra phòng trống theo thông tin sau:
Khu vực: Tateyama,Chiba,Nhật Bản.
Checkin: 2026-08-15
Checkout 2026-08-16
Người lớn: 2
Trẻ em: 2 tuổi + 9 tuổi
Số phòng: 1""",
            today=date(2026, 7, 16),
        )

        self.assertEqual(request.area, "Tateyama,Chiba,Nhật Bản")
        self.assertEqual(request.checkin, "2026-08-15")
        self.assertEqual(request.checkout, "2026-08-16")
        self.assertEqual(request.adults, 2)
        self.assertEqual(request.children_ages, [2, 9])
        self.assertEqual(request.rooms, 1)
        self.assertEqual(request.max_results_per_site, 3)

    def test_normalizes_vietnamese_country_for_airbnb_slug(self):
        workflow = load_workflow()
        self.assertEqual(
            workflow._normalize_japan_location("Tateyama,Chiba,Nhật Bản."),
            ["Tateyama", "Chiba", "Japan"],
        )

    def test_rejects_children_without_ages_before_browser_use(self):
        workflow = load_workflow()
        with self.assertRaisesRegex(workflow.RequestValidationError, "tuổi"):
            workflow.parse_request(
                """Khu vực: Tateyama, Chiba
Checkin: 2026-08-15
Checkout: 2026-08-16
Người lớn: 2
Trẻ em: 2
Số phòng: 1"""
            )

    def test_rejects_invalid_date_order(self):
        workflow = load_workflow()
        with self.assertRaisesRegex(workflow.RequestValidationError, "sau ngày check-in"):
            workflow.parse_request(
                """Khu vực: Tateyama, Chiba
Checkin: 2026-08-16
Checkout: 2026-08-15
Người lớn: 2
Trẻ em: không
Số phòng: 1"""
            )

    def test_formats_operator_friendly_vietnamese_summary(self):
        workflow = load_workflow()
        request = workflow.HotelRequest(
            area="Tateyama, Chiba, Nhật Bản",
            checkin="2026-08-15",
            checkout="2026-08-16",
            adults=2,
            children_ages=[2, 9],
            rooms=1,
            max_results_per_site=3,
        )
        report = {
            "status": "partial",
            "checked_at": "2026-07-16T00:00:00Z",
            "sites": {
                "jalan": {"status": "no_results", "results": [], "warnings": []},
                "airbnb": {"status": "completed", "results": [{"name": "Mẫu", "price": "¥10,000", "url": "https://example.test"}], "warnings": []},
                "booking": {"status": "blocked", "results": [], "warnings": ["Tiêu chí bị reset sau submit."]},
            },
            "artifact_path": "/tmp/report.json",
        }

        text = workflow.format_vietnamese_report(request, report)
        self.assertIn("Kết quả kiểm tra phòng", text)
        self.assertIn("Tateyama", text)
        self.assertIn("Airbnb", text)
        self.assertIn("¥10,000", text)
        self.assertIn("không đặt phòng", text.lower())
        self.assertIn("/tmp/report.json", text)

    def test_structured_report_does_not_serialize_secret_environment(self):
        workflow = load_workflow()
        serialized = json.dumps(workflow.build_report_skeleton(), ensure_ascii=False)
        for forbidden in ("TELEGRAM_BOT_TOKEN", "TAVILY_API_KEY", "REDDIT_CLIENT_SECRET"):
            self.assertNotIn(forbidden, serialized)


if __name__ == "__main__":
    unittest.main()

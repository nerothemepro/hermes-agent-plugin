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

    def test_builds_complete_booking_search_url_for_headed_runtime(self):
        from urllib.parse import parse_qs, urlsplit

        workflow = load_workflow()
        request = workflow.HotelRequest(
            area="Tateyama, Chiba, Nhật Bản",
            checkin="2026-08-15",
            checkout="2026-08-16",
            adults=2,
            children_ages=[2, 9],
            rooms=1,
        )

        query = parse_qs(urlsplit(workflow.build_booking_search_url(request)).query)

        self.assertEqual(query["ss"], ["Tateyama, Chiba, Nhật Bản"])
        self.assertEqual(query["checkin"], ["2026-08-15"])
        self.assertEqual(query["checkout"], ["2026-08-16"])
        self.assertEqual(query["group_adults"], ["2"])
        self.assertEqual(query["group_children"], ["2"])
        self.assertEqual(query["age"], ["2", "9"])
        self.assertEqual(query["room1"], ["A,A,2,9"])

    def test_places_evidence_path_before_site_details(self):
        workflow = load_workflow()
        request = workflow.HotelRequest(
            area="Tateyama", checkin="2026-08-15", checkout="2026-08-16",
            adults=2, children_ages=[], rooms=1,
        )
        report = {
            "status": "completed",
            "artifact_path": "/tmp/evidence/report.json",
            "sites": {
                "jalan": {"status": "completed", "results": [], "warnings": [], "errors": []},
                "airbnb": {"status": "completed", "results": [], "warnings": [], "errors": []},
                "booking": {"status": "completed", "results": [], "warnings": [], "errors": []},
            },
        }

        text = workflow.format_vietnamese_report(request, report)

        self.assertIn("Evidence JSON: /tmp/evidence/report.json", text)
        self.assertLess(text.index("Evidence JSON:"), text.index("Jalan.net:"))

    def test_parses_current_booking_property_card_snapshot(self):
        workflow = load_workflow()
        snapshot = """
              - listitem "Property":
                - heading [level=3]:
                  - link "Shinon 森音 Opens in new window":
                    - /url: https://www.booking.com/hotel/jp/shinon-sen-yin.html?checkin=2026-08-15&checkout=2026-08-16&group_children=2
                    - text: Shinon 森音
                - generic: ¥115,200
        """

        results = workflow._booking_extract_results(snapshot, 3)

        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["name"], "Shinon 森音")
        self.assertEqual(results[0]["price"], "¥115,200")
        self.assertIn("checkin=2026-08-15", results[0]["url"])

    def test_terminates_entire_mcp_process_group(self):
        import os
        import signal
        import subprocess
        import tempfile
        import time

        workflow = load_workflow()
        with tempfile.TemporaryDirectory() as tmp:
            pid_file = Path(tmp) / "child.pid"
            proc = subprocess.Popen(
                ["bash", "-c", f"sleep 60 & echo $! > {pid_file}; wait"],
                start_new_session=True,
            )
            try:
                for _ in range(50):
                    if pid_file.exists():
                        break
                    time.sleep(0.02)
                child_pid = int(pid_file.read_text())

                workflow._terminate_process_group(proc)

                self.assertIsNotNone(proc.poll())
                for _ in range(50):
                    try:
                        os.kill(child_pid, 0)
                    except ProcessLookupError:
                        break
                    time.sleep(0.02)
                else:
                    self.fail("MCP child process survived process-group cleanup")
            finally:
                if proc.poll() is None:
                    os.killpg(proc.pid, signal.SIGKILL)
                    proc.wait(timeout=5)


if __name__ == "__main__":
    unittest.main()

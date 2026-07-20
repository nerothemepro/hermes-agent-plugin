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
        self.assertFalse(request.ranking_requested)

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
                - generic: Scored 8.8 Excellent 240 reviews
                - generic: ¥115,200
        """

        results = workflow._booking_extract_results(snapshot, 3)

        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["name"], "Shinon 森音")
        self.assertEqual(results[0]["price"], "¥115,200")
        self.assertEqual(results[0]["price_jpy_total"], 115200)
        self.assertEqual(results[0]["rating"], 8.8)
        self.assertEqual(results[0]["rating_scale"], 10)
        self.assertEqual(results[0]["rating_label"], "Excellent")
        self.assertEqual(results[0]["review_count"], 240)
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

    def test_parses_price_and_defaults_top_n_to_per_site(self):
        workflow = load_workflow()
        request = workflow.parse_request(
            """kiểm tra phòng trống và trả về top 5 kết quả được đánh giá cao nhất:
Khu vực: Tateyama, Chiba, Nhật Bản
Checkin: 2026-08-16
Checkout: 2026-08-17
Người lớn: 2
Trẻ em: 2 tuổi + 9 tuổi
Số phòng: 1
Giá: 20000y/1 đêm""",
            today=date(2026, 7, 16),
        )

        self.assertEqual(request.max_results_per_site, 5)
        self.assertEqual(request.max_price_jpy_per_night, 20000)
        self.assertEqual(request.ranking_scope, "per_site")
        self.assertTrue(request.ranking_requested)

    def test_explicit_all_three_sites_selects_global_ranking(self):
        workflow = load_workflow()
        request = workflow.parse_request(
            """trả về top 5 kết quả từ cả 3 trang
Khu vực: Tateyama, Chiba, Nhật Bản
Checkin: 2026-08-16
Checkout: 2026-08-17
Người lớn: 2
Trẻ em: không
Số phòng: 1
Giá: 20.000 JPY/đêm""",
            today=date(2026, 7, 16),
        )

        self.assertEqual(request.max_results_per_site, 5)
        self.assertEqual(request.max_price_jpy_per_night, 20000)
        self.assertEqual(request.ranking_scope, "global")

    def test_unknown_price_basis_is_not_rankable(self):
        workflow = load_workflow()
        request = workflow.HotelRequest(
            area="Tateyama", checkin="2026-08-16", checkout="2026-08-17",
            adults=2, children_ages=[], rooms=1,
        )

        normalized = workflow._normalize_provider_results(
            "jalan",
            [{"price_jpy_total": 10000, "price_basis": "unknown", "rating": 4.8, "rating_scale": 5}],
            request,
        )

        self.assertIsNone(normalized[0]["price_jpy_per_night"])

    def test_filters_and_ranks_globally_without_relaxing_price(self):
        workflow = load_workflow()
        request = workflow.HotelRequest(
            area="Tateyama", checkin="2026-08-16", checkout="2026-08-17",
            adults=2, children_ages=[], rooms=1, max_results_per_site=5,
            max_price_jpy_per_night=20000, ranking_scope="global",
        )
        sites = {
            "jalan": {"results": [
                {"name": "Jalan A", "rating_normalized_10": 9.2, "review_count": 10, "price_jpy_per_night": 19000},
            ]},
            "airbnb": {"results": [
                {"name": "Too expensive", "rating_normalized_10": 10.0, "review_count": 100, "price_jpy_per_night": 21000},
            ]},
            "booking": {"results": [
                {"name": "Booking A", "rating_normalized_10": 9.2, "review_count": 50, "price_jpy_per_night": 18000},
                {"name": "Booking B", "rating_normalized_10": 8.8, "review_count": 240, "price_jpy_per_night": 19000},
            ]},
        }

        ranking = workflow.build_rankings(request, sites)

        self.assertEqual(ranking["scope"], "global")
        self.assertEqual([item["name"] for item in ranking["results"]], ["Booking A", "Jalan A", "Booking B"])
        self.assertEqual(ranking["rejected_over_price"], 1)

    def test_parses_airbnb_price_rating_and_review_count(self):
        workflow = load_workflow()
        snapshot = """
          - link:
            - /url: /rooms/123?check_in=2026-08-16&check_out=2026-08-17
          - generic: Tateyama family villa
          - generic: レビュー88件、5つ星中4.86つ星の平均評価
          - text: ¥17,907 JPY
          - generic: ¥17,907 JPY （1泊）
        """

        results = workflow._parse_airbnb_results(snapshot, 5)

        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["price_jpy_total"], 17907)
        self.assertEqual(results[0]["rating"], 4.86)
        self.assertEqual(results[0]["rating_scale"], 5)
        self.assertEqual(results[0]["review_count"], 88)

    def test_formats_global_ranking_summary(self):
        workflow = load_workflow()
        request = workflow.HotelRequest(
            area="Tateyama", checkin="2026-08-16", checkout="2026-08-17",
            adults=2, children_ages=[], rooms=1, max_results_per_site=2,
            max_price_jpy_per_night=20000, ranking_scope="global",
        )
        report = {
            "status": "completed",
            "artifact_path": "/tmp/global.json",
            "sites": {name: {"status": "completed", "results": [], "warnings": [], "errors": []} for name in ("jalan", "airbnb", "booking")},
            "ranking": {
                "scope": "global", "top_n": 2, "max_price_jpy_per_night": 20000,
                "scanned": 20, "rejected_over_price": 15, "rejected_missing_evidence": 1,
                "results": [
                    {"provider": "booking", "name": "Hotel A", "rating_normalized_10": 9.2, "rating_label": "Wonderful", "review_count": 100, "price_jpy_per_night": 18000, "url": "https://example.test/a"},
                ],
            },
        }

        text = workflow.format_vietnamese_report(request, report)

        self.assertIn("Top 2 tổng hợp từ cả 3 website", text)
        self.assertIn("[Booking.com] Hotel A", text)
        self.assertIn("9.2/10", text)
        self.assertIn("100 đánh giá", text)
        self.assertIn("¥18,000/đêm", text)
        self.assertIn("15 vượt giá", text)

    def test_formats_per_site_ranking_summary(self):
        workflow = load_workflow()
        request = workflow.HotelRequest(
            area="Tateyama", checkin="2026-08-16", checkout="2026-08-17",
            adults=2, children_ages=[], rooms=1, max_results_per_site=2,
            max_price_jpy_per_night=20000, ranking_scope="per_site",
        )
        item = {"provider": "airbnb", "name": "Villa B", "rating_normalized_10": 9.8, "rating_label": "", "review_count": 88, "price_jpy_per_night": 17907, "url": "https://example.test/b"}
        report = {
            "status": "completed", "artifact_path": "/tmp/per-site.json",
            "sites": {name: {"status": "completed", "results": [], "warnings": [], "errors": []} for name in ("jalan", "airbnb", "booking")},
            "ranking": {
                "scope": "per_site", "top_n": 2, "max_price_jpy_per_night": 20000,
                "scanned": 10, "rejected_over_price": 3, "rejected_missing_evidence": 0,
                "by_site": {"jalan": [], "airbnb": [item], "booking": []},
            },
        }

        text = workflow.format_vietnamese_report(request, report)

        self.assertIn("Top 2 riêng cho từng website", text)
        self.assertIn("Airbnb Japan", text)
        self.assertIn("Villa B", text)
        self.assertIn("9.8/10", text)

    def test_airbnb_card_window_reaches_price_after_repeated_image_links(self):
        workflow = load_workflow()
        filler = "\n".join(f"          - generic: filler {index}" for index in range(50))
        snapshot = (
            "          - /url: /rooms/456?check_in=2026-08-16&check_out=2026-08-17\n"
            "          - generic: レビュー20件、5つ星中4.9つ星の平均評価\n"
            + filler
            + "\n          - text: ¥19,500 JPY\n          - generic: ¥19,500 JPY （1泊)"
        )

        results = workflow._parse_airbnb_results(snapshot, 5)

        self.assertEqual(results[0]["price_jpy_total"], 19500)

    def test_airbnb_card_does_not_mix_next_listing_metadata(self):
        workflow = load_workflow()
        snapshot = """
          - /url: /rooms/111?check_in=2026-08-16&check_out=2026-08-17
          - generic: First Tateyama villa
          - /url: /rooms/111?check_in=2026-08-16&check_out=2026-08-17
          - /url: /rooms/222?check_in=2026-08-17&check_out=2026-08-18
          - generic: Second Tateyama villa
          - generic: レビュー99件、5つ星中5.0つ星の平均評価
          - text: ¥10,000 JPY
          - generic: ¥10,000 JPY （1泊）
        """

        results = workflow._parse_airbnb_results(snapshot, 5)

        self.assertEqual(len(results), 2)
        self.assertEqual(results[0]["name"], "First Tateyama villa")
        self.assertIsNone(results[0]["price_jpy_total"])
        self.assertIsNone(results[0]["review_count"])
        self.assertEqual(results[1]["name"], "Second Tateyama villa")
        self.assertEqual(results[1]["price_jpy_total"], 10000)

    def test_airbnb_rejects_alternative_dates(self):
        workflow = load_workflow()
        request = workflow.HotelRequest(
            area="Tateyama", checkin="2026-08-16", checkout="2026-08-17",
            adults=2, children_ages=[2, 9], rooms=1,
        )
        exact = {"url": "https://www.airbnb.jp/rooms/111?check_in=2026-08-16&check_out=2026-08-17"}
        alternative = {"url": "https://www.airbnb.jp/rooms/222?check_in=2026-08-17&check_out=2026-08-18"}

        self.assertTrue(workflow._airbnb_result_matches_request(exact, request))
        self.assertFalse(workflow._airbnb_result_matches_request(alternative, request))


if __name__ == "__main__":
    unittest.main()

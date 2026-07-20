import importlib.util
import pathlib
import unittest
from datetime import datetime, timezone

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "scripts/herresearch_mmo_trend_collector.py"


def load():
    spec = importlib.util.spec_from_file_location("mmo_collector", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader
    spec.loader.exec_module(module)
    return module


class EvidenceGateTests(unittest.TestCase):
    def setUp(self):
        self.collector = load()
        self.now = datetime(2026, 7, 20, tzinfo=timezone.utc)

    def test_counts_only_successfully_extracted_distinct_urls(self):
        records = self.collector.build_evidence_records(
            [
                {"url": "https://one.example/a", "title": "One", "published_date": "2026-07-20T00:00:00Z", "query_family": "news"},
                {"url": "https://two.example/b", "title": "Two", "published_date": "2026-07-20T00:00:00Z", "query_family": "buying_intent"},
            ],
            {"results": [{"url": "https://one.example/a", "raw_content": "Verified full page content."}]},
            self.now,
        )
        self.assertEqual(1, len(records))
        self.assertEqual("https://one.example/a", records[0]["url"])

    def test_passes_minimum_gate_only_with_eight_urls_and_five_domains(self):
        sources, extracts = [], []
        for index in range(8):
            url = f"https://source{index % 5}.example/article-{index}"
            sources.append({"url": url, "title": f"Source {index}", "published_date": "2026-07-20T00:00:00Z", "query_family": "news"})
            extracts.append({"url": url, "raw_content": f"Full evidence {index}"})
        report = self.collector.build_report(sources, {"results": extracts}, self.now, [])
        self.assertEqual("evidence_collected", report["status"])
        self.assertEqual(8, report["source_counts"]["total_urls"])
        self.assertEqual(5, report["source_counts"]["independent_domains"])

    def test_fails_closed_without_minimum_evidence(self):
        report = self.collector.build_report([], {"results": []}, self.now, ["Reddit: HTTP 403"])
        self.assertEqual("insufficient_evidence", report["status"])
        self.assertEqual(0, report["source_counts"]["total_urls"])
        self.assertEqual(["Reddit: HTTP 403"], report["unavailable_sources"])


if __name__ == "__main__":
    unittest.main()

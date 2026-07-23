import importlib.util
import pathlib
import unittest
from datetime import datetime, timezone


SCRIPT_PATH = (
    pathlib.Path(__file__).resolve().parents[1]
    / "scripts"
    / "herresearch_mmo_trend_collector.py"
)


def load_collector_module():
    spec = importlib.util.spec_from_file_location("mmo_collector", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class EvidenceGateTests(unittest.TestCase):
    def setUp(self):
        self.collector = load_collector_module()
        self.now = datetime(2026, 7, 20, 0, 0, tzinfo=timezone.utc)

    def test_counts_only_successfully_extracted_distinct_urls(self):
        records = self.collector.build_evidence_records(
            [
                {
                    "url": "https://one.example/a",
                    "title": "One",
                    "published_date": "2026-07-20T00:00:00Z",
                    "query_family": "news",
                },
                {
                    "url": "https://two.example/b",
                    "title": "Two",
                    "published_date": "2026-07-20T00:00:00Z",
                    "query_family": "buying_intent",
                },
            ],
            {
                "results": [
                    {
                        "url": "https://one.example/a",
                        "raw_content": "Verified full page content.",
                    }
                ]
            },
            self.now,
        )

        self.assertEqual(1, len(records))
        self.assertEqual("https://one.example/a", records[0]["url"])

    def test_raw_source_counts_do_not_create_a_rank_without_niche_level_evidence(self):
        sources = []
        extracts = []
        for index in range(8):
            domain = f"source{index % 5}.example"
            url = f"https://{domain}/article-{index}"
            sources.append(
                {
                    "url": url,
                    "title": f"Source {index}",
                    "published_date": "2026-07-20T00:00:00Z",
                    "query_family": "news",
                }
            )
            extracts.append({"url": url, "raw_content": f"Full evidence {index}"})

        report = self.collector.build_report(
            sources,
            {"results": extracts},
            self.now,
            unavailable_sources=[],
        )

        self.assertEqual("insufficient_evidence", report["status"])
        self.assertEqual(8, report["source_counts"]["total_urls"])
        self.assertEqual(5, report["source_counts"]["independent_domains"])
        self.assertEqual([], report["top_niches"])

    def test_fails_closed_without_the_minimum_evidence(self):
        report = self.collector.build_report(
            [], {"results": []}, self.now, unavailable_sources=["Reddit: HTTP 403"]
        )

        self.assertEqual("insufficient_evidence", report["status"])
        self.assertEqual(0, report["source_counts"]["total_urls"])
        self.assertEqual(["Reddit: HTTP 403"], report["unavailable_sources"])

    def test_rendered_report_never_contains_api_key_value(self):
        report = self.collector.build_report(
            [], {"results": []}, self.now, unavailable_sources=[]
        )
        rendered = self.collector.render_markdown(report)

        self.assertNotIn("test-secret-value", rendered)
        self.assertIn("insufficient_evidence", rendered)

    def test_extracts_publication_date_from_full_page_when_search_metadata_is_missing(self):
        records = self.collector.build_evidence_records(
            [{
                "url": "https://signal.example/article",
                "title": "Fresh signal",
                "published_date": None,
                "query_family": "ai_pod_mockup_assets",
            }],
            {"results": [{
                "url": "https://signal.example/article",
                "raw_content": "Posted: 19 July 2026. Verified evidence.",
            }]},
            self.now,
        )

        self.assertEqual("2026-07-19T00:00:00+00:00", records[0]["publication_date"])
        self.assertEqual("content_marker", records[0]["date_type"])

    def test_rejects_unresolved_google_news_wrapper_as_evidence_url(self):
        self.assertFalse(
            self.collector.is_usable_evidence_url(
                "https://news.google.com/rss/articles/example?oc=5"
            )
        )
        self.assertTrue(
            self.collector.is_usable_evidence_url(
                "https://publisher.example/fresh-signal"
            )
        )

    def test_parses_google_news_rss_as_timestamped_candidates(self):
        payload = b"""<?xml version='1.0'?><rss><channel><item>
        <title>Fresh creator signal</title>
        <link>https://publisher.example/fresh-signal</link>
        <pubDate>Tue, 19 Jul 2026 08:00:00 GMT</pubDate>
        <source url='https://publisher.example'>Publisher</source>
        </item></channel></rss>"""

        candidates = self.collector.parse_google_news_rss(
            payload, "creator_research_automation"
        )

        self.assertEqual(1, len(candidates))
        self.assertEqual("creator_research_automation", candidates[0]["niche_id"])
        self.assertEqual("2026-07-19T08:00:00+00:00", candidates[0]["published_date"])
        self.assertEqual("google_news_rss", candidates[0]["source_kind"])

    def test_returns_ranked_fresh_verified_niches_with_build_paths(self):
        sources, extracts = self._build_rankable_sources(fresh=True)

        report = self.collector.build_report(
            sources, {"results": extracts}, self.now, unavailable_sources=[]
        )

        self.assertEqual("fresh_verified", report["status"])
        self.assertEqual(5, len(report["top_niches"]))
        self.assertTrue(all(item["signal_status"] == "fresh_verified" for item in report["top_niches"]))
        self.assertTrue(all(item["build_path"] for item in report["top_niches"]))
        self.assertIn("Top 5 niche MMO", self.collector.render_operator_brief(report))

    def test_returns_research_candidates_when_sources_have_no_verified_dates(self):
        sources, extracts = self._build_rankable_sources(fresh=False)
        for source in sources:
            source["published_date"] = None

        report = self.collector.build_report(
            sources, {"results": extracts}, self.now, unavailable_sources=[]
        )

        self.assertEqual("research_candidates", report["status"])
        self.assertEqual(5, len(report["top_niches"]))
        self.assertTrue(all(item["signal_status"] == "research_candidate" for item in report["top_niches"]))
        self.assertIn("không có ngày xuất bản kiểm chứng", self.collector.render_operator_brief(report))

    def test_returns_watchlist_when_evidence_is_recent_but_not_fresh(self):
        sources, extracts = self._build_rankable_sources(fresh=False)

        report = self.collector.build_report(
            sources, {"results": extracts}, self.now, unavailable_sources=[]
        )

        self.assertEqual("watchlist", report["status"])
        self.assertEqual(5, len(report["top_niches"]))
        self.assertTrue(all(item["signal_status"] == "watchlist" for item in report["top_niches"]))

    def _build_rankable_sources(self, *, fresh):
        source_date = "2026-07-19T00:00:00Z" if fresh else "2026-07-16T00:00:00Z"
        sources, extracts = [], []
        for profile in self.collector.NICHE_PROFILES:
            for evidence_index in range(2):
                domain = f"{profile['id']}-{evidence_index}.example"
                url = f"https://{domain}/signal"
                sources.append({
                    "url": url,
                    "title": f"{profile['title']} signal {evidence_index}",
                    "published_date": source_date,
                    "query_family": profile["id"],
                    "niche_id": profile["id"],
                })
                extracts.append({"url": url, "raw_content": "Verified market signal."})
        return sources, extracts


if __name__ == "__main__":
    unittest.main()

#!/usr/bin/env python3
"""Deterministic, read-only evidence collector for HerResearch MMO/POD briefs."""
from __future__ import annotations

import argparse
import json
import os
import re
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

API_BASE = "https://api.tavily.com"
MAX_SEARCHES, MAX_EXTRACT_URLS, MIN_URLS, MIN_DOMAINS = 4, 12, 8, 5
QUERY_FAMILIES = (
    ("community_pain", "US print on demand seller pain points AI mockups personalization last week"),
    ("buying_intent", "US personalized gift shirt hoodie AI design demand last week"),
    ("current_news", "AI creator economy print on demand ecommerce news last week"),
    ("competition", "US print on demand AI generated personalized product listings last week"),
)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def load_profile_env(profile_home: Path) -> None:
    env_file = profile_home / ".env"
    if not env_file.is_file():
        return
    for raw in env_file.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            if key and key not in os.environ:
                os.environ[key] = value


def domain_for(url: str) -> str:
    return (urlparse(url).hostname or "").lower().removeprefix("www.")


def parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.replace(tzinfo=parsed.tzinfo or timezone.utc).astimezone(timezone.utc)


def short_text(value: str, limit: int = 280) -> str:
    text = re.sub(r"\s+", " ", value).strip()
    return text[:limit].rstrip() + ("..." if len(text) > limit else "")


def build_evidence_records(candidates: list[dict[str, Any]], extract_payload: dict[str, Any], now: datetime) -> list[dict[str, Any]]:
    extracted = {item.get("url"): item for item in extract_payload.get("results", []) if isinstance(item, dict) and isinstance(item.get("url"), str) and isinstance(item.get("raw_content"), str) and item["raw_content"].strip()}
    records, seen = [], set()
    for candidate in candidates:
        url = candidate.get("url")
        item = extracted.get(url)
        if not isinstance(url, str) or not item or url in seen:
            continue
        seen.add(url)
        published = parse_datetime(candidate.get("published_date"))
        records.append({
            "url": url, "title": candidate.get("title") or domain_for(url),
            "publisher": candidate.get("publisher") or domain_for(url), "domain": domain_for(url),
            "query_family": candidate.get("query_family") or "unknown",
            "publication_date": published.isoformat() if published else None,
            "accessed_at": now.isoformat(), "date_type": "publication" if published else "access",
            "evidence_type": "extracted_full_page", "excerpt": short_text(item["raw_content"]),
        })
    return records


def build_report(candidates: list[dict[str, Any]], extract_payload: dict[str, Any], now: datetime, unavailable_sources: list[str]) -> dict[str, Any]:
    records = build_evidence_records(candidates, extract_payload, now)
    domains = {record["domain"] for record in records if record["domain"]}
    cutoff = now - timedelta(hours=24)
    fresh = sum(1 for record in records if (date := parse_datetime(record["publication_date"])) and date >= cutoff)
    passed = len(records) >= MIN_URLS and len(domains) >= MIN_DOMAINS and fresh >= 1
    return {
        "status": "evidence_collected" if passed else "insufficient_evidence",
        "report_date": now.date().isoformat(), "evidence_window": "24 hours; 7-day search fallback",
        "source_counts": {"total_urls": len(records), "independent_domains": len(domains), "fresh_publications_24h": fresh},
        "budget": {"search_calls_max": MAX_SEARCHES, "extract_urls_max": MAX_EXTRACT_URLS},
        "unavailable_sources": unavailable_sources, "source_ledger": records,
    }


def render_markdown(report: dict[str, Any]) -> str:
    counts = report["source_counts"]
    lines = ["# Báo cáo bằng chứng MMO/POD hằng ngày (HerResearch)", "", f"- Trạng thái: `{report['status']}`", f"- Ngày báo cáo (UTC): {report['report_date']}", f"- Cửa sổ bằng chứng: {report['evidence_window']}", f"- Nguồn đã trích xuất: {counts['total_urls']} URL / {counts['independent_domains']} domain độc lập", f"- Nguồn có ngày xuất bản trong 24 giờ: {counts['fresh_publications_24h']}", f"- Ngân sách: tối đa {report['budget']['search_calls_max']} search và {report['budget']['extract_urls_max']} URL extract", ""]
    if report["status"] == "evidence_collected":
        lines.extend(["## Kết luận", "", "Đã thu thập đủ nguồn trích xuất cho phân tích attended. Báo cáo này không tự khẳng định cơ hội, doanh thu, mức cạnh tranh hoặc tính hợp pháp.", ""])
    else:
        lines.extend(["## Kết luận fail-closed", "", "Chưa đạt ngưỡng 8 URL đã trích xuất, 5 domain độc lập và một nguồn có ngày xuất bản trong 24 giờ. Không đưa ra xếp hạng hay khuyến nghị hành động.", ""])
    lines.extend(["## Source ledger", ""])
    if not report["source_ledger"]:
        lines.append("Không có URL nào được Tavily extract thành công trong lượt này.")
    for index, source in enumerate(report["source_ledger"], 1):
        date = source["publication_date"] if source["date_type"] == "publication" else f"truy cập {source['accessed_at']}"
        lines.extend([f"{index}. [{source['title']}]({source['url']})", f"   - Nguồn: {source['publisher']} | Nhóm truy vấn: {source['query_family']}", f"   - Ngày: {date} | Loại evidence: trích xuất toàn trang", f"   - Quan sát: {source['excerpt']}"])
    if report["unavailable_sources"]:
        lines.extend(["", "## Nguồn không khả dụng", "", *[f"- {item}" for item in report["unavailable_sources"]]])
    return "\n".join(lines + ["", "Lưu ý: Chỉ đọc dữ liệu công khai; không đăng nhập, đăng bài, mua hàng, tạo tài khoản hay gọi API trả phí ngoài Tavily đã được cấu hình."]) + "\n"


class TavilyClient:
    def __init__(self, api_key: str): self.api_key = api_key
    def post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        request = Request(f"{API_BASE}{path}", data=json.dumps({"api_key": self.api_key, **payload}).encode(), headers={"Content-Type": "application/json"}, method="POST")
        try:
            with urlopen(request, timeout=30) as response: return json.loads(response.read().decode())
        except HTTPError as error: raise RuntimeError(f"Tavily HTTP {error.code}") from error
        except URLError as error: raise RuntimeError("Tavily network error") from error
    def search(self, query: str) -> dict[str, Any]: return self.post("/search", {"query": query, "topic": "general", "search_depth": "advanced", "max_results": 5, "days": 7, "include_answer": False, "include_raw_content": False})
    def extract(self, urls: list[str]) -> dict[str, Any]: return self.post("/extract", {"urls": urls, "extract_depth": "advanced"})


def collect_live_report(now: datetime) -> dict[str, Any]:
    profile = Path(os.environ.get("HERMES_HOME", "/opt/data/hermes-profiles/herresearch"))
    load_profile_env(profile)
    api_key = os.environ.get("TAVILY_API_KEY")
    if not api_key: return build_report([], {"results": []}, now, ["Tavily: TAVILY_API_KEY chưa được cấu hình"])
    client, candidates, unavailable = TavilyClient(api_key), [], []
    for family, query in QUERY_FAMILIES:
        try: payload = client.search(query)
        except RuntimeError as error:
            unavailable.append(f"Tavily search ({family}): {error}"); continue
        for item in payload.get("results", []):
            if isinstance(item, dict) and isinstance(item.get("url"), str): candidates.append({"url": item["url"], "title": item.get("title"), "published_date": item.get("published_date"), "query_family": family})
    urls, seen = [], set()
    for candidate in candidates:
        if candidate["url"] not in seen: seen.add(candidate["url"]); urls.append(candidate["url"])
        if len(urls) == MAX_EXTRACT_URLS: break
    try: extracts = client.extract(urls) if urls else {"results": []}
    except RuntimeError as error: unavailable.append(f"Tavily extract: {error}"); extracts = {"results": []}
    return build_report(candidates, extracts, now, unavailable)


def persist(profile: Path, report: dict[str, Any], markdown: str) -> None:
    directory = profile / "reports" / "mmo-trends"; directory.mkdir(parents=True, exist_ok=True)
    stamp = utc_now().strftime("%Y%m%dT%H%M%SZ")
    for suffix, content in ((".json", json.dumps(report, ensure_ascii=False, indent=2) + "\n"), (".md", markdown)):
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=directory, delete=False) as handle: handle.write(content); temp = handle.name
        os.replace(temp, directory / f"{stamp}{suffix}")


def main() -> int:
    parser = argparse.ArgumentParser(); parser.add_argument("--fixture", type=Path); parser.add_argument("--no-persist", action="store_true"); args = parser.parse_args(); now = utc_now()
    if args.fixture:
        fixture = json.loads(args.fixture.read_text(encoding="utf-8")); report = build_report(fixture.get("candidates", []), fixture.get("extract_payload", {"results": []}), now, fixture.get("unavailable_sources", []))
    else: report = collect_live_report(now)
    markdown = render_markdown(report)
    if not args.no_persist: persist(Path(os.environ.get("HERMES_HOME", "/opt/data/hermes-profiles/herresearch")), report, markdown)
    print(markdown, end=""); return 0


if __name__ == "__main__": raise SystemExit(main())

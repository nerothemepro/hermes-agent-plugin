#!/usr/bin/env python3
"""Deterministic, read-only MMO opportunity radar for HerResearch."""
from __future__ import annotations

import argparse
import json
import os
import re
import tempfile
import xml.etree.ElementTree as ElementTree
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen

API_BASE = "https://api.tavily.com"
MAX_SEARCHES = 5
MAX_RESULTS_PER_QUERY = 3
MAX_EXTRACT_URLS = 15
FRESH_HOURS = 72
WATCHLIST_DAYS = 14
MAX_TOP_NICHES = 5
GOOGLE_NEWS_BASE = "https://news.google.com/rss/search"

NICHE_PROFILES = (
    {
        "id": "ai_pod_mockup_assets",
        "title": "Bộ mockup AI cho POD và Etsy sellers",
        "audience": "POD seller, Etsy seller và studio thiết kế nhỏ tại Mỹ",
        "monetization": "Bán digital mockup pack, template bundle hoặc dịch vụ mockup theo niche.",
        "build_path": "ComfyUI tạo mockup nhất quán; SDTK đóng gói spec/delivery; Hermes xử lý brief và QA asset.",
        "risk": "Cần tránh logo, nhân vật và câu chữ có trademark; demand/competition chưa được đo bằng API keyword/SERP.",
        "next_action": "Kiểm tra read-only 20 listing Etsy/Amazon đầu tiên và xác định motif lặp lại trước khi dựng pack.",
        "query": "US AI print on demand mockup pack Etsy seller demand news last 14 days",
    },
    {
        "id": "personalized_gift_workflows",
        "title": "Quy trình quà tặng cá nhân hóa bằng AI",
        "audience": "Người bán quà tặng cá nhân hóa, pet portrait và family keepsake",
        "monetization": "Bán design bundle, dịch vụ personalisation hoặc template storefront theo mùa.",
        "build_path": "ComfyUI tạo key visual; LTX/WAN tạo showcase ngắn; Remotion dựng preview sản phẩm; SDTK chuẩn hóa handoff.",
        "risk": "Không dùng ảnh/người thật nếu không có quyền; cần kiểm tra kỹ policy marketplace và trademark.",
        "next_action": "So sánh read-only các listing mới và review để tìm pain point về turnaround, mockup hoặc personalisation.",
        "query": "US personalized gift AI ecommerce product demand seller pain last 14 days",
    },
    {
        "id": "vertical_video_asset_packs",
        "title": "Gói video ngắn theo ngành cho seller và local business",
        "audience": "Shopify seller, agency nhỏ và local business cần creative cho social ads",
        "monetization": "Bán template video, gói creative theo ngành hoặc dịch vụ sản xuất asset định kỳ.",
        "build_path": "LTX/WAN tạo motion asset; Remotion biến thành template nhiều biến thể; ComfyUI tạo keyframe/product scene; Hermes điều phối production brief.",
        "risk": "Không được hứa hiệu quả quảng cáo; phải dùng asset có quyền thương mại và xác nhận policy nền tảng.",
        "next_action": "Đọc read-only ad library/landing page công khai để chọn một vertical có creative lặp lại nhưng chất lượng yếu.",
        "query": "US ecommerce AI short form product video template creator demand last 14 days",
    },
    {
        "id": "website_hero_template_packs",
        "title": "Hero section và landing-page asset pack cho founder",
        "audience": "Indie founder, SaaS nhỏ và freelancer làm website",
        "monetization": "Bán HTML/template pack, hero asset bundle hoặc dịch vụ website launch kit.",
        "build_path": "SDTK tạo spec và delivery QA; ComfyUI tạo texture/background; LTX/WAN hoặc Remotion tạo motion preview; Hermes tổ chức review.",
        "risk": "Cần đo nhu cầu bằng search/marketplace sau này; không dùng claim conversion không có dữ liệu.",
        "next_action": "Quét read-only các marketplace template và trang launch để tìm category có visual debt rõ ràng.",
        "query": "AI website hero section template pack indie founder demand news last 14 days",
    },
    {
        "id": "creator_research_automation",
        "title": "Research-to-content workflow cho creator và solo operator",
        "audience": "Creator, consultant và founder phải theo dõi niche nhưng thiếu thời gian",
        "monetization": "Bán workflow template, setup service hoặc research brief subscription có người duyệt.",
        "build_path": "Hermes thu thập và điều phối; SDTK đóng gói workflow/spec; Remotion tạo demo; ComfyUI tạo thumbnail và visual explainer.",
        "risk": "Phải minh bạch nguồn và không biến report thành lời khuyên tài chính; cần consent cho dữ liệu riêng.",
        "next_action": "So sánh read-only các tool/workflow công khai để xác định bước nào đang thủ công và lặp lại nhiều nhất.",
        "query": "creator economy AI research automation workflow demand pain points last 14 days",
    },
)
PROFILE_BY_ID = {profile["id"]: profile for profile in NICHE_PROFILES}

CONTENT_DATE_PATTERNS = (
    re.compile(r"\b(?:published|posted|uploaded|date)\s*(?:on)?\s*[:\-]?\s*(?P<date>\d{4}-\d{1,2}-\d{1,2})", re.IGNORECASE),
    re.compile(r"\b(?:published|posted|uploaded|date)\s*(?:on)?\s*[:\-]?\s*(?P<date>\d{1,2}\s+[A-Za-z]{3,9}\s+20\d{2})", re.IGNORECASE),
    re.compile(r"\b(?:published|posted|uploaded|date)\s*(?:on)?\s*[:\-]?\s*(?P<date>[A-Za-z]{3,9}\s+\d{1,2},\s*20\d{2})", re.IGNORECASE),
)
DATE_FORMATS = ("%Y-%m-%d", "%d %b %Y", "%d %B %Y", "%b %d, %Y", "%B %d, %Y")


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


def parse_content_publication_date(content: str) -> datetime | None:
    for pattern in CONTENT_DATE_PATTERNS:
        match = pattern.search(content[:8000])
        if not match:
            continue
        token = match.group("date").strip().rstrip(".|")
        for date_format in DATE_FORMATS:
            try:
                return datetime.strptime(token, date_format).replace(tzinfo=timezone.utc)
            except ValueError:
                continue
    return None


def short_text(value: str, limit: int = 280) -> str:
    text = re.sub(r"\s+", " ", value).strip()
    return text[:limit].rstrip() + ("..." if len(text) > limit else "")


def iso_date(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def parse_google_news_rss(payload: bytes, niche_id: str) -> list[dict[str, Any]]:
    root = ElementTree.fromstring(payload)
    candidates: list[dict[str, Any]] = []
    for item in root.findall(".//item"):
        title = (item.findtext("title") or "").strip()
        url = (item.findtext("link") or "").strip()
        published_raw = (item.findtext("pubDate") or "").strip()
        if not title or not url or not published_raw:
            continue
        try:
            published = parsedate_to_datetime(published_raw).astimezone(timezone.utc)
        except (TypeError, ValueError):
            continue
        source = item.find("source")
        publisher = (source.text or "").strip() if source is not None else domain_for(url)
        candidates.append(
            {
                "url": url,
                "title": title,
                "publisher": publisher or domain_for(url),
                "published_date": published.isoformat(),
                "query_family": niche_id,
                "niche_id": niche_id,
                "source_kind": "google_news_rss",
            }
        )
    return candidates


def resolve_google_news_url(url: str) -> str:
    hostname = (urlparse(url).hostname or "").lower()
    if hostname not in {"news.google.com", "www.news.google.com"}:
        return url
    request = Request(url, headers={"User-Agent": "HerResearch-MMO-Radar/2.0"})
    with urlopen(request, timeout=15) as response:
        return response.geturl()


def fetch_google_news_candidates(profile: dict[str, str]) -> list[dict[str, Any]]:
    query = urlencode({"q": profile["query"], "hl": "en-US", "gl": "US", "ceid": "US:en"})
    request = Request(f"{GOOGLE_NEWS_BASE}?{query}", headers={"User-Agent": "HerResearch-MMO-Radar/2.0"})
    with urlopen(request, timeout=20) as response:
        candidates = parse_google_news_rss(response.read(), profile["id"])
    for candidate in candidates:
        candidate["url"] = resolve_google_news_url(candidate["url"])
    return candidates[:MAX_RESULTS_PER_QUERY]


def build_evidence_records(candidates: list[dict[str, Any]], extract_payload: dict[str, Any], now: datetime) -> list[dict[str, Any]]:
    extracted = {
        item.get("url"): item
        for item in extract_payload.get("results", [])
        if isinstance(item, dict)
        and isinstance(item.get("url"), str)
        and isinstance(item.get("raw_content"), str)
        and item["raw_content"].strip()
    }
    records, seen = [], set()
    for candidate in candidates:
        url = candidate.get("url")
        item = extracted.get(url)
        if not isinstance(url, str) or not item or url in seen:
            continue
        seen.add(url)
        published = parse_datetime(candidate.get("published_date"))
        date_type = "search_metadata" if published else "unknown"
        if not published:
            published = parse_content_publication_date(item["raw_content"])
            date_type = "content_marker" if published else "unknown"
        niche_id = candidate.get("niche_id") or candidate.get("query_family") or "unknown"
        records.append(
            {
                "url": url,
                "title": candidate.get("title") or domain_for(url),
                "publisher": candidate.get("publisher") or domain_for(url),
                "domain": domain_for(url),
                "query_family": candidate.get("query_family") or niche_id,
                "niche_id": niche_id,
                "source_kind": candidate.get("source_kind") or "tavily_search",
                "publication_date": iso_date(published),
                "accessed_at": now.isoformat(),
                "date_type": date_type,
                "evidence_type": "extracted_full_page",
                "excerpt": short_text(item["raw_content"]),
            }
        )
    return records


def record_date(record: dict[str, Any]) -> datetime | None:
    return parse_datetime(record.get("publication_date"))


def build_top_niches(records: list[dict[str, Any]], now: datetime) -> list[dict[str, Any]]:
    fresh_cutoff = now - timedelta(hours=FRESH_HOURS)
    watchlist_cutoff = now - timedelta(days=WATCHLIST_DAYS)
    ranked: list[dict[str, Any]] = []
    for profile in NICHE_PROFILES:
        niche_records = [record for record in records if record["niche_id"] == profile["id"]]
        by_domain: dict[str, dict[str, Any]] = {}
        for record in sorted(
            niche_records,
            key=lambda item: record_date(item) or datetime.min.replace(tzinfo=timezone.utc),
            reverse=True,
        ):
            by_domain.setdefault(record["domain"], record)
        supporting = list(by_domain.values())
        if len(supporting) < 2:
            continue
        dated = [record for record in supporting if (date := record_date(record)) and date >= watchlist_cutoff]
        fresh_sources = [record for record in dated if (date := record_date(record)) and date >= fresh_cutoff]
        if fresh_sources:
            signal_status = "fresh_verified"
        elif len(dated) >= 2:
            signal_status = "watchlist"
        else:
            signal_status = "research_candidate"
        score = (
            len(fresh_sources) * 100
            + len(dated) * 20
            + len(supporting) * 5
        )
        ranked.append(
            {
                "niche_id": profile["id"],
                "title": profile["title"],
                "signal_status": signal_status,
                "score": score,
                "audience": profile["audience"],
                "monetization": profile["monetization"],
                "build_path": profile["build_path"],
                "risk": profile["risk"],
                "next_action": profile["next_action"],
                "evidence": [
                    {
                        "title": record["title"],
                        "url": record["url"],
                        "domain": record["domain"],
                        "publication_date": record["publication_date"],
                    }
                    for record in supporting[:3]
                ],
                "evidence_summary": (
                    f"{len(supporting)} domain độc lập; {len(fresh_sources)} nguồn trong {FRESH_HOURS} giờ; "
                    f"{len(dated)} nguồn có ngày trong {WATCHLIST_DAYS} ngày."
                ),
            }
        )
    order = {"fresh_verified": 2, "watchlist": 1, "research_candidate": 0}
    ranked.sort(key=lambda item: (order[item["signal_status"]], item["score"], item["title"]), reverse=True)
    return ranked[:MAX_TOP_NICHES]


def build_report(candidates: list[dict[str, Any]], extract_payload: dict[str, Any], now: datetime, unavailable_sources: list[str]) -> dict[str, Any]:
    records = build_evidence_records(candidates, extract_payload, now)
    domains = {record["domain"] for record in records if record["domain"]}
    fresh_cutoff = now - timedelta(hours=FRESH_HOURS)
    watchlist_cutoff = now - timedelta(days=WATCHLIST_DAYS)
    fresh = sum(1 for record in records if (date := record_date(record)) and date >= fresh_cutoff)
    recent = sum(1 for record in records if (date := record_date(record)) and date >= watchlist_cutoff)
    top_niches = build_top_niches(records, now)
    if any(item["signal_status"] == "fresh_verified" for item in top_niches):
        status = "fresh_verified"
    elif any(item["signal_status"] == "watchlist" for item in top_niches):
        status = "watchlist"
    elif top_niches:
        status = "research_candidates"
    else:
        status = "insufficient_evidence"
    return {
        "schema_version": "herresearch.mmo-radar.v2",
        "status": status,
        "report_date": now.date().isoformat(),
        "evidence_window": {"fresh_hours": FRESH_HOURS, "watchlist_days": WATCHLIST_DAYS},
        "source_counts": {
            "total_urls": len(records),
            "independent_domains": len(domains),
            "fresh_publications_72h": fresh,
            "dated_publications_14d": recent,
        },
        "budget": {
            "tavily_search_calls_max": MAX_SEARCHES,
            "google_news_rss_queries_max": MAX_SEARCHES,
            "results_per_query_max": MAX_RESULTS_PER_QUERY,
            "extract_urls_max": MAX_EXTRACT_URLS,
        },
        "ranking_rules": {
            "fresh_verified": f"at least two independent domains within {WATCHLIST_DAYS} days and one source within {FRESH_HOURS} hours",
            "watchlist": f"at least two independent domains within {WATCHLIST_DAYS} days but no source within {FRESH_HOURS} hours",
            "research_candidate": "at least two independent extracted domains, but insufficient verified publication dates; not a trend claim",
        },
        "unavailable_sources": unavailable_sources,
        "top_niches": top_niches,
        "source_ledger": records,
    }


def render_operator_brief(report: dict[str, Any], artifacts: dict[str, str] | None = None) -> str:
    counts = report["source_counts"]
    status = report["status"]
    lines = ["# Radar MMO hằng ngày (HerResearch)", ""]
    if status == "fresh_verified":
        lines.extend(["Trạng thái: `fresh_verified` — có ít nhất một niche được xác thực bằng tín hiệu mới.", ""])
    elif status == "watchlist":
        lines.extend(["Trạng thái: `watchlist` — có niche đáng nghiên cứu, nhưng chưa có tín hiệu mới đủ mạnh để gọi là xu hướng nóng.", ""])
    elif status == "research_candidates":
        lines.extend(["Trạng thái: `research_candidates` — có chủ đề có ít nhất hai nguồn độc lập, nhưng không có ngày xuất bản kiểm chứng; đây không phải claim xu hướng.", ""])
    else:
        lines.extend(["Trạng thái: `insufficient_evidence` — chưa có niche nào đạt tối thiểu hai domain độc lập có ngày xuất bản kiểm chứng.", ""])
    lines.append(f"Bằng chứng: {counts['total_urls']} URL / {counts['independent_domains']} domain | mới trong {FRESH_HOURS}h: {counts['fresh_publications_72h']} | có ngày trong {WATCHLIST_DAYS}d: {counts['dated_publications_14d']}.")
    if report["top_niches"]:
        lines.extend(["", f"## Top {len(report['top_niches'])} niche MMO để tìm hiểu", ""])
        for index, niche in enumerate(report["top_niches"], 1):
            lines.extend(
                [
                    f"{index}. **{niche['title']}** — `{niche['signal_status']}`",
                    f"   - Tín hiệu: {niche['evidence_summary']}",
                    f"   - Kiếm tiền: {niche['monetization']}",
                    f"   - Build: {niche['build_path']}",
                    f"   - Next: {niche['next_action']}",
                    f"   - Rủi ro: {niche['risk']}",
                ]
            )
            for evidence in niche["evidence"][:2]:
                lines.append(f"   - Evidence: [{evidence['domain']}]({evidence['url']}) — {evidence['publication_date']}")
    else:
        lines.extend(["", "Không đưa ra Top 5 để tránh biến một nguồn đơn lẻ thành cơ hội. Lần tiếp theo sẽ tiếp tục tìm dữ liệu mới."])
    if report["unavailable_sources"]:
        lines.extend(["", "## Coverage gaps", *[f"- {item}" for item in report["unavailable_sources"]]])
    if artifacts:
        lines.extend(["", f"Full evidence ledger: `{artifacts['markdown']}`", f"Machine-readable evidence: `{artifacts['json']}`"])
    return "\n".join(lines) + "\n"


def render_markdown(report: dict[str, Any]) -> str:
    counts = report["source_counts"]
    lines = ["# HerResearch MMO Opportunity Radar Evidence", "", f"- Status: `{report['status']}`", f"- Report date (UTC): {report['report_date']}", f"- Sources: {counts['total_urls']} URLs / {counts['independent_domains']} domains", f"- Freshness: {counts['fresh_publications_72h']} source(s) in {FRESH_HOURS}h; {counts['dated_publications_14d']} dated source(s) in {WATCHLIST_DAYS}d", "", "## Ranked niches", ""]
    if report["top_niches"]:
        for index, niche in enumerate(report["top_niches"], 1):
            lines.extend([f"{index}. {niche['title']} — `{niche['signal_status']}`", f"   - Evidence: {niche['evidence_summary']}", f"   - Build path: {niche['build_path']}"])
    else:
        lines.append("No niche met the two-independent-domain gate.")
    lines.extend(["", "## Source ledger", ""])
    for index, source in enumerate(report["source_ledger"], 1):
        date = source["publication_date"] or "unverified publication date"
        lines.extend([f"{index}. [{source['title']}]({source['url']})", f"   - Niche: {source['niche_id']} | Domain: {source['domain']} | Source: {source['source_kind']} | Date: {date} ({source['date_type']})", f"   - Excerpt: {source['excerpt']}"])
    if report["unavailable_sources"]:
        lines.extend(["", "## Unavailable sources", *[f"- {item}" for item in report["unavailable_sources"]]])
    return "\n".join(lines) + "\n"


class TavilyClient:
    def __init__(self, api_key: str):
        self.api_key = api_key

    def post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        request = Request(
            f"{API_BASE}{path}",
            data=json.dumps({"api_key": self.api_key, **payload}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urlopen(request, timeout=30) as response:
                return json.loads(response.read().decode())
        except HTTPError as error:
            raise RuntimeError(f"Tavily HTTP {error.code}") from error
        except URLError as error:
            raise RuntimeError("Tavily network error") from error

    def search(self, query: str) -> dict[str, Any]:
        return self.post(
            "/search",
            {
                "query": query,
                "topic": "general",
                "search_depth": "advanced",
                "max_results": MAX_RESULTS_PER_QUERY,
                "days": WATCHLIST_DAYS,
                "include_answer": False,
                "include_raw_content": False,
            },
        )

    def extract(self, urls: list[str]) -> dict[str, Any]:
        return self.post("/extract", {"urls": urls, "extract_depth": "advanced"})


def collect_live_report(now: datetime) -> dict[str, Any]:
    profile = Path(os.environ.get("HERMES_HOME", "/opt/data/hermes-profiles/herresearch"))
    load_profile_env(profile)
    api_key = os.environ.get("TAVILY_API_KEY")
    if not api_key:
        return build_report([], {"results": []}, now, ["Tavily: TAVILY_API_KEY chưa được cấu hình"])
    client, candidates, unavailable = TavilyClient(api_key), [], []
    for profile_spec in NICHE_PROFILES:
        try:
            candidates.extend(fetch_google_news_candidates(profile_spec))
        except (ElementTree.ParseError, HTTPError, URLError, OSError) as error:
            unavailable.append(f"Google News RSS ({profile_spec['id']}): {type(error).__name__}")
        try:
            payload = client.search(profile_spec["query"])
        except RuntimeError as error:
            unavailable.append(f"Tavily search ({profile_spec['id']}): {error}")
            continue
        for item in payload.get("results", []):
            if isinstance(item, dict) and isinstance(item.get("url"), str):
                candidates.append(
                    {
                        "url": item["url"],
                        "title": item.get("title"),
                        "published_date": item.get("published_date"),
                        "query_family": profile_spec["id"],
                        "niche_id": profile_spec["id"],
                        "source_kind": "tavily_search",
                    }
                )
    candidates.sort(key=lambda item: (bool(item.get("published_date")), item.get("source_kind") == "google_news_rss"), reverse=True)
    urls, seen = [], set()
    for candidate in candidates:
        if candidate["url"] not in seen:
            seen.add(candidate["url"])
            urls.append(candidate["url"])
        if len(urls) == MAX_EXTRACT_URLS:
            break
    try:
        extracts = client.extract(urls) if urls else {"results": []}
    except RuntimeError as error:
        unavailable.append(f"Tavily extract: {error}")
        extracts = {"results": []}
    if not os.environ.get("REDDIT_CLIENT_ID") or not os.environ.get("REDDIT_CLIENT_SECRET"):
        unavailable.append("Reddit: app-only read credentials are not configured; this deterministic collector did not query Reddit.")
    return build_report(candidates, extracts, now, unavailable)


def persist(profile: Path, report: dict[str, Any]) -> dict[str, str]:
    directory = profile / "reports" / "mmo-trends"
    directory.mkdir(parents=True, exist_ok=True)
    stamp = utc_now().strftime("%Y%m%dT%H%M%SZ")
    paths = {"json": str(directory / f"{stamp}.json"), "markdown": str(directory / f"{stamp}.md")}
    contents = {
        paths["json"]: json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        paths["markdown"]: render_markdown(report),
    }
    for destination, content in contents.items():
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=directory, delete=False) as handle:
            handle.write(content)
            temporary = handle.name
        os.replace(temporary, destination)
    return paths


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixture", type=Path)
    parser.add_argument("--no-persist", action="store_true")
    args = parser.parse_args()
    now = utc_now()
    if args.fixture:
        fixture = json.loads(args.fixture.read_text(encoding="utf-8"))
        report = build_report(fixture.get("candidates", []), fixture.get("extract_payload", {"results": []}), now, fixture.get("unavailable_sources", []))
    else:
        report = collect_live_report(now)
    artifacts = None if args.no_persist else persist(Path(os.environ.get("HERMES_HOME", "/opt/data/hermes-profiles/herresearch")), report)
    print(render_operator_brief(report, artifacts), end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Deterministic, read-only hotel availability workflow.

The command bypasses LLM routing. It validates input before opening a browser,
runs each site once with bounded timeouts, and fails closed when a site drops
the requested criteria.
"""

from __future__ import annotations

import json
import os
import re
import select
import subprocess
import time
import unicodedata
from dataclasses import asdict, dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlencode


JALAN_CLI = Path(os.getenv("JAPAN_HOTEL_JALAN_CLI", "/workspace/jalan-room-search-tool/bin/jalan-room-search"))
MCP_SERVER = Path(os.getenv("JAPAN_HOTEL_MCP_SERVER", "/workspace/hermes-agent-plugin/scripts/playwright_mcp_server.sh"))
REPORT_ROOT = Path(os.getenv("JAPAN_HOTEL_REPORT_ROOT", "/opt/data/hermes-profiles/herresearch/reports/japan-hotel-research"))
SITE_TIMEOUT_SECONDS = 75
BLOCK_MARKERS = ("captcha", "verify you are human", "access denied", "robot check", "ログインしてください")


class RequestValidationError(ValueError):
    pass


@dataclass(frozen=True)
class HotelRequest:
    area: str
    checkin: str
    checkout: str
    adults: int
    children_ages: list[int]
    rooms: int
    max_results_per_site: int = 3


def _fold(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    return "".join(ch for ch in normalized if not unicodedata.combining(ch)).lower().strip()


def _clean_value(value: str) -> str:
    return value.strip().rstrip("。.;")


def _match_label(line: str, labels: tuple[str, ...]) -> str | None:
    folded = _fold(line)
    for label in labels:
        escaped = re.escape(_fold(label))
        match = re.match(rf"^\s*{escaped}\s*:?[ \t]*(.+?)\s*$", folded)
        if match:
            original_match = re.match(
                rf"^\s*{re.escape(label)}\s*:?[ \t]*(.+?)\s*$",
                line,
                flags=re.IGNORECASE,
            )
            if original_match:
                return _clean_value(original_match.group(1))
            split = re.split(r":|\s+", line, maxsplit=1)
            return _clean_value(split[-1])
    return None


def _extract_field(lines: list[str], labels: tuple[str, ...], required_name: str) -> str:
    for line in lines:
        value = _match_label(line, labels)
        if value is not None and value:
            return value
    raise RequestValidationError(f"Thiếu trường {required_name}.")


def _positive_int(value: str, field_name: str) -> int:
    match = re.search(r"\d+", value)
    if not match:
        raise RequestValidationError(f"{field_name} phải là số nguyên dương.")
    number = int(match.group(0))
    if number < 1:
        raise RequestValidationError(f"{field_name} phải lớn hơn 0.")
    return number


def _parse_children(value: str) -> list[int]:
    folded = _fold(value)
    if folded in {"0", "khong", "none", "no", "khong co"}:
        return []
    ages = [int(item) for item in re.findall(r"(\d+(?:\.\d+)?)\s*(?:tuoi|years?|y\b)", folded)]
    if not ages:
        raise RequestValidationError(
            "Trẻ em phải ghi rõ từng tuổi, ví dụ: '2 tuổi + 9 tuổi'; "
            "không chỉ ghi số lượng."
        )
    if any(age < 0 or age > 17 for age in ages):
        raise RequestValidationError("Tuổi trẻ em phải nằm trong khoảng 0-17.")
    return ages


def parse_request(raw_args: str, *, today: date | None = None) -> HotelRequest:
    if not raw_args or not raw_args.strip():
        raise RequestValidationError("Chưa có tiêu chí tìm kiếm.")

    lines = [line.strip() for line in raw_args.splitlines() if line.strip()]
    area = _extract_field(lines, ("Khu vực", "Area", "Location"), "Khu vực")
    checkin = _extract_field(lines, ("Checkin", "Check-in"), "Checkin")
    checkout = _extract_field(lines, ("Checkout", "Check-out"), "Checkout")
    adults_raw = _extract_field(lines, ("Người lớn", "Adults"), "Người lớn")
    children_raw = _extract_field(lines, ("Trẻ em", "Children"), "Trẻ em")
    rooms_raw = _extract_field(lines, ("Số phòng", "Rooms"), "Số phòng")

    try:
        checkin_date = date.fromisoformat(checkin)
        checkout_date = date.fromisoformat(checkout)
    except ValueError as exc:
        raise RequestValidationError("Checkin/Checkout phải theo định dạng YYYY-MM-DD.") from exc
    if checkout_date <= checkin_date:
        raise RequestValidationError("Ngày checkout phải sau ngày check-in.")
    if checkin_date < (today or date.today()):
        raise RequestValidationError("Ngày check-in không được nằm trong quá khứ.")

    max_results = 3
    for line in lines:
        value = _match_label(line, ("Tối đa", "Max results", "Max"))
        if value:
            max_results = min(_positive_int(value, "Tối đa kết quả"), 5)
            break

    return HotelRequest(
        area=area,
        checkin=checkin,
        checkout=checkout,
        adults=_positive_int(adults_raw, "Người lớn"),
        children_ages=_parse_children(children_raw),
        rooms=_positive_int(rooms_raw, "Số phòng"),
        max_results_per_site=max_results,
    )


def format_usage() -> str:
    return (
        "Cú pháp:\n"
        "/japan-hotel-research kiểm tra phòng trống theo thông tin sau:\n"
        "Khu vực: Tateyama, Chiba, Nhật Bản\n"
        "Checkin: 2026-08-15\n"
        "Checkout: 2026-08-16\n"
        "Người lớn: 2\n"
        "Trẻ em: 2 tuổi + 9 tuổi\n"
        "Số phòng: 1"
    )


def build_report_skeleton() -> dict[str, Any]:
    return {
        "status": "running",
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "sites": {},
        "warnings": [],
        "errors": [],
    }


def _extract_result_text(result: dict[str, Any]) -> str:
    return "\n".join(
        item.get("text", "")
        for item in result.get("content", [])
        if isinstance(item, dict) and item.get("type") == "text"
    )


def _page_url(snapshot: str) -> str:
    match = re.search(r"^- Page URL:\s*(\S+)", snapshot, re.MULTILINE)
    return match.group(1) if match else ""


def _contains_block_marker(text: str) -> bool:
    folded = _fold(text)
    return any(marker in folded for marker in BLOCK_MARKERS)


def _normalize_japan_location(area: str) -> list[str]:
    country_aliases = {"nhat ban", "japan", "jp"}
    parts = [_clean_value(part) for part in area.split(",") if _clean_value(part)]
    normalized = ["Japan" if _fold(part) in country_aliases else part for part in parts]
    if not normalized or _fold(normalized[-1]) != "japan":
        normalized.append("Japan")
    return normalized


def _ref_for_line(snapshot: str, required: tuple[str, ...]) -> str | None:
    for line in snapshot.splitlines():
        folded = _fold(line)
        if all(_fold(item) in folded for item in required):
            match = re.search(r"\[ref=([^\]]+)\]", line)
            if match:
                return match.group(1)
    return None


def _safe_subprocess_env() -> dict[str, str]:
    allowed = {
        "HOME",
        "LANG",
        "LC_ALL",
        "NODE_PATH",
        "NPM_CONFIG_CACHE",
        "PATH",
        "PLAYWRIGHT_BROWSERS_PATH",
        "TMPDIR",
    }
    return {key: value for key, value in os.environ.items() if key in allowed}


def _ref_near_section(snapshot: str, section: str, required: tuple[str, ...], radius: int = 14) -> str | None:
    lines = snapshot.splitlines()
    section_folded = _fold(section)
    for index, line in enumerate(lines):
        folded = _fold(line)
        if section_folded not in folded or not re.search(rf":\s*{re.escape(section)}(?:\s|$)", line, re.IGNORECASE):
            continue
        for candidate in lines[index : min(len(lines), index + radius)]:
            candidate_folded = _fold(candidate)
            if all(_fold(item) in candidate_folded for item in required):
                match = re.search(r"\[ref=([^\]]+)\]", candidate)
                if match:
                    return match.group(1)
    return None


def _stepper_ref(snapshot: str, category: str, increase: bool) -> str | None:
    lines = snapshot.splitlines()
    for index, line in enumerate(lines):
        if not re.search(rf":\s*{re.escape(category)}(?:\s|$)", line, re.IGNORECASE):
            continue
        refs: list[str] = []
        for candidate in lines[index + 1 : min(len(lines), index + 14)]:
            if re.search(r":\s*(Adults|Children|Rooms)(?:\s|$)", candidate, re.IGNORECASE):
                break
            if "button" not in candidate:
                continue
            match = re.search(r"\[ref=([^\]]+)\]", candidate)
            if match:
                refs.append(match.group(1))
        if len(refs) >= 2:
            return refs[-1] if increase else refs[0]
    return None


def _refs_for_lines(snapshot: str, required: tuple[str, ...]) -> list[str]:
    refs: list[str] = []
    for line in snapshot.splitlines():
        folded = _fold(line)
        if all(_fold(item) in folded for item in required):
            match = re.search(r"\[ref=([^\]]+)\]", line)
            if match and match.group(1) not in refs:
                refs.append(match.group(1))
    return refs


class McpClient:
    def __init__(self, stderr_path: Path, lifetime_seconds: int = 110):
        self.deadline = time.monotonic() + lifetime_seconds
        self.stderr_handle = stderr_path.open("w", encoding="utf-8")
        self.proc = subprocess.Popen(
            [str(MCP_SERVER)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=self.stderr_handle,
            text=True,
            bufsize=1,
            env=_safe_subprocess_env(),
        )
        self.next_id = 1
        self.request(
            "initialize",
            {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "japan-hotel-research", "version": "0.1.0"},
            },
            timeout=30,
        )
        self.notify("notifications/initialized", {})

    def notify(self, method: str, params: dict[str, Any]) -> None:
        assert self.proc.stdin is not None
        self.proc.stdin.write(json.dumps({"jsonrpc": "2.0", "method": method, "params": params}, separators=(",", ":")) + "\n")
        self.proc.stdin.flush()

    def request(self, method: str, params: dict[str, Any], timeout: int = SITE_TIMEOUT_SECONDS) -> dict[str, Any]:
        assert self.proc.stdin is not None and self.proc.stdout is not None
        request_id = self.next_id
        self.next_id += 1
        payload = {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params}
        self.proc.stdin.write(json.dumps(payload, separators=(",", ":")) + "\n")
        self.proc.stdin.flush()
        deadline = min(time.monotonic() + timeout, self.deadline)
        while time.monotonic() < deadline:
            remaining = max(0.1, min(1.0, deadline - time.monotonic()))
            ready, _, _ = select.select([self.proc.stdout], [], [], remaining)
            if not ready:
                if self.proc.poll() is not None:
                    raise RuntimeError(f"Playwright MCP exited rc={self.proc.returncode}")
                continue
            line = self.proc.stdout.readline()
            if not line:
                raise RuntimeError("Playwright MCP closed stdout")
            message = json.loads(line)
            if message.get("id") != request_id:
                continue
            if "error" in message:
                raise RuntimeError(json.dumps(message["error"], ensure_ascii=False))
            return message.get("result", {})
        raise TimeoutError(f"MCP timeout: {method}")

    def tool(self, name: str, arguments: dict[str, Any], timeout: int = SITE_TIMEOUT_SECONDS) -> str:
        result = self.request("tools/call", {"name": name, "arguments": arguments}, timeout)
        return _extract_result_text(result)

    def snapshot(self) -> str:
        return self.tool("browser_snapshot", {}, timeout=60)

    def close(self) -> None:
        try:
            self.tool("browser_close", {}, timeout=10)
        except Exception:
            pass
        if self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.proc.kill()
                self.proc.wait(timeout=5)
        self.stderr_handle.close()

    def __enter__(self) -> "McpClient":
        return self

    def __exit__(self, *_: Any) -> None:
        self.close()


def run_jalan(request: HotelRequest, artifact_dir: Path) -> dict[str, Any]:
    query = {
        "area": request.area,
        "checkin": request.checkin,
        "checkout": request.checkout,
        "adults": request.adults,
        "children_ages": request.children_ages,
        "rooms": request.rooms,
        "max_results": request.max_results_per_site,
        "headless": True,
        "timeout_seconds": 60,
        "artifact_dir": str(artifact_dir / "jalan"),
    }
    if not JALAN_CLI.is_file():
        return {"status": "blocked", "results": [], "warnings": [], "errors": [f"Thiếu Jalan CLI: {JALAN_CLI}"]}
    try:
        completed = subprocess.run(
            [str(JALAN_CLI), "--input", json.dumps(query, ensure_ascii=False)],
            capture_output=True,
            text=True,
            timeout=90,
            check=False,
            env=_safe_subprocess_env(),
        )
        payload = json.loads(completed.stdout)
    except subprocess.TimeoutExpired:
        return {"status": "blocked", "results": [], "warnings": ["Jalan timeout sau 90 giây."], "errors": []}
    except Exception as exc:
        return {"status": "error", "results": [], "warnings": [], "errors": [f"Jalan output không hợp lệ: {exc}"]}

    results = []
    for row in payload.get("results", [])[: request.max_results_per_site]:
        results.append(
            {
                "name": row.get("hotel_name") or row.get("room_or_plan_title") or "Không rõ tên",
                "price": row.get("price_text") or (f"¥{row.get('price_jpy'):,}" if isinstance(row.get("price_jpy"), int) else ""),
                "url": row.get("url") or row.get("detail_url") or payload.get("final_url", ""),
                "availability": row.get("availability") or row.get("remaining_rooms") or "",
            }
        )
    return {
        "status": payload.get("status", "error"),
        "results": results,
        "warnings": payload.get("warnings", []),
        "errors": payload.get("errors", []),
        "final_url": payload.get("final_url", ""),
        "raw_result_count": payload.get("result_count", len(results)),
    }


def _parse_airbnb_results(snapshot: str, max_results: int) -> list[dict[str, str]]:
    lines = snapshot.splitlines()
    results: list[dict[str, str]] = []
    seen: set[str] = set()
    for index, line in enumerate(lines):
        match = re.search(r"/url:\s*(/rooms/[^\s\"]+)", line)
        if not match:
            continue
        relative = match.group(1)
        room_id = relative.split("?", 1)[0]
        if room_id in seen:
            continue
        seen.add(room_id)
        block = "\n".join(lines[index : min(len(lines), index + 48)])
        values = []
        for candidate in block.splitlines():
            value_match = re.search(r":\s*([^:\n][^\n]*)$", candidate)
            if value_match:
                value = value_match.group(1).strip().strip('"')
                if value and not value.startswith("/rooms/") and value not in values:
                    values.append(value)
        name = next((value for value in values if len(value) > 12 and "JPY" not in value and "レビュー" not in value), "Airbnb listing")
        price = next((value for value in values if "JPY" in value), "")
        availability = next((value for value in values if "予約可能" in value or "残り" in value), "")
        results.append(
            {
                "name": name,
                "price": price,
                "availability": availability,
                "url": "https://www.airbnb.jp" + relative,
            }
        )
        if len(results) >= max_results:
            break
    return results


def run_airbnb(request: HotelRequest, artifact_dir: Path) -> dict[str, Any]:
    location_parts = _normalize_japan_location(request.area)
    location_slug = "--".join(part.replace(" ", "-") for part in location_parts)
    query = urlencode(
        {
            "refinement_paths[]": "/homes",
            "date_picker_type": "calendar",
            "checkin": request.checkin,
            "checkout": request.checkout,
            "adults": request.adults,
            "children": len(request.children_ages),
        }
    )
    url = f"https://www.airbnb.jp/s/{quote(location_slug, safe='-')}/homes?{query}"
    stderr_path = artifact_dir / "airbnb-mcp.stderr"
    try:
        with McpClient(stderr_path) as client:
            client.tool("browser_navigate", {"url": url}, timeout=90)
            client.tool("browser_wait_for", {"time": 5}, timeout=15)
            snapshot = client.snapshot()
    except Exception as exc:
        return {"status": "blocked", "results": [], "warnings": [f"Airbnb không truy cập được: {exc}"], "errors": []}

    (artifact_dir / "airbnb-snapshot.txt").write_text(snapshot, encoding="utf-8")
    final_url = _page_url(snapshot)
    required = (
        f"checkin={request.checkin}",
        f"checkout={request.checkout}",
        f"adults={request.adults}",
        f"children={len(request.children_ages)}",
    )
    if _contains_block_marker(snapshot):
        return {"status": "blocked", "results": [], "warnings": ["Airbnb hiển thị CAPTCHA/login/block."], "errors": [], "final_url": final_url}
    if not final_url or not all(item in final_url for item in required):
        return {"status": "blocked", "results": [], "warnings": ["Airbnb không giữ đầy đủ ngày hoặc số khách trong URL kết quả."], "errors": [], "final_url": final_url}
    location_evidence = " ".join(location_parts[:-1]).lower()
    generic_map_result = "地図上のエリア内" in snapshot
    if generic_map_result or any(token.lower() not in snapshot.lower() for token in location_parts[:2]):
        return {
            "status": "blocked",
            "results": [],
            "warnings": [f"Airbnb không chứng minh được location đã geocode đúng ({location_evidence}); không dùng inventory ngoài khu vực."],
            "errors": [],
            "final_url": final_url,
        }
    results = _parse_airbnb_results(snapshot, request.max_results_per_site)
    return {
        "status": "completed" if results else "no_results",
        "results": results,
        "warnings": [] if results else ["Không trích được listing phù hợp từ snapshot."],
        "errors": [],
        "final_url": final_url,
    }


def _booking_date_label(iso_value: str) -> str:
    parsed = date.fromisoformat(iso_value)
    return parsed.strftime("%A, %B %-d, %Y")


def _booking_selected_date_text(request: HotelRequest) -> str:
    checkin = date.fromisoformat(request.checkin).strftime("%a, %b %-d")
    checkout = date.fromisoformat(request.checkout).strftime("%a, %b %-d")
    return f"{checkin} — {checkout}"


def _booking_extract_results(snapshot: str, max_results: int) -> list[dict[str, str]]:
    lines = snapshot.splitlines()
    results: list[dict[str, str]] = []
    seen: set[str] = set()
    for index, line in enumerate(lines):
        match = re.search(r"/url:\s*(https://www\.booking\.com/hotel/jp/[^\s\"]+)", line)
        if not match:
            continue
        url = match.group(1)
        base = url.split("?", 1)[0]
        if base in seen:
            continue
        seen.add(base)
        block = "\n".join(lines[index : min(len(lines), index + 40)])
        heading = re.search(r'heading "([^"]+)"', block)
        price = re.search(r"(?:US\$|¥|JPY)\s?[\d,]+", block)
        results.append(
            {
                "name": heading.group(1) if heading else "Booking.com property",
                "price": price.group(0) if price else "",
                "url": url,
                "availability": "",
            }
        )
        if len(results) >= max_results:
            break
    return results


def _booking_click_ref(client: McpClient, snapshot: str, required: tuple[str, ...], label: str) -> str:
    ref = _ref_for_line(snapshot, required)
    if not ref:
        raise RuntimeError(f"Không tìm thấy {label}.")
    client.tool("browser_click", {"target": ref, "element": label}, timeout=30)
    return ref


def run_booking(request: HotelRequest, artifact_dir: Path) -> dict[str, Any]:
    stderr_path = artifact_dir / "booking-mcp.stderr"
    snapshot = ""
    try:
        with McpClient(stderr_path) as client:
            client.tool("browser_navigate", {"url": "https://www.booking.com/searchresults.html"}, timeout=90)
            client.tool("browser_wait_for", {"time": 3}, timeout=15)
            snapshot = client.snapshot()
            if _contains_block_marker(snapshot):
                raise RuntimeError("Booking.com hiển thị CAPTCHA/login/block.")

            destination_ref = _ref_for_line(snapshot, ("combobox", "enter destination"))
            if not destination_ref:
                raise RuntimeError("Không tìm thấy ô Enter destination.")
            client.tool(
                "browser_type",
                {"target": destination_ref, "element": "Enter destination", "text": request.area, "slowly": True},
                timeout=30,
            )
            client.tool("browser_wait_for", {"time": 2}, timeout=10)
            snapshot = client.snapshot()
            option_ref = _ref_for_line(snapshot, ("option", _fold(request.area.split(",")[0])))
            if not option_ref:
                option_refs = _refs_for_lines(snapshot, ("option",))
                option_ref = option_refs[0] if option_refs else None
            if not option_ref:
                raise RuntimeError("Booking.com không trả destination suggestion.")
            client.tool("browser_click", {"target": option_ref, "element": "Destination suggestion"}, timeout=30)

            snapshot = client.snapshot()
            _booking_click_ref(client, snapshot, ("button", "select dates"), "date picker")
            snapshot = client.snapshot()
            for iso_value in (request.checkin, request.checkout):
                label = _booking_date_label(iso_value)
                ref = _ref_for_line(snapshot, ("checkbox", label))
                next_clicks = 0
                while not ref and next_clicks < 18:
                    next_ref = _ref_for_line(snapshot, ("button", "next month"))
                    if not next_ref:
                        break
                    client.tool("browser_click", {"target": next_ref, "element": "Next month"}, timeout=20)
                    snapshot = client.snapshot()
                    ref = _ref_for_line(snapshot, ("checkbox", label))
                    next_clicks += 1
                if not ref:
                    raise RuntimeError(f"Không tìm thấy ngày {iso_value} trong date picker.")
                client.tool("browser_click", {"target": ref, "element": label}, timeout=30)
                snapshot = client.snapshot()

            occupancy_ref = _ref_for_line(snapshot, ("button", "number of travelers and rooms"))
            if not occupancy_ref:
                raise RuntimeError("Không tìm thấy occupancy selector.")
            client.tool("browser_click", {"target": occupancy_ref, "element": "Occupancy selector"}, timeout=30)
            snapshot = client.snapshot()

            deltas = {
                "Adults": request.adults - 2,
                "Children": len(request.children_ages),
                "Rooms": request.rooms - 1,
            }
            for category, delta in deltas.items():
                direction = "Increase" if delta >= 0 else "Decrease"
                for _ in range(abs(delta)):
                    ref = _ref_for_line(snapshot, ("button", direction, category))
                    if not ref:
                        ref = _ref_near_section(snapshot, category, ("button", direction))
                    if not ref:
                        ref = _stepper_ref(snapshot, category, increase=delta > 0)
                    if not ref:
                        raise RuntimeError(f"Không tìm thấy nút {direction} {category}.")
                    client.tool("browser_click", {"target": ref, "element": f"{direction} {category}"}, timeout=20)
                    snapshot = client.snapshot()

            age_refs = _refs_for_lines(snapshot, ("combobox", "age"))
            if request.children_ages and len(age_refs) < len(request.children_ages):
                raise RuntimeError("Booking.com không hiển thị đủ ô tuổi trẻ em.")
            for ref, age in zip(age_refs, request.children_ages):
                client.tool(
                    "browser_select_option",
                    {"target": ref, "element": "Child age", "values": [str(age)]},
                    timeout=20,
                )
                snapshot = client.snapshot()

            done_ref = _ref_for_line(snapshot, ("button", "done"))
            if done_ref:
                client.tool("browser_click", {"target": done_ref, "element": "Occupancy done"}, timeout=20)
                snapshot = client.snapshot()

            pre_submit = snapshot
            search_ref = _ref_for_line(pre_submit, ("button", "search"))
            if not search_ref:
                raise RuntimeError("Không tìm thấy nút Search.")
            client.tool("browser_click", {"target": search_ref, "element": "Search"}, timeout=45)
            client.tool("browser_wait_for", {"time": 5}, timeout=15)
            final_snapshot = client.snapshot()
    except Exception as exc:
        if snapshot:
            last_snapshot = artifact_dir / "booking-last-snapshot.txt"
            last_snapshot.write_text(snapshot, encoding="utf-8")
            os.chmod(last_snapshot, 0o600)
        return {"status": "blocked", "results": [], "warnings": [f"Booking.com dừng an toàn: {exc}"], "errors": []}

    (artifact_dir / "booking-pre-submit.txt").write_text(pre_submit, encoding="utf-8")
    (artifact_dir / "booking-final-snapshot.txt").write_text(final_snapshot, encoding="utf-8")
    final_url = _page_url(final_snapshot)
    selected_dates = _booking_selected_date_text(request)
    selected_occupancy = (
        f"{request.adults} adults · {len(request.children_ages)} children · "
        f"{request.rooms} {'room' if request.rooms == 1 else 'rooms'}"
    )
    criteria_retained = (
        request.area.split(",")[0].lower() in final_snapshot.lower()
        and selected_dates in final_snapshot
        and selected_occupancy in final_snapshot
    )
    if _contains_block_marker(final_snapshot):
        return {"status": "blocked", "results": [], "warnings": ["Booking.com hiển thị CAPTCHA/login/block."], "errors": [], "final_url": final_url}
    if not criteria_retained:
        return {
            "status": "blocked",
            "results": [],
            "warnings": ["Booking.com reset hoặc không chứng minh được đầy đủ khu vực, ngày và số khách sau submit; bỏ qua giá landing page."],
            "errors": [],
            "final_url": final_url,
        }
    results = _booking_extract_results(final_snapshot, request.max_results_per_site)
    return {
        "status": "completed" if results else "no_results",
        "results": results,
        "warnings": [] if results else ["Không tìm thấy property card phù hợp trong kết quả đã xác minh tiêu chí."],
        "errors": [],
        "final_url": final_url,
    }


def _overall_status(sites: dict[str, dict[str, Any]]) -> str:
    statuses = {site.get("status") for site in sites.values()}
    if statuses <= {"completed", "no_results"}:
        return "completed"
    if "completed" in statuses or "no_results" in statuses:
        return "partial"
    return "error"


def format_vietnamese_report(request: HotelRequest, report: dict[str, Any]) -> str:
    site_labels = {"jalan": "Jalan.net", "airbnb": "Airbnb Japan", "booking": "Booking.com"}
    lines = [
        "Kết quả kiểm tra phòng Nhật Bản",
        f"status: {report.get('status', 'error')}",
        (
            f"Tiêu chí: {request.area} | {request.checkin} -> {request.checkout} | "
            f"{request.adults} người lớn | trẻ em {request.children_ages or 'không'} | "
            f"{request.rooms} phòng"
        ),
        "",
    ]
    for key in ("jalan", "airbnb", "booking"):
        site = report.get("sites", {}).get(key, {})
        lines.append(f"{site_labels[key]}: {site.get('status', 'error')}")
        for index, item in enumerate(site.get("results", [])[: request.max_results_per_site], start=1):
            details = " | ".join(part for part in (item.get("name", ""), item.get("price", ""), item.get("availability", "")) if part)
            lines.append(f"{index}. {details}")
            if item.get("url"):
                lines.append(item["url"])
        for warning in site.get("warnings", []):
            lines.append(f"- Cảnh báo: {warning}")
        for error in site.get("errors", []):
            lines.append(f"- Lỗi: {error}")
        lines.append("")
    lines.extend(
        [
            f"Evidence JSON: {report.get('artifact_path', '')}",
            "Chỉ kiểm tra read-only; không đăng nhập, không đặt phòng và không thanh toán.",
            "Giá/phòng trống có thể thay đổi, hãy xác nhận lại trên website trước khi quyết định.",
        ]
    )
    return "\n".join(lines).strip()


def run_workflow(request: HotelRequest) -> str:
    REPORT_ROOT.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    artifact_dir = REPORT_ROOT / stamp
    artifact_dir.mkdir(mode=0o700)
    report = build_report_skeleton()
    report["request"] = asdict(request)

    runners = (
        ("jalan", run_jalan),
        ("airbnb", run_airbnb),
        ("booking", run_booking),
    )
    for site_name, runner in runners:
        try:
            report["sites"][site_name] = runner(request, artifact_dir)
        except Exception as exc:
            report["sites"][site_name] = {
                "status": "error",
                "results": [],
                "warnings": [],
                "errors": [f"{type(exc).__name__}: {exc}"],
            }

    report["status"] = _overall_status(report["sites"])
    report["completed_at"] = datetime.now(timezone.utc).isoformat()
    report_path = artifact_dir / "report.json"
    report["artifact_path"] = str(report_path)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    os.chmod(report_path, 0o600)
    return format_vietnamese_report(request, report)

"""Deterministic Telegram command for Japan hotel availability research."""

from __future__ import annotations

import asyncio

from .workflow import RequestValidationError, format_usage, parse_request, run_workflow


async def handle_japan_hotel_research(raw_args: str) -> str:
    try:
        request = parse_request(raw_args)
    except RequestValidationError as exc:
        return f"Yêu cầu chưa hợp lệ: {exc}\n\n{format_usage()}"

    try:
        return await asyncio.wait_for(
            asyncio.to_thread(run_workflow, request),
            timeout=330,
        )
    except asyncio.TimeoutError:
        return (
            "status: error\n"
            "Workflow hết thời gian sau 330 giây. Không có thao tác đặt phòng, "
            "đăng nhập hoặc thanh toán nào được thực hiện."
        )
    except Exception as exc:
        return (
            "status: error\n"
            f"Workflow dừng an toàn: {type(exc).__name__}: {exc}\n"
            "Không có thao tác đặt phòng, đăng nhập hoặc thanh toán nào được thực hiện."
        )


def register(ctx) -> None:
    ctx.register_command(
        "japan-hotel-research",
        handler=handle_japan_hotel_research,
        description="Kiểm tra phòng Nhật theo khu vực, ngày và số khách (read-only)",
    )

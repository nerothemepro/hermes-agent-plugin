#!/usr/bin/env python3
"""Patch Hermes gateway MEDIA auto-append behavior."""
from __future__ import annotations

from pathlib import Path
import sys

DEFAULT_GATEWAY = Path('/workspace/hermes-agent/gateway/run.py')

OLD = """            if "MEDIA:" not in final_response:
                media_tags, has_voice_directive = _collect_auto_append_media_tags(
                    result.get("messages", []),
                    history_offset=len(agent_history),
                    history_media_paths=_history_media_paths,
                )

                if media_tags:
                    seen = set()
                    unique_tags = []
                    for tag in media_tags:
                        if tag not in seen:
                            seen.add(tag)
                            unique_tags.append(tag)
                    if has_voice_directive:
                        unique_tags.insert(0, "[[audio_as_voice]]")
                    final_response = final_response + "\\n" + "\\n".join(unique_tags)
"""

NEW = """            media_tags, has_voice_directive = _collect_auto_append_media_tags(
                result.get("messages", []),
                history_offset=len(agent_history),
                history_media_paths=_history_media_paths,
            )

            if media_tags:
                seen = set()
                unique_tags = []
                for tag in media_tags:
                    if tag not in seen and tag not in final_response:
                        seen.add(tag)
                        unique_tags.append(tag)
                if unique_tags:
                    if has_voice_directive and "[[audio_as_voice]]" not in final_response:
                        unique_tags.insert(0, "[[audio_as_voice]]")
                    final_response = final_response + "\\n" + "\\n".join(unique_tags)
"""


def main() -> int:
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_GATEWAY
    if not target.exists():
        print(f'SKIP: gateway file not found: {target}')
        return 0

    text = target.read_text()
    if NEW in text:
        print(f'OK: gateway MEDIA patch already applied: {target}')
        return 0
    if OLD not in text:
        print(f'ERROR: expected MEDIA auto-append block not found in {target}', file=sys.stderr)
        print('Review gateway/run.py manually before applying this patch.', file=sys.stderr)
        return 1

    target.write_text(text.replace(OLD, NEW, 1))
    print(f'OK: gateway MEDIA patch applied: {target}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

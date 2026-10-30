"""Sends test messages to the deployed receiver (task T0.2).

Not part of the automatic test run: it writes real rows into the PILOT
storage (mode=dev) and needs a human or Claude to compare the spreadsheet
with the expectations printed at the end. Needs the certifi package. Run
from the app/ folder after every receiver change:

    ../.venv/bin/python tests/receiver_live.py
"""

import json
import re
import ssl
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import certifi

CONFIG = (Path(__file__).resolve().parent.parent / "src" / "config.js").read_text()
URL = re.search(r"RECEIVER_URL =\s*'([^']+)'", CONFIG).group(1)
CODE_GS = (Path(__file__).resolve().parent.parent / "receiver" / "Code.gs").read_text()
EXPECTED_VERSION = re.search(r"RECEIVER_VERSION = '([^']+)'", CODE_GS).group(1)
RUN = time.strftime("%m%d%H%M%S")
# python.org builds on macOS do not use the system certificates.
TLS = ssl.create_default_context(cafile=certifi.where())


def post(body):
    data = body if isinstance(body, bytes) else json.dumps(body).encode()
    request = urllib.request.Request(URL, data=data, headers={"Content-Type": "text/plain"})
    started = time.monotonic()
    with urllib.request.urlopen(request, timeout=60, context=TLS) as response:
        reply = json.loads(response.read())
    return reply, round(time.monotonic() - started, 1)


def message(n, block, **extra):
    return {
        "session_id": f"chk{RUN}s{n}",
        "participant_code": f"chk{RUN}p{n}",
        "mode": "dev",
        "app_version": "0.1.0",
        "block": block,
        **extra,
    }


def check(name, reply, ok=True):
    passed = reply.get("ok") is ok
    print(f"{'ok  ' if passed else 'FAIL'} {name}: {reply}")
    return passed


def main():
    with urllib.request.urlopen(URL, timeout=60, context=TLS) as response:
        deployed = json.loads(response.read()).get("receiver_version")
    if deployed != EXPECTED_VERSION:
        print(f"FAIL deployed receiver is {deployed}, Code.gs is {EXPECTED_VERSION}: "
              "paste Code.gs and deploy a new version (receiver/README.md)")
        sys.exit(1)
    print(f"ok   deployed receiver version {deployed}")
    results = []
    tmt_a = message(
        1,
        "tmt_a",
        summary={
            "tmt_a_time_ms": 41234,
            "tmt_a_errors": 2,
            "tmt_a_ratio": 1.2345678,
            "tmt_a_status": "complete",
            "text_dash": "1-2",
            "text_zeros": "007",
            "text_formula": "=1+1",
            "text_cyrillic": "Тачпад, Є І Ї",
            "flag": True,
            "empty": None,
        },
        log={"clicks": [{"t": 512, "target": 1, "correct": True}]},
    )
    reply, seconds = post(tmt_a)
    results.append(check(f"session 1, tmt_a ({seconds} s)", reply))
    results.append(check("same message again", post(tmt_a)[0]))
    results.append(check(
        "session 1, tmt_b",
        post(message(1, "tmt_b", summary={"tmt_b_time_ms": 80000}, log={"clicks": []}))[0],
    ))

    results.append(check("not JSON", post(b"hello")[0], ok=False))
    results.append(check("unknown mode", post(dict(message(2, "x"), mode="prod"))[0], ok=False))
    results.append(check("email in summary", post(message(2, "x", summary={"email": "a@b.co"}))[0], ok=False))

    with ThreadPoolExecutor(max_workers=5) as pool:
        replies = list(pool.map(lambda n: post(message(n, "tmt_a", summary={"n": n}))[0], range(10, 15)))
    results.append(all(check(f"parallel session {10 + i}", r) for i, r in enumerate(replies)))

    contact = {"email": f"test+{RUN}@example.com", "letter": "Тестовий лист"}
    results.append(check("contact", post(message(3, "retest_invite", summary={"email_left": 1}, contact=contact))[0]))
    results.append(check("retest done mark", post(message(3, "thanks", contact={"retest_done_at": "2026-11-20T10:00:00Z"}))[0]))
    results.append(check("retest mark, no contact", post(message(4, "thanks", contact={"retest_done_at": "2026-11-20T10:00:00Z"}))[0]))

    upper = dict(message(5, "tmt_a"), session_id=f"CHK{RUN}S5")
    results.append(check("case-differing id 1", post(message(5, "tmt_a"))[0]))
    results.append(check("case-differing id 2", post(upper)[0]))
    numeric = dict(message(6, "tmt_a"), session_id=f"{RUN}E5")
    results.append(check("numeric-looking id", post(numeric)[0]))
    results.append(check("numeric-looking id again", post(dict(numeric, block="tmt_b"))[0]))

    # Out of order: seq 2 arrives before seq 1, as beacons may on page close.
    results.append(check("seq 2 first", post(message(7, "tmt_b", seq=2))[0]))
    results.append(check("seq 1 later", post(message(7, "tmt_a", seq=1))[0]))
    results.append(check("bad seq", post(message(7, "tmt_a", seq=0))[0], ok=False))

    print(f"""
Run {RUN}. Expected in the pilot storage:
- sessions: one row chk{RUN}s1 with tmt_a and tmt_b columns, last_block tmt_b,
  text_* exactly as sent ("1-2", "007", "=1+1", Cyrillic), empty cell for "empty";
  log folder chk{RUN}s1 with tmt_a.json and tmt_b.json
- rows chk{RUN}s10..s14 with n = 10..14
- row chk{RUN}s3 without any email; rows chk{RUN}s5 and CHK{RUN}S5 separately;
  one row {RUN}E5 (text, not a number) with last_block tmt_b
- row chk{RUN}s7 with last_block tmt_b and last_seq 2 (the later seq 1 did not move it back)
- no rows for chk{RUN}s2
- contacts: one row chk{RUN}p3 with the email, invite_from = created_on + 7 days,
  a checkbox in "invited", retest_done_at filled; no row for chk{RUN}p4
""")
    sys.exit(0 if all(results) else 1)


if __name__ == "__main__":
    main()

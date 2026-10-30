"""Checks of the receiver's pure functions (receiver/Code.gs, task T0.2).

Code.gs is plain JavaScript, so its validation runs in a browser page; the
parts that touch Google Sheets and Drive are checked after deployment by
sending real messages to the pilot storage.
"""

import unittest
from pathlib import Path

from playwright.sync_api import sync_playwright

CODE_GS = (Path(__file__).resolve().parent.parent / "receiver" / "Code.gs").read_text()

VALID = {
    "session_id": "s_abcdefgh1234",
    "participant_code": "p_abcdefgh1234",
    "mode": "dev",
    "app_version": "0.1.0",
    "block": "tmt_a",
}


def payload(**changes):
    p = dict(VALID)
    for key, value in changes.items():
        if value is ...:
            p.pop(key)
        else:
            p[key] = value
    return p


class ReceiverValidationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch()
        cls.page = cls.browser.new_page()
        cls.page.add_script_tag(content=CODE_GS)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()

    def problem(self, p):
        return self.page.evaluate("p => validatePayload(p)", p)

    def test_valid_payloads_pass(self):
        for p in [
            VALID,
            payload(mode="main"),
            payload(mode="pilot"),
            payload(summary={"tmt_a_time_ms": 41234, "tmt_a_status": "complete", "flag": True, "x": None}),
            payload(log={"clicks": [{"t": 1, "target": 2}]}),
            payload(log=[1, 2, 3]),
            payload(block="retest_invite", contact={"email": "a.b@example.com", "letter": "Текст листа"}),
            payload(contact={"retest_done_at": "2026-11-20T10:00:00Z"}),
            payload(seq=1),
            payload(seq=100000),
        ]:
            with self.subTest(p=p):
                self.assertIsNone(self.problem(p))

    def test_invalid_payloads_are_rejected(self):
        cases = [
            ([1, 2], "payload"),
            (payload(extra=1), "field extra"),
            (payload(session_id=...), "session_id"),
            (payload(session_id="short"), "session_id"),
            (payload(session_id="has space 123"), "session_id"),
            (payload(participant_code=12345678), "participant_code"),
            (payload(mode="prod"), "mode"),
            (payload(mode="toString"), "mode"),
            (payload(mode=...), "mode"),
            (payload(app_version="1.0 beta"), "app_version"),
            (payload(block="TMT-A"), "block"),
            (payload(seq=0), "seq"),
            (payload(seq=-1), "seq"),
            (payload(seq=1.5), "seq"),
            (payload(seq="2"), "seq"),
            (payload(seq=100001), "seq"),
            (payload(seq=None), "seq"),
            (payload(summary=[1]), "summary"),
            (payload(summary={"Bad Key": 1}), "summary key Bad Key"),
            (payload(summary={"email": "a@b.co"}), "summary key email"),
            (payload(summary={"session_id": "x"}), "summary key session_id"),
            (payload(summary={"log_folder": "x"}), "summary key log_folder"),
            (payload(summary={"last_seq": 9}), "summary key last_seq"),
            (payload(summary={"nested": {"a": 1}}), "summary value nested"),
            (payload(summary={"list": [1]}), "summary value list"),
            (payload(summary={"long": "x" * 5001}), "summary value long"),
            (payload(summary={f"k{i}": 1 for i in range(301)}), "summary size"),
            (payload(log=None), "log"),
            (payload(log="text"), "log"),
            (payload(contact={"email": "not-an-email"}), "contact email"),
            (payload(contact={"email": "a@b.co", "phone": "123"}), "contact field phone"),
            (payload(contact="a@b.co"), "contact"),
        ]
        for p, expected in cases:
            with self.subTest(expected=expected):
                self.assertEqual(self.problem(p), expected)

    def test_dev_and_pilot_share_the_pilot_storage(self):
        self.assertEqual(
            self.page.evaluate("STORE_FOR_MODE"),
            {"main": "main", "pilot": "pilot", "dev": "pilot"},
        )

    def test_cell_values(self):
        for value, expected in [(None, ""), (5, 5), (1.5, 1.5), (True, True), ("abc", "abc"), ("=1+1", "'=1+1")]:
            with self.subTest(value=value):
                self.assertEqual(self.page.evaluate("v => cellValue(v)", value), expected)


if __name__ == "__main__":
    unittest.main()

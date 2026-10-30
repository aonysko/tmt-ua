"""Checks of the app shell (task T0.1) in Chromium and WebKit via Playwright.

Run from the app/ folder in an environment with Playwright installed
(in the research repo: ../.venv/bin/python -m unittest discover -s tests -v).
Needs internet access: jsPsych is loaded from the CDN. To check the published
site instead of the local files, set TMTUA_BASE_URL, e.g.
TMTUA_BASE_URL=https://aonysko.github.io/tmt-ua/
"""

import functools
import http.server
import json
import os
import threading
import unittest
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

APP_DIR = Path(__file__).resolve().parent.parent


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


class AppShellTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = None
        cls.base = os.environ.get("TMTUA_BASE_URL")
        if not cls.base:
            handler = functools.partial(QuietHandler, directory=APP_DIR)
            cls.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
            threading.Thread(target=cls.server.serve_forever, daemon=True).start()
            cls.base = f"http://127.0.0.1:{cls.server.server_port}/"
        cls.pw = sync_playwright().start()
        cls.browsers = [cls.pw.chromium.launch(), cls.pw.webkit.launch()]

    @classmethod
    def tearDownClass(cls):
        for browser in cls.browsers:
            browser.close()
        cls.pw.stop()
        if cls.server:
            cls.server.shutdown()

    def open(self, browser, query, block_cdn=False, tamper_cdn=False):
        """Opens the app; returns the page and a list collecting JS errors."""
        page = browser.new_page()
        self.addCleanup(page.close)
        errors = []
        page.on("pageerror", lambda exc: errors.append(str(exc)))
        page.on("console", lambda msg: msg.type == "error" and errors.append(msg.text))
        if block_cdn:
            page.route("**/cdn.jsdelivr.net/**", lambda route: route.abort())
        if tamper_cdn:
            def tamper(route):
                response = route.fetch()
                route.fulfill(response=response, body=response.text() + "\n;")
            page.route("**/jspsych@*/dist/*.js", tamper)
        page.goto(self.base + query)
        return page, errors

    def module(self, page, path):
        """Imports one of the app's own modules inside the page."""
        return page.evaluate(f"import('./src/{path}').then(m => JSON.parse(JSON.stringify(m)))")

    def blocks(self, page):
        return page.evaluate("import('./src/blocks.js').then(m => m.BLOCKS.map(b => [b.id, b.label]))")

    def test_main_mode_runs_all_blocks_in_order(self):
        for browser in self.browsers:
            with self.subTest(browser=browser.browser_type.name):
                page, errors = self.open(browser, "")
                blocks = self.blocks(page)
                self.assertEqual(len(blocks), 16)
                for _, label in blocks:
                    expect(page.locator(".placeholder")).to_contain_text(label)
                    page.get_by_role("button", name="Далі").click()
                texts = self.module(page, "texts.uk.js")["texts"]
                expect(page.locator(".message")).to_have_text(texts["common"]["sessionEnd"])
                self.assertEqual(page.locator(".dev-badge").count(), 0)
                self.assertEqual(errors, [])

    def test_unknown_mode_is_rejected(self):
        for browser in self.browsers:
            with self.subTest(browser=browser.browser_type.name):
                page, errors = self.open(browser, "?mode=pliot")
                texts = self.module(page, "texts.uk.js")["texts"]
                expect(page.locator(".message")).to_have_text(texts["errors"]["badLink"])
                self.assertEqual(errors, [])

    def test_dev_menu_lists_every_block(self):
        for browser in self.browsers:
            with self.subTest(browser=browser.browser_type.name):
                page, errors = self.open(browser, "?mode=dev")
                config = self.module(page, "config.js")
                expect(page.locator(".dev-version")).to_have_text(config["APP_VERSION"])
                ids = [block_id for block_id, _ in self.blocks(page)]
                self.assertEqual(page.locator(".dev-menu tr").evaluate_all(
                    "rows => rows.map(r => r.dataset.block)"), ids)
                self.assertEqual(errors, [])

    def test_dev_only_runs_one_block_and_dumps_data(self):
        for browser in self.browsers:
            with self.subTest(browser=browser.browser_type.name):
                page, errors = self.open(browser, "?mode=dev&only=tmt_a")
                expect(page.locator(".placeholder")).to_contain_text("TMT, частина A")
                expect(page.locator(".dev-badge")).to_be_visible()
                page.get_by_role("button", name="Далі").click()
                data = json.loads(page.locator(".dev-end pre").text_content())
                self.assertEqual([row["block"] for row in data], ["tmt_a"])
                self.assertEqual(data[0]["mode"], "dev")
                self.assertEqual(data[0]["app_version"], self.module(page, "config.js")["APP_VERSION"])
                self.assertEqual(errors, [])

    def test_dev_start_runs_from_block_to_end(self):
        for browser in self.browsers:
            with self.subTest(browser=browser.browser_type.name):
                page, errors = self.open(browser, "?mode=dev&start=pss10")
                for label in ["PSS-10", "Питання після тесту", "Запрошення на ретест", "Подяка"]:
                    expect(page.locator(".placeholder")).to_contain_text(label)
                    page.get_by_role("button", name="Далі").click()
                expect(page.locator(".dev-end")).to_be_visible()
                self.assertEqual(errors, [])

    def test_dev_override_changes_parameter(self):
        for browser in self.browsers:
            with self.subTest(browser=browser.browser_type.name):
                page, errors = self.open(browser, "?mode=dev&only=tmt_a&set.tmt.timeLimitMs=20000")
                expect(page.locator(".placeholder")).to_be_visible()
                self.assertEqual(page.evaluate("window.tmtua.params.tmt.timeLimitMs"), 20000)
                self.assertEqual(errors, [])

    def test_override_is_ignored_outside_dev(self):
        for browser in self.browsers:
            with self.subTest(browser=browser.browser_type.name):
                for mode in ["main", "pilot"]:
                    page, errors = self.open(browser, f"?mode={mode}&set.tmt.timeLimitMs=20000")
                    session = page.evaluate(
                        "import('./src/session.js').then(m => m.parseUrl(location.search))")
                    self.assertEqual(session["overrides"], {})
                    self.assertFalse(page.evaluate("'tmtua' in window"))
                    self.assertEqual(errors, [])

    def test_mistyped_override_or_block_fails_loudly(self):
        for browser in self.browsers:
            with self.subTest(browser=browser.browser_type.name):
                for query, needle in [
                    ("?mode=dev&only=tmt_a&set.tmt.timeLimitMS=1", "timeLimitMS"),
                    ("?mode=dev&only=tmt_a&set.tmt.timeLimitMs=abc", "abc"),
                    ("?mode=dev&only=tmt_c", "tmt_c"),
                ]:
                    page, _ = self.open(browser, query)
                    expect(page.locator(".message")).to_contain_text(needle)

    def test_cdn_failure_shows_message(self):
        for browser in self.browsers:
            with self.subTest(browser=browser.browser_type.name):
                page, _ = self.open(browser, "", block_cdn=True)
                texts = self.module(page, "texts.uk.js")["texts"]
                expect(page.locator(".message")).to_have_text(texts["errors"]["loadFailed"])

    def test_changed_cdn_file_is_refused(self):
        # The integrity hash in index.html must stop a modified library file.
        for browser in self.browsers:
            with self.subTest(browser=browser.browser_type.name):
                page, _ = self.open(browser, "", tamper_cdn=True)
                texts = self.module(page, "texts.uk.js")["texts"]
                expect(page.locator(".message")).to_have_text(texts["errors"]["loadFailed"])


if __name__ == "__main__":
    unittest.main()

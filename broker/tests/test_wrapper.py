"""Tests for the wrapper-PID inspection module.

PID-reuse is the security-critical concern: a stale PID file pointing
at a recycled, unrelated process must NOT count as "wrapper alive" —
otherwise we'd refuse to start a new stream because some random other
user process happens to have the same PID.
"""

from __future__ import annotations

from . import _setup  # noqa: F401

import os
import pathlib
import tempfile
import unittest
import unittest.mock as mock

from aceman_broker import wrapper


class ReadWrapperPidTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.pid_file = pathlib.Path(self._tmp.name) / "aceman.active.pid"
        self._patch = mock.patch.object(
            wrapper, "wrapper_pid_file", return_value=self.pid_file)
        self._patch.start()
        self.addCleanup(self._patch.stop)

    def test_returns_none_when_file_missing(self):
        self.assertIsNone(wrapper.read_wrapper_pid())

    def test_parses_valid_pid(self):
        self.pid_file.write_text("12345\n")
        self.assertEqual(wrapper.read_wrapper_pid(), 12345)

    def test_returns_none_for_empty_file(self):
        self.pid_file.write_text("")
        self.assertIsNone(wrapper.read_wrapper_pid())

    def test_returns_none_for_garbage(self):
        for bad in ("not-a-pid", "\x00\x01", "12.5", "1 2 3",
                    " ", "1; rm -rf /"):
            with self.subTest(bad=bad):
                self.pid_file.write_text(bad)
                self.assertIsNone(wrapper.read_wrapper_pid())

    def test_rejects_pid_one_and_below(self):
        # PID 0 is the kernel; PID 1 is init / systemd. Neither
        # should ever be our wrapper, and signalling them by mistake
        # would be catastrophic.
        for bad in ("0", "1", "-1"):
            with self.subTest(bad=bad):
                self.pid_file.write_text(bad)
                self.assertIsNone(wrapper.read_wrapper_pid())


class PidMatchesAcemanTests(unittest.TestCase):
    """The PID-reuse guard. Without this check, killing a recycled
    PID could SIGTERM an unrelated user process."""

    def test_returns_false_for_missing_proc_entry(self):
        # Pick a PID that is almost certainly not in use.
        self.assertFalse(wrapper.pid_matches_aceman(999_999_999))

    def test_returns_false_for_unrelated_process(self):
        # The current Python process running this test is NOT named
        # "aceman" in its cmdline. Use our own PID as a stand-in for
        # "some other process".
        self.assertFalse(wrapper.pid_matches_aceman(os.getpid()))

    def test_matches_when_cmdline_contains_aceman(self):
        # Synthesise a fake /proc/PID/cmdline by patching the read.
        fake_cmdline = b"bash\0/home/user/aceman\0acestream://aaaa\0"
        with mock.patch("aceman_broker.wrapper.pathlib.Path") as P:
            inst = mock.MagicMock()
            inst.read_bytes.return_value = fake_cmdline
            P.return_value = inst
            self.assertTrue(wrapper.pid_matches_aceman(12345))


class WrapperAliveTests(unittest.TestCase):
    def test_returns_false_when_pid_unreadable(self):
        with mock.patch.object(wrapper, "read_wrapper_pid",
                               return_value=None):
            self.assertFalse(wrapper.wrapper_alive())

    def test_returns_false_when_pid_does_not_match_aceman(self):
        with mock.patch.object(wrapper, "read_wrapper_pid",
                               return_value=999_999),\
             mock.patch.object(wrapper, "pid_matches_aceman",
                               return_value=False):
            self.assertFalse(wrapper.wrapper_alive())

    def test_returns_true_when_both_signals_align(self):
        with mock.patch.object(wrapper, "read_wrapper_pid",
                               return_value=12345),\
             mock.patch.object(wrapper, "pid_matches_aceman",
                               return_value=True):
            self.assertTrue(wrapper.wrapper_alive())


if __name__ == "__main__":
    unittest.main()

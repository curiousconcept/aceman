"""Tests for VA-API GPU probing.

The probe must read capability from where ffmpeg runs: the web container
when it's up (so Fedora's codec-stripped host iHD doesn't hide H.264
encode that the image's full driver exposes), else the host. And a
low-power-only Intel encoder (EncSliceLP) must still count as capable.
"""

from __future__ import annotations

from . import _setup  # noqa: F401

import subprocess
import unittest
import unittest.mock as mock

from aceman_broker.actions import gpu


# Real vainfo output fragment from a low-power-only Intel iGPU (N100):
# encode is exposed ONLY as EncSliceLP, never the legacy EncSlice.
_VAINFO_LP = (
    "libva info: Trying to open /usr/lib64/dri/iHD_drv_video.so\n"
    "vainfo: Driver version: Intel iHD driver 26.1.5\n"
    "      VAProfileH264Main               : VAEntrypointVLD\n"
    "      VAProfileH264Main               : VAEntrypointEncSliceLP\n"
    "      VAProfileH264High               : VAEntrypointEncSliceLP\n"
)

# Decode-only (no encode entrypoint at all).
_VAINFO_DECODE_ONLY = (
    "libva info: Trying to open /usr/lib64/dri/iHD_drv_video.so\n"
    "      VAProfileH264Main               : VAEntrypointVLD\n"
)


class VainfoArgvTests(unittest.TestCase):
    def test_routes_through_web_container_when_running(self):
        with mock.patch.object(gpu, "container_running_named", return_value=True):
            argv = gpu._vainfo_argv()
        self.assertEqual(argv[:3], ["podman", "exec", gpu.WEB_NAME])
        self.assertIn("vainfo", argv)
        self.assertIn(gpu._RENDER_NODE, argv)

    def test_falls_back_to_host_when_no_container_but_vainfo_present(self):
        with mock.patch.object(gpu, "container_running_named", return_value=False), \
             mock.patch.object(gpu.shutil, "which", return_value="/usr/bin/vainfo"):
            argv = gpu._vainfo_argv()
        self.assertEqual(argv[0], "vainfo")
        self.assertNotIn("podman", argv)

    def test_none_when_no_container_and_no_host_vainfo(self):
        with mock.patch.object(gpu, "container_running_named", return_value=False), \
             mock.patch.object(gpu.shutil, "which", return_value=None):
            self.assertIsNone(gpu._vainfo_argv())


class ProbeVaapiTests(unittest.TestCase):
    def _run(self, vainfo_output):
        completed = subprocess.CompletedProcess([], 0, stdout=vainfo_output, stderr="")
        with mock.patch.object(gpu.pathlib.Path, "exists", return_value=True), \
             mock.patch.object(gpu, "_vainfo_argv", return_value=["vainfo"]), \
             mock.patch.object(gpu.subprocess, "run", return_value=completed):
            return gpu._probe_vaapi()

    def test_low_power_encoder_counts_as_h264_capable(self):
        # The crux: EncSliceLP contains the EncSlice substring → capable.
        out = self._run(_VAINFO_LP)
        self.assertTrue(out["h264_enc"])
        self.assertEqual(out["driver"], "iHD")

    def test_decode_only_is_not_encode_capable(self):
        out = self._run(_VAINFO_DECODE_ONLY)
        self.assertFalse(out["h264_enc"])

    def test_no_render_node_returns_none(self):
        with mock.patch.object(gpu.pathlib.Path, "exists", return_value=False):
            self.assertIsNone(gpu._probe_vaapi())


class ProbeQsvTests(unittest.TestCase):
    def test_qsv_true_for_intel_driver(self):
        self.assertTrue(gpu._probe_qsv({"driver": "iHD"}))
        self.assertTrue(gpu._probe_qsv({"driver": "i965"}))

    def test_qsv_false_for_amd_or_missing(self):
        self.assertFalse(gpu._probe_qsv({"driver": "radeonsi"}))
        self.assertFalse(gpu._probe_qsv(None))


if __name__ == "__main__":
    unittest.main()

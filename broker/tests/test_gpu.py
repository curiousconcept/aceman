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


class ProbeNvidiaTests(unittest.TestCase):
    """NVENC runs inside the web container; it needs the GPU via CDI or it
    can't load libcuda (issue #12). The probe must refuse nvidia when the
    container is up but no CDI passthrough is wired, and allow it in --native
    mode (no web container) where ffmpeg runs on the host."""

    def test_none_when_no_nvidia_smi(self):
        with mock.patch.object(gpu.shutil, "which", return_value=None):
            self.assertIsNone(gpu._probe_nvidia())

    def test_refused_when_container_up_without_cdi(self):
        with mock.patch.object(gpu.shutil, "which", return_value="/usr/bin/nvidia-smi"), \
             mock.patch.object(gpu, "container_running_named", return_value=True), \
             mock.patch.object(gpu, "_nvidia_cdi_ready", return_value=False):
            self.assertIsNone(gpu._probe_nvidia())

    def test_allowed_when_container_up_with_cdi(self):
        completed = subprocess.CompletedProcess([], 0, stdout="GeForce RTX 4070\n", stderr="")
        with mock.patch.object(gpu.shutil, "which", return_value="/usr/bin/nvidia-smi"), \
             mock.patch.object(gpu, "container_running_named", return_value=True), \
             mock.patch.object(gpu, "_nvidia_cdi_ready", return_value=True), \
             mock.patch.object(gpu.subprocess, "run", return_value=completed):
            out = gpu._probe_nvidia()
        self.assertEqual(out, {"name": "GeForce RTX 4070"})

    def test_allowed_in_native_mode_without_cdi(self):
        # No web container → ffmpeg runs on the host, where the driver works;
        # CDI isn't required. _nvidia_cdi_ready must not even be consulted.
        completed = subprocess.CompletedProcess([], 0, stdout="GeForce RTX 4070\n", stderr="")
        with mock.patch.object(gpu.shutil, "which", return_value="/usr/bin/nvidia-smi"), \
             mock.patch.object(gpu, "container_running_named", return_value=False), \
             mock.patch.object(gpu, "_nvidia_cdi_ready", side_effect=AssertionError("must not check CDI in native mode")), \
             mock.patch.object(gpu.subprocess, "run", return_value=completed):
            out = gpu._probe_nvidia()
        self.assertEqual(out["name"], "GeForce RTX 4070")


class NvidiaCdiReadyTests(unittest.TestCase):
    def test_false_when_no_control_node(self):
        with mock.patch.object(gpu.pathlib.Path, "exists", return_value=False):
            self.assertFalse(gpu._nvidia_cdi_ready())

    def test_true_when_control_node_and_spec_present(self):
        # /dev/nvidiactl exists; /etc/cdi holds an nvidia.yaml spec.
        real_isdir = gpu.pathlib.Path.is_dir

        class _Spec:
            name = "nvidia.yaml"
            suffix = ".yaml"

        with mock.patch.object(gpu.pathlib.Path, "exists", return_value=True), \
             mock.patch.object(gpu.pathlib.Path, "is_dir", autospec=True,
                               side_effect=lambda self: str(self) == "/etc/cdi"), \
             mock.patch.object(gpu.pathlib.Path, "iterdir", autospec=True,
                               side_effect=lambda self: [_Spec()] if str(self) == "/etc/cdi" else []):
            self.assertTrue(gpu._nvidia_cdi_ready())
        del real_isdir

    def test_false_when_control_node_but_no_spec(self):
        with mock.patch.object(gpu.pathlib.Path, "exists", return_value=True), \
             mock.patch.object(gpu.pathlib.Path, "is_dir", autospec=True, return_value=False):
            self.assertFalse(gpu._nvidia_cdi_ready())


class ProbeQsvTests(unittest.TestCase):
    def test_qsv_true_for_intel_driver(self):
        self.assertTrue(gpu._probe_qsv({"driver": "iHD"}))
        self.assertTrue(gpu._probe_qsv({"driver": "i965"}))

    def test_qsv_false_for_amd_or_missing(self):
        self.assertFalse(gpu._probe_qsv({"driver": "radeonsi"}))
        self.assertFalse(gpu._probe_qsv(None))


if __name__ == "__main__":
    unittest.main()

# Worker scripts

## `export_sam21_small_onnx.py`: SAM 2.1 small to ONNX (HEN-318, run in HEN-67)

- **Checkpoint:** <https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_small.pt> (SAM 2.1 small, Meta, from
  <https://github.com/facebookresearch/sam2>).
- **Licence:** Apache-2.0 (checkpoint and `sam2` code). We never download the onnx-community ONNX export, because it carries no licence.
- **Output:** `vision_encoder.onnx` and `prompt_encoder_mask_decoder.onnx`, with the graph names `sam21_onnx_tracker.py` reads.
- **Status:** written but never run. CI only checks that the script imports without torch or `sam2`. Nothing is downloaded by the
  script or by CI.

### How to run it (HEN-67 only, not in #96)

The real run is HEN-67 scope and stays out of #96 (HEN-318).

1. Use a separate Python 3.13 venv inside the mode-700 footage folder, not the repo's `packages/workers/.venv`.
2. In that venv, install torch (CPU) and `sam2` from Meta's repository, after the licence and 14-day package-age check.
3. Download the checkpoint above by hand into the footage folder.
4. Create an empty mode-700 output folder inside the footage folder.
5. Run
   `python packages/workers/scripts/export_sam21_small_onnx.py --checkpoint <footage>/sam2.1_hiera_small.pt --output-folder <footage>/sam21-onnx`.

The script refuses an output folder that is missing, not mode 700, or already holds an export. It writes both files as mode 600.

# Worker scripts

## `export_sam21_small_onnx.py`: SAM 2.1 small to ONNX (HEN-318, run in HEN-67)

- **Checkpoint:** <https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_small.pt> (SAM 2.1 small, Meta, from
  <https://github.com/facebookresearch/sam2>).
- **Licence:** Apache-2.0 (checkpoint and `sam2` code). We never download the onnx-community ONNX export, because it carries no licence.
- **Output:** `vision_encoder.onnx` and `prompt_encoder_mask_decoder.onnx`, with the graph names `sam21_onnx_tracker.py` reads.
- **Status:** written but never run. CI checks that the script imports without torch or `sam2`, and that its checkpoint fetch asks for
  the URL above only and refuses any other URL or licence (HEN-351). CI mocks the fetch and downloads nothing.

### How to run it (HEN-67 only, not in #96)

The real run is HEN-67 scope and stays out of #96 (HEN-318).

1. Use a separate Python 3.13 venv inside the mode-700 footage folder, not the repo's `packages/workers/.venv`.
2. In that venv, install torch (CPU) and `sam2` from Meta's repository, after the licence and 14-day package-age check.
3. Create an empty mode-700 output folder inside the footage folder.
4. Run `python packages/workers/scripts/export_sam21_small_onnx.py --output-folder <footage>/sam21-onnx`. Without `--checkpoint` the
   script fetches the checkpoint above into that folder first; pass `--checkpoint <path>` to use one already on disk.

The script refuses an output folder that is missing, not mode 700, or already holds an export or a checkpoint. It writes the
checkpoint and both ONNX files as mode 600 and removes a partial checkpoint if the fetch fails.

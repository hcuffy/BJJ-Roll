"""Export SAM 2.1 small to the two ONNX files `sam21_onnx_tracker.Sam21OnnxTracker` reads (HEN-318; run in HEN-67).

The export starts from Meta's Apache-2.0 checkpoint (`CHECKPOINT_URL`), downloaded by hand into the footage folder. We never use the
onnx-community export, because it carries no licence. This script downloads nothing. It needs torch and the `sam2` package from
https://github.com/facebookresearch/sam2 in a separate Python 3.13 venv inside the mode-700 footage folder. Both are imported only
inside `export`, so CI and Ruff never need them. See README.md next to this file.

Graph names match the tracker:
- vision_encoder.onnx: `pixel_values` (1, 3, 1024, 1024) -> `image_embeddings`, `high_res_features_0`, `high_res_features_1`.
- prompt_encoder_mask_decoder.onnx: the three encoder outputs plus `input_points` (1, 1, N, 2) in 1024-pixel model space and
  `input_labels` (1, 1, N) int64 -> `iou_scores` (1, 3) and `pred_masks` (1, 3, 256, 256) logits. It has no `input_boxes` input,
  so the tracker prompts later frames with the centre of the previous box.
"""

import argparse
import importlib
import stat
import sys
from collections.abc import Sequence
from pathlib import Path
from typing import Any

CHECKPOINT_URL = "https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_small.pt"
CHECKPOINT_LICENCE = "Apache-2.0"
MODEL_CONFIG = "configs/sam2.1/sam2.1_hiera_s.yaml"
VISION_ENCODER_FILE = "vision_encoder.onnx"
MASK_DECODER_FILE = "prompt_encoder_mask_decoder.onnx"
MODEL_INPUT_SIZE = 1024
BACKBONE_STRIDES = (4, 8, 16)
OPSET_VERSION = 17
FOOTAGE_FOLDER_MODE = stat.S_IRWXU
EXPORTED_FILE_MODE = stat.S_IRUSR | stat.S_IWUSR


class ExportFolderError(RuntimeError):
    """The output folder is missing, not mode 700, or already holds an export."""


def check_output_folder(output_folder: Path) -> None:
    if not output_folder.is_dir() or output_folder.is_symlink():
        raise ExportFolderError("output folder must be an existing folder")
    if stat.S_IMODE(output_folder.stat().st_mode) != FOOTAGE_FOLDER_MODE:
        raise ExportFolderError("output folder must be mode 700")
    if any((output_folder / name).exists() for name in (VISION_ENCODER_FILE, MASK_DECODER_FILE)):
        raise ExportFolderError("output folder already holds an export")


def _wrappers(torch: Any, model: Any) -> tuple[Any, Any]:
    feature_sizes = [(MODEL_INPUT_SIZE // stride, MODEL_INPUT_SIZE // stride) for stride in BACKBONE_STRIDES]

    class VisionEncoder(torch.nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.model = model

        def forward(self, pixel_values: Any) -> tuple[Any, Any, Any]:
            backbone_out = self.model.forward_image(pixel_values)
            _, vision_feats, _, _ = self.model._prepare_backbone_features(backbone_out)
            if self.model.directly_add_no_mem_embed:
                vision_feats[-1] = vision_feats[-1] + self.model.no_mem_embed
            feats = [feat.permute(1, 2, 0).reshape(1, -1, *size) for feat, size in zip(vision_feats[::-1], feature_sizes[::-1], strict=True)][::-1]
            return feats[2], feats[0], feats[1]

    class PromptEncoderMaskDecoder(torch.nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.model = model

        def forward(
            self, image_embeddings: Any, high_res_features_0: Any, high_res_features_1: Any, input_points: Any, input_labels: Any
        ) -> tuple[Any, Any]:
            points = input_points.reshape(1, -1, 2)
            labels = input_labels.reshape(1, -1).to(torch.int32)
            sparse, dense = self.model.sam_prompt_encoder(points=(points, labels), boxes=None, masks=None)
            masks, iou_scores, _, _ = self.model.sam_mask_decoder(
                image_embeddings=image_embeddings,
                image_pe=self.model.sam_prompt_encoder.get_dense_pe(),
                sparse_prompt_embeddings=sparse,
                dense_prompt_embeddings=dense,
                multimask_output=True,
                repeat_image=False,
                high_res_features=[high_res_features_0, high_res_features_1],
            )
            return iou_scores, masks

    return VisionEncoder().eval(), PromptEncoderMaskDecoder().eval()


def export(checkpoint: Path, output_folder: Path) -> None:
    check_output_folder(output_folder)
    torch = importlib.import_module("torch")
    build_sam = importlib.import_module("sam2.build_sam")
    model = build_sam.build_sam2(MODEL_CONFIG, str(checkpoint), device="cpu")
    encoder, decoder = _wrappers(torch, model)
    with torch.no_grad():
        pixel_values = torch.zeros(1, 3, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE)
        embeddings = encoder(pixel_values)
        encoder_names = ["image_embeddings", "high_res_features_0", "high_res_features_1"]
        torch.onnx.export(
            encoder,
            (pixel_values,),
            str(output_folder / VISION_ENCODER_FILE),
            input_names=["pixel_values"],
            output_names=encoder_names,
            opset_version=OPSET_VERSION,
        )
        points = torch.zeros(1, 1, 1, 2)
        labels = torch.ones(1, 1, 1, dtype=torch.int64)
        torch.onnx.export(
            decoder,
            (*embeddings, points, labels),
            str(output_folder / MASK_DECODER_FILE),
            input_names=[*encoder_names, "input_points", "input_labels"],
            output_names=["iou_scores", "pred_masks"],
            dynamic_axes={"input_points": {2: "point_count"}, "input_labels": {2: "point_count"}},
            opset_version=OPSET_VERSION,
        )
    for name in (VISION_ENCODER_FILE, MASK_DECODER_FILE):
        (output_folder / name).chmod(EXPORTED_FILE_MODE)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Export SAM 2.1 small to ONNX for the local CPU tracker.")
    parser.add_argument("--checkpoint", type=Path, required=True, help="sam2.1_hiera_small.pt from CHECKPOINT_URL, already on disk")
    parser.add_argument("--output-folder", type=Path, required=True, help="existing mode-700 folder inside the footage folder")
    arguments = parser.parse_args(argv)
    try:
        export(arguments.checkpoint, arguments.output_folder)
    except ExportFolderError as error:
        sys.stderr.write(f"{error}\n")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

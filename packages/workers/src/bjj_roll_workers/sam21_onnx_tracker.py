"""Local CPU tracker backend: SAM 2.1 small (Hiera-S) ONNX export on onnxruntime's CPU provider (HEN-318).

`weights_folder` holds `vision_encoder.onnx` and `prompt_encoder_mask_decoder.onnx`, which we export ourselves from Meta's
Apache-2.0 checkpoint with `scripts/export_sam21_small_onnx.py`. Weights are not shipped, downloaded or read by tests. numpy and
onnxruntime are imported lazily on the first `track` call and are not CI dependencies (onnxruntime has no Python 3.15 wheel); a
real run uses its own venv (see DECISIONS.md A7).

The image export has no memory modules, so the first frame is prompted with the tap point or the prompt mask's box, and every
later frame with the box of that athlete's previous mask. Graph input and output names are the export's documented names and
are unverified until the first local smoke run.
"""

import importlib
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from bjj_roll_workers.geometry import Box, TapPoint
from bjj_roll_workers.tracker import RGB_CHANNELS, Frame, FrameTracks, Mask, Prompt, TrackedObject

VISION_ENCODER_FILE = "vision_encoder.onnx"
MASK_DECODER_FILE = "prompt_encoder_mask_decoder.onnx"
CPU_PROVIDER = "CPUExecutionProvider"
MODEL_INPUT_SIZE = 1024
PIXEL_MEAN = (0.485, 0.456, 0.406)
PIXEL_STD = (0.229, 0.224, 0.225)
PIXEL_MAX_VALUE = 255.0
MASK_LOGIT_THRESHOLD = 0.0
POSITIVE_POINT_LABEL = 1
PIXEL_VALUES_INPUT = "pixel_values"
POINTS_INPUT = "input_points"
LABELS_INPUT = "input_labels"
BOXES_INPUT = "input_boxes"
IOU_SCORES_OUTPUT = "iou_scores"
PRED_MASKS_OUTPUT = "pred_masks"

type BoxOrPoint = Box | TapPoint


class Sam21OnnxTracker:
    """`tracker.Tracker` backend. Sessions load on first use; nothing about a video is kept between `track` calls."""

    def __init__(self, weights_folder: Path) -> None:
        self._weights_folder = weights_folder
        self._sessions: tuple[Any, Any] | None = None

    def track(self, frames: Sequence[Frame], prompts: Mapping[str, Prompt]) -> list[FrameTracks]:
        numpy = importlib.import_module("numpy")
        encoder, decoder = self._load_sessions()
        current: dict[str, BoxOrPoint] = {athlete_id: self._first_prompt(prompt) for athlete_id, prompt in prompts.items()}
        output: list[FrameTracks] = []
        for frame in frames:
            image = numpy.frombuffer(frame.rgb, dtype=numpy.uint8).reshape(frame.size.height, frame.size.width, RGB_CHANNELS)
            embeddings = encoder.run(None, {PIXEL_VALUES_INPUT: self._preprocess(numpy, image)})
            embedding_feeds = dict(zip((item.name for item in encoder.get_outputs()), embeddings, strict=True))
            tracks: FrameTracks = {}
            for athlete_id, prompt in current.items():
                tracked = self._segment(numpy, decoder, embedding_feeds, prompt, frame)
                tracks[athlete_id] = tracked
                if tracked.box is not None:
                    current[athlete_id] = tracked.box
            output.append(tracks)
        return output

    def _load_sessions(self) -> tuple[Any, Any]:
        if self._sessions is None:
            onnxruntime = importlib.import_module("onnxruntime")
            self._sessions = (
                onnxruntime.InferenceSession(str(self._weights_folder / VISION_ENCODER_FILE), providers=[CPU_PROVIDER]),
                onnxruntime.InferenceSession(str(self._weights_folder / MASK_DECODER_FILE), providers=[CPU_PROVIDER]),
            )
        return self._sessions

    @staticmethod
    def _first_prompt(prompt: Prompt) -> BoxOrPoint:
        if isinstance(prompt, TapPoint):
            return prompt
        pixels = prompt.mask.to_pixels()
        width = prompt.mask.size.width
        set_pixels = [index for index, value in enumerate(pixels) if value]
        if not set_pixels:
            raise ValueError("prompt mask is empty")
        xs, ys = [index % width for index in set_pixels], [index // width for index in set_pixels]
        return Box(x_min=min(xs), y_min=min(ys), x_max=max(xs) + 1, y_max=max(ys) + 1)

    @staticmethod
    def _preprocess(numpy: Any, image: Any) -> Any:
        height, width = image.shape[:2]
        rows = (numpy.arange(MODEL_INPUT_SIZE) * height // MODEL_INPUT_SIZE).clip(0, height - 1)
        columns = (numpy.arange(MODEL_INPUT_SIZE) * width // MODEL_INPUT_SIZE).clip(0, width - 1)
        resized = image[rows][:, columns].astype(numpy.float32) / PIXEL_MAX_VALUE
        normalised = (resized - numpy.array(PIXEL_MEAN, dtype=numpy.float32)) / numpy.array(PIXEL_STD, dtype=numpy.float32)
        return normalised.transpose(2, 0, 1)[numpy.newaxis]

    @staticmethod
    def _segment(numpy: Any, decoder: Any, embedding_feeds: dict[str, Any], prompt: BoxOrPoint, frame: Frame) -> TrackedObject:
        scale_x, scale_y = MODEL_INPUT_SIZE / frame.size.width, MODEL_INPUT_SIZE / frame.size.height
        centre_x, centre_y = prompt.centre if isinstance(prompt, Box) else (prompt.x, prompt.y)
        feeds = dict(embedding_feeds)
        feeds[POINTS_INPUT] = numpy.array([[[[centre_x * scale_x, centre_y * scale_y]]]], dtype=numpy.float32)
        feeds[LABELS_INPUT] = numpy.array([[[POSITIVE_POINT_LABEL]]], dtype=numpy.int64)
        input_names = {item.name for item in decoder.get_inputs()}
        if isinstance(prompt, Box) and BOXES_INPUT in input_names:
            feeds[BOXES_INPUT] = numpy.array(
                [[[prompt.x_min * scale_x, prompt.y_min * scale_y, prompt.x_max * scale_x, prompt.y_max * scale_y]]], dtype=numpy.float32
            )
        results = dict(
            zip(
                (item.name for item in decoder.get_outputs()),
                decoder.run(None, {name: value for name, value in feeds.items() if name in input_names}),
                strict=True,
            )
        )
        iou_scores = results[IOU_SCORES_OUTPUT].reshape(-1)
        best = int(iou_scores.argmax())
        low_resolution = results[PRED_MASKS_OUTPUT].reshape(len(iou_scores), *results[PRED_MASKS_OUTPUT].shape[-2:])[best]
        rows = numpy.arange(frame.size.height) * low_resolution.shape[0] // frame.size.height
        columns = numpy.arange(frame.size.width) * low_resolution.shape[1] // frame.size.width
        mask_pixels = low_resolution[rows][:, columns] > MASK_LOGIT_THRESHOLD
        return _tracked_object(numpy, mask_pixels, float(numpy.clip(iou_scores[best], 0.0, 1.0)), frame)


def _tracked_object(numpy: Any, mask_pixels: Any, score: float, frame: Frame) -> TrackedObject:
    flat = mask_pixels.reshape(-1).astype(numpy.int8)
    boundaries = numpy.concatenate(([0], numpy.flatnonzero(numpy.diff(flat)) + 1, [flat.size]))
    runs = [int(run) for run in numpy.diff(boundaries)]
    if flat.size and flat[0] == 1:
        runs.insert(0, 0)
    mask = Mask(size=frame.size, runs=tuple(runs))
    if mask.area == 0:
        return TrackedObject(mask=mask, box=None, score=0.0)
    ys, xs = numpy.nonzero(mask_pixels)
    return TrackedObject(mask=mask, box=Box(x_min=int(xs.min()), y_min=int(ys.min()), x_max=int(xs.max()) + 1, y_max=int(ys.max()) + 1), score=score)

import importlib
from pathlib import Path
from typing import Any

from bjj_roll_workers.geometry import COCO17_KEYPOINT_NAMES, Box, Keypoint
from bjj_roll_workers.pose import PoseKeypoints
from bjj_roll_workers.pose_config import PoseConfig
from bjj_roll_workers.tracker import RGB_CHANNELS, Frame

CPU_PROVIDER = "CPUExecutionProvider"
MODEL_INPUT_WIDTH = 192
MODEL_INPUT_HEIGHT = 256
BOX_PADDING = 1.25
SIMCC_SPLIT_RATIO = 2.0
PIXEL_MEAN = (123.675, 116.28, 103.53)
PIXEL_STD = (58.395, 57.12, 57.375)
KEYPOINT_EDGE_MARGIN = 1e-3


class RtmPoseOnnxPose:
    def __init__(self, weights_file: Path, config: PoseConfig) -> None:
        self._weights_file = weights_file
        self._config = config
        self._session: Any = None

    def estimate(self, frame: Frame, box: Box) -> PoseKeypoints:
        numpy = importlib.import_module("numpy")
        session = self._load_session()
        image = numpy.frombuffer(frame.rgb, dtype=numpy.uint8).reshape(frame.size.height, frame.size.width, RGB_CHANNELS)
        centre_x, centre_y = box.centre
        crop_width, crop_height = self._crop_size(box)
        crop = self._resample(numpy, image, centre_x, centre_y, crop_width, crop_height)
        model_input = ((crop - numpy.array(PIXEL_MEAN, dtype=numpy.float32)) / numpy.array(PIXEL_STD, dtype=numpy.float32)).transpose(2, 0, 1)[
            numpy.newaxis
        ]
        simcc_x, simcc_y = session.run(None, {session.get_inputs()[0].name: model_input.astype(numpy.float32)})[:2]
        x_bins, y_bins = simcc_x[0].argmax(axis=1), simcc_y[0].argmax(axis=1)
        scores = numpy.minimum(simcc_x[0].max(axis=1), simcc_y[0].max(axis=1)).clip(0.0, 1.0)
        xs = (x_bins / SIMCC_SPLIT_RATIO / MODEL_INPUT_WIDTH * crop_width + centre_x - crop_width / 2).clip(
            0.0, frame.size.width - KEYPOINT_EDGE_MARGIN
        )
        ys = (y_bins / SIMCC_SPLIT_RATIO / MODEL_INPUT_HEIGHT * crop_height + centre_y - crop_height / 2).clip(
            0.0, frame.size.height - KEYPOINT_EDGE_MARGIN
        )
        return tuple(
            Keypoint(name=name, x=float(xs[index]), y=float(ys[index]), score=float(scores[index]))
            for index, name in enumerate(COCO17_KEYPOINT_NAMES)
        )

    def _load_session(self) -> Any:
        if self._session is None:
            onnxruntime = importlib.import_module("onnxruntime")
            options = onnxruntime.SessionOptions()
            options.intra_op_num_threads = self._config.intra_op_threads
            options.inter_op_num_threads = 1
            self._session = onnxruntime.InferenceSession(str(self._weights_file), sess_options=options, providers=[CPU_PROVIDER])
        return self._session

    @staticmethod
    def _crop_size(box: Box) -> tuple[float, float]:
        width, height = (box.x_max - box.x_min) * BOX_PADDING, (box.y_max - box.y_min) * BOX_PADDING
        aspect_ratio = MODEL_INPUT_WIDTH / MODEL_INPUT_HEIGHT
        if width > height * aspect_ratio:
            height = width / aspect_ratio
        else:
            width = height * aspect_ratio
        return max(width, 1.0), max(height, 1.0)

    @staticmethod
    def _resample(numpy: Any, image: Any, centre_x: float, centre_y: float, crop_width: float, crop_height: float) -> Any:
        source_x = numpy.floor(centre_x - crop_width / 2 + (numpy.arange(MODEL_INPUT_WIDTH) + 0.5) * crop_width / MODEL_INPUT_WIDTH).astype(
            numpy.int64
        )
        source_y = numpy.floor(centre_y - crop_height / 2 + (numpy.arange(MODEL_INPUT_HEIGHT) + 0.5) * crop_height / MODEL_INPUT_HEIGHT).astype(
            numpy.int64
        )
        valid_x = (source_x >= 0) & (source_x < image.shape[1])
        valid_y = (source_y >= 0) & (source_y < image.shape[0])
        crop = image[source_y.clip(0, image.shape[0] - 1)][:, source_x.clip(0, image.shape[1] - 1)].astype(numpy.float32)
        crop[~valid_y] = 0.0
        crop[:, ~valid_x] = 0.0
        return crop

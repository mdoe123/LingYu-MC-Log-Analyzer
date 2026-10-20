"""生成打包用图标：build/icon.png（512x512，2x 超采样）。

纯标准库实现，避免为一次性资源引入图像依赖。运行：
  python tools/make-icon.py
"""

from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path

SIZE = 512
SS = 2  # 超采样倍数
W = SIZE * SS

BG = (11, 16, 24, 255)
BORDER = (30, 42, 58, 255)
GRASS_TOP = (90, 168, 90, 255)
GRASS_SIDE = (76, 143, 76, 255)
DIRT_LEFT = (122, 74, 48, 255)
DIRT_RIGHT = (147, 90, 58, 255)
DIRT_DARK = (98, 58, 38, 255)
ACCENT = (106, 168, 255, 255)
ACCENT_SOFT = (150, 195, 255, 255)


def blend(dst: tuple[int, int, int, int], src: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
    sa = src[3] / 255
    da = dst[3] / 255
    out_a = sa + da * (1 - sa)
    if out_a <= 0:
        return (0, 0, 0, 0)
    return (
        round((src[0] * sa + dst[0] * da * (1 - sa)) / out_a),
        round((src[1] * sa + dst[1] * da * (1 - sa)) / out_a),
        round((src[2] * sa + dst[2] * da * (1 - sa)) / out_a),
        round(out_a * 255),
    )


class Canvas:
    def __init__(self, size: int) -> None:
        self.size = size
        self.px = [[(0, 0, 0, 0) for _ in range(size)] for _ in range(size)]

    def put(self, x: int, y: int, color: tuple[int, int, int, int]) -> None:
        if 0 <= x < self.size and 0 <= y < self.size:
            self.px[y][x] = blend(self.px[y][x], color)

    def rounded_rect(self, x0: float, y0: float, x1: float, y1: float, r: float, color) -> None:
        for y in range(max(0, int(y0)), min(self.size, int(math.ceil(y1)))):
            for x in range(max(0, int(x0)), min(self.size, int(math.ceil(x1)))):
                cx = min(max(x + 0.5, x0 + r), x1 - r)
                cy = min(max(y + 0.5, y0 + r), y1 - r)
                if (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r:
                    self.put(x, y, color)

    def polygon(self, points: list[tuple[float, float]], color) -> None:
        ys = [p[1] for p in points]
        for y in range(max(0, int(min(ys))), min(self.size, int(math.ceil(max(ys))))):
            sy = y + 0.5
            xs: list[float] = []
            for i in range(len(points)):
                x1, y1 = points[i]
                x2, y2 = points[(i + 1) % len(points)]
                if (y1 <= sy < y2) or (y2 <= sy < y1):
                    xs.append(x1 + (sy - y1) * (x2 - x1) / (y2 - y1))
            xs.sort()
            for i in range(0, len(xs) - 1, 2):
                for x in range(max(0, int(math.ceil(xs[i] - 0.5))), min(self.size, int(math.ceil(xs[i + 1] - 0.5)))):
                    self.put(x, y, color)

    def ring(self, cx: float, cy: float, radius: float, width: float, color) -> None:
        r_out = radius + width / 2
        r_in = radius - width / 2
        x0, x1 = int(cx - r_out - 1), int(cx + r_out + 1)
        y0, y1 = int(cy - r_out - 1), int(cy + r_out + 1)
        for y in range(max(0, y0), min(self.size, y1)):
            for x in range(max(0, x0), min(self.size, x1)):
                d = math.hypot(x + 0.5 - cx, y + 0.5 - cy)
                if r_in <= d <= r_out:
                    self.put(x, y, color)

    def thick_line(self, x1: float, y1: float, x2: float, y2: float, width: float, color) -> None:
        half = width / 2
        x0, xe = int(min(x1, x2) - half - 1), int(max(x1, x2) + half + 1)
        y0, ye = int(min(y1, y2) - half - 1), int(max(y1, y2) + half + 1)
        dx, dy = x2 - x1, y2 - y1
        length2 = dx * dx + dy * dy
        for y in range(max(0, y0), min(self.size, ye)):
            for x in range(max(0, x0), min(self.size, xe)):
                px, py = x + 0.5, y + 0.5
                t = 0 if length2 == 0 else max(0, min(1, ((px - x1) * dx + (py - y1) * dy) / length2))
                if math.hypot(px - (x1 + t * dx), py - (y1 + t * dy)) <= half:
                    self.put(x, y, color)

    def downsample(self, factor: int) -> "Canvas":
        out = Canvas(self.size // factor)
        for y in range(out.size):
            for x in range(out.size):
                r = g = b = a = 0
                for dy in range(factor):
                    for dx in range(factor):
                        pr, pg, pb, pa = self.px[y * factor + dy][x * factor + dx]
                        r += pr * pa
                        g += pg * pa
                        b += pb * pa
                        a += pa
                n = factor * factor
                if a == 0:
                    out.px[y][x] = (0, 0, 0, 0)
                else:
                    out.px[y][x] = (round(r / a), round(g / a), round(b / a), round(a / n))
        return out


def png_bytes(canvas: Canvas) -> bytes:
    raw = bytearray()
    for row in canvas.px:
        raw.append(0)
        for r, g, b, a in row:
            raw.extend((r, g, b, a))

    def chunk(kind: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + kind
            + data
            + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
        )

    header = struct.pack(">IIBBBBB", canvas.size, canvas.size, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )


def main() -> None:
    c = Canvas(W)
    s = W / 512

    # 背景与描边
    c.rounded_rect(8 * s, 8 * s, 504 * s, 504 * s, 96 * s, BORDER)
    c.rounded_rect(14 * s, 14 * s, 498 * s, 498 * s, 90 * s, BG)

    # 等距草方块
    top = [(200 * s, 140 * s), (322 * s, 202 * s), (200 * s, 264 * s), (78 * s, 202 * s)]
    left = [(78 * s, 202 * s), (200 * s, 264 * s), (200 * s, 404 * s), (78 * s, 342 * s)]
    right = [(322 * s, 202 * s), (200 * s, 264 * s), (200 * s, 404 * s), (322 * s, 342 * s)]

    c.polygon(left, DIRT_LEFT)
    c.polygon(right, DIRT_RIGHT)
    c.polygon(top, GRASS_TOP)

    # 草皮侧边
    c.polygon([(78 * s, 202 * s), (200 * s, 264 * s), (200 * s, 292 * s), (78 * s, 230 * s)], GRASS_SIDE)
    c.polygon([(322 * s, 202 * s), (200 * s, 264 * s), (200 * s, 292 * s), (322 * s, 230 * s)], GRASS_SIDE)

    # 像素化泥土纹理
    for bx, by in [(102, 248), (140, 300), (166, 330), (112, 316), (238, 346), (268, 300), (286, 262)]:
        c.put(int(bx * s), int(by * s), DIRT_DARK)
        c.put(int((bx + 6) * s), int(by * s), DIRT_DARK)
        c.put(int(bx * s), int((by + 6) * s), DIRT_DARK)

    # 放大镜
    c.ring(352 * s, 322 * s, 84 * s, 26 * s, ACCENT)
    c.ring(352 * s, 322 * s, 84 * s, 6 * s, ACCENT_SOFT)
    c.thick_line(414 * s, 384 * s, 456 * s, 426 * s, 30 * s, ACCENT)

    out = c.downsample(SS)
    target = Path(__file__).resolve().parent.parent / "build" / "icon.png"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(png_bytes(out))
    print(f"wrote {target} ({target.stat().st_size} bytes)")


if __name__ == "__main__":
    main()

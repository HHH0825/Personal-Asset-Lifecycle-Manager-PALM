"""Draw a small book-and-sprout Windows icon using the existing Pillow dependency."""

import sys
from pathlib import Path

from PIL import Image, ImageDraw


def main(output):
    size = 256
    scale = size / 64
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    def rect(box):
        return tuple(round(value * scale) for value in box)

    draw.rounded_rectangle(rect((3, 3, 61, 61)), radius=round(13 * scale), fill="#254b3d")
    draw.polygon([rect((9, 29))[0:2], rect((17, 28))[0:2], rect((25, 29))[0:2],
                  rect((32, 32))[0:2], rect((32, 52))[0:2], rect((21, 48))[0:2],
                  rect((9, 49))[0:2]], fill="#fffaf0")
    draw.polygon([rect((32, 32))[0:2], rect((40, 28))[0:2], rect((48, 28))[0:2],
                  rect((55, 30))[0:2], rect((55, 49))[0:2], rect((43, 48))[0:2],
                  rect((32, 52))[0:2]], fill="#fffaf0")
    draw.line([rect((32, 45))[0:2], rect((32, 27))[0:2]], fill="#254b3d", width=round(2.5 * scale))
    draw.ellipse(rect((17, 16, 31, 28)), fill="#b9d5a8")
    draw.ellipse(rect((33, 13, 46, 27)), fill="#b9d5a8")
    draw.ellipse(rect((46, 12, 53, 19)), fill="#c88359")
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    image.save(output, format="ICO", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])


if __name__ == "__main__":
    main(sys.argv[1])

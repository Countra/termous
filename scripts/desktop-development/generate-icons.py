"""从正式品牌资源生成开发图标；修改品牌或标记时运行，需要 Pillow 10.1 及以上。"""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[2]
scale = 2
size = 1024 * scale
with Image.open(root / "build/icon.png") as source:
    brand = source.convert("RGBA").resize((size, size), Image.Resampling.LANCZOS)

# 保留内部品牌渐变，以规则轮廓裁去原始位图的残边；不修改正式版资源。
image = Image.new("RGBA", (size, size), "#f8f9fc")
image.alpha_composite(brand)
mask = Image.new("L", (size, size))
ImageDraw.Draw(mask).rounded_rectangle(
    tuple(value * scale for value in (48, 48, 976, 976)),
    radius=208 * scale,
    fill=255,
)
image.putalpha(mask)

draw = ImageDraw.Draw(image)
draw.rounded_rectangle(
    tuple(value * scale for value in (331, 824, 693, 928)),
    radius=34 * scale,
    fill="#283e56",
)
# 使用 Pillow 内置字体，避免依赖开发机字体；留白与字距保证缩小时轮廓清晰。
font = ImageFont.load_default(size=66 * scale)
label = "BETA"
tracking = 7 * scale
width = sum(font.getlength(letter) for letter in label) + tracking * (len(label) - 1)
top, bottom = font.getbbox(label)[1::2]
x = (size - width) / 2
y = 876 * scale - (top + bottom) / 2
for letter in label:
    draw.text((x, y), letter, font=font, fill="#ffffff", stroke_width=scale)
    x += font.getlength(letter) + tracking

image = image.resize((1024, 1024), Image.Resampling.LANCZOS)
target = root / "build/development"
target.mkdir(parents=True, exist_ok=True)
image.save(target / "icon.png")
image.save(target / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
image.save(target / "icon.icns")

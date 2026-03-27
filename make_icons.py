from __future__ import annotations

import os
import shutil
import struct
import zlib
from pathlib import Path


ROOT = Path(__file__).resolve().parent
LOGO_PATH = ROOT / "src" / "assets" / "logo.png"
ICONS_DIR = ROOT / "src-tauri" / "icons"
print(f"Using logo: {LOGO_PATH}")

def _read_chunks(data: bytes):
    offset = 8
    while offset < len(data):
        if offset + 8 > len(data):
            raise ValueError("Invalid PNG: truncated chunk header")
        length = struct.unpack(">I", data[offset:offset + 4])[0]
        chunk_type = data[offset + 4:offset + 8]
        chunk_start = offset + 8
        chunk_end = chunk_start + length
        if chunk_end + 4 > len(data):
            raise ValueError("Invalid PNG: truncated chunk data")
        chunk_data = data[chunk_start:chunk_end]
        yield chunk_type, chunk_data
        offset = chunk_end + 4


def read_png_rgba(path: Path):
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"{path} is not a valid PNG file")

    width = height = None
    bit_depth = color_type = None
    idat = bytearray()
    palette = None
    transparency = None

    for chunk_type, chunk_data in _read_chunks(data):
        if chunk_type == b"IHDR":
            width, height, bit_depth, color_type, compression, flt, interlace = struct.unpack(
                ">IIBBBBB", chunk_data
            )
            if compression != 0 or flt != 0 or interlace != 0:
                raise ValueError("Only non-interlaced PNG files are supported")
        elif chunk_type == b"PLTE":
            palette = chunk_data
        elif chunk_type == b"tRNS":
            transparency = chunk_data
        elif chunk_type == b"IDAT":
            idat.extend(chunk_data)
        elif chunk_type == b"IEND":
            break

    if width is None or height is None:
        raise ValueError("Invalid PNG: missing IHDR")
    if bit_depth != 8:
        raise ValueError("Only 8-bit PNG files are supported")

    bytes_per_pixel_map = {
        0: 1,  # grayscale
        2: 3,  # rgb
        3: 1,  # indexed
        4: 2,  # grayscale + alpha
        6: 4,  # rgba
    }
    if color_type not in bytes_per_pixel_map:
        raise ValueError(f"Unsupported PNG color type: {color_type}")

    raw = zlib.decompress(bytes(idat))
    bpp = bytes_per_pixel_map[color_type]
    stride = width * bpp
    expected = (stride + 1) * height
    if len(raw) != expected:
        raise ValueError("Invalid PNG: unexpected decompressed data length")

    rows = []
    prev = bytearray(stride)

    def paeth(a: int, b: int, c: int) -> int:
        p = a + b - c
        pa = abs(p - a)
        pb = abs(p - b)
        pc = abs(p - c)
        if pa <= pb and pa <= pc:
            return a
        if pb <= pc:
            return b
        return c

    offset = 0
    for _ in range(height):
        filter_type = raw[offset]
        offset += 1
        scanline = bytearray(raw[offset:offset + stride])
        offset += stride

        if filter_type == 0:
            pass
        elif filter_type == 1:
            for i in range(stride):
                left = scanline[i - bpp] if i >= bpp else 0
                scanline[i] = (scanline[i] + left) & 0xFF
        elif filter_type == 2:
            for i in range(stride):
                up = prev[i]
                scanline[i] = (scanline[i] + up) & 0xFF
        elif filter_type == 3:
            for i in range(stride):
                left = scanline[i - bpp] if i >= bpp else 0
                up = prev[i]
                scanline[i] = (scanline[i] + ((left + up) // 2)) & 0xFF
        elif filter_type == 4:
            for i in range(stride):
                left = scanline[i - bpp] if i >= bpp else 0
                up = prev[i]
                up_left = prev[i - bpp] if i >= bpp else 0
                scanline[i] = (scanline[i] + paeth(left, up, up_left)) & 0xFF
        else:
            raise ValueError(f"Unsupported PNG filter type: {filter_type}")

        rows.append(bytes(scanline))
        prev = scanline

    pixels = bytearray()

    if color_type == 6:
        for row in rows:
            pixels.extend(row)
    elif color_type == 2:
        for row in rows:
            for i in range(0, len(row), 3):
                pixels.extend((row[i], row[i + 1], row[i + 2], 255))
    elif color_type == 0:
        for row in rows:
            for v in row:
                pixels.extend((v, v, v, 255))
    elif color_type == 4:
        for row in rows:
            for i in range(0, len(row), 2):
                g = row[i]
                a = row[i + 1]
                pixels.extend((g, g, g, a))
    elif color_type == 3:
        if palette is None:
            raise ValueError("Indexed PNG is missing PLTE chunk")
        alpha_table = transparency or b""
        for row in rows:
            for idx in row:
                base = idx * 3
                if base + 2 >= len(palette):
                    raise ValueError("Invalid palette index in PNG")
                r = palette[base]
                g = palette[base + 1]
                b = palette[base + 2]
                a = alpha_table[idx] if idx < len(alpha_table) else 255
                pixels.extend((r, g, b, a))

    return width, height, bytes(pixels)


def resize_rgba_bilinear(src_w: int, src_h: int, pixels: bytes, dst_w: int, dst_h: int) -> bytes:
    if src_w == dst_w and src_h == dst_h:
        return pixels

    out = bytearray(dst_w * dst_h * 4)

    x_ratio = src_w / dst_w
    y_ratio = src_h / dst_h

    for dy in range(dst_h):
        sy = (dy + 0.5) * y_ratio - 0.5
        y0 = max(0, int(sy))
        y1 = min(src_h - 1, y0 + 1)
        wy = sy - y0
        if sy < 0:
            y0 = y1 = 0
            wy = 0.0

        for dx in range(dst_w):
            sx = (dx + 0.5) * x_ratio - 0.5
            x0 = max(0, int(sx))
            x1 = min(src_w - 1, x0 + 1)
            wx = sx - x0
            if sx < 0:
                x0 = x1 = 0
                wx = 0.0

            idx00 = (y0 * src_w + x0) * 4
            idx10 = (y0 * src_w + x1) * 4
            idx01 = (y1 * src_w + x0) * 4
            idx11 = (y1 * src_w + x1) * 4

            out_idx = (dy * dst_w + dx) * 4

            for c in range(4):
                v00 = pixels[idx00 + c]
                v10 = pixels[idx10 + c]
                v01 = pixels[idx01 + c]
                v11 = pixels[idx11 + c]

                top = v00 * (1 - wx) + v10 * wx
                bottom = v01 * (1 - wx) + v11 * wx
                value = top * (1 - wy) + bottom * wy
                out[out_idx + c] = max(0, min(255, int(round(value))))

    return bytes(out)


def make_png_rgba(width: int, height: int, rgba: bytes) -> bytes:
    def chunk(name: bytes, payload: bytes) -> bytes:
        crc = zlib.crc32(name + payload) & 0xFFFFFFFF
        return struct.pack(">I", len(payload)) + name + payload + struct.pack(">I", crc)

    rows = []
    stride = width * 4
    for y in range(height):
        rows.append(b"\x00" + rgba[y * stride:(y + 1) * stride])

    compressed = zlib.compress(b"".join(rows), level=9)
    png = bytearray()
    png.extend(b"\x89PNG\r\n\x1a\n")
    png.extend(chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)))
    png.extend(chunk(b"IDAT", compressed))
    png.extend(chunk(b"IEND", b""))
    return bytes(png)


def write_png(path: Path, width: int, height: int, rgba: bytes) -> None:
    path.write_bytes(make_png_rgba(width, height, rgba))
    print(f"Created {path}")


def build_icns(path: Path, variants: dict[int, bytes]) -> None:
    entries = []
    type_map = {
        16: b"icp4",
        32: b"icp5",
        64: b"icp6",
        128: b"ic07",
        256: b"ic08",
        512: b"ic09",
        1024: b"ic10",
    }

    for size in sorted(type_map):
        if size not in variants:
            continue
        png_data = variants[size]
        entry = type_map[size] + struct.pack(">I", len(png_data) + 8) + png_data
        entries.append(entry)

    body = b"".join(entries)
    header = b"icns" + struct.pack(">I", len(body) + 8)
    path.write_bytes(header + body)
    print(f"Created {path}")


def build_ico(path: Path, variants: dict[int, bytes]) -> None:
    sizes = [16, 24, 32, 48, 64, 128, 256]
    sizes = [s for s in sizes if s in variants]
    if not sizes:
        raise ValueError("No icon sizes available for ICO generation")

    header = struct.pack("<HHH", 0, 1, len(sizes))
    directory = bytearray()
    data_blocks = bytearray()
    offset = 6 + 16 * len(sizes)

    for size in sizes:
        png_data = variants[size]
        width_byte = 0 if size >= 256 else size
        height_byte = 0 if size >= 256 else size
        directory.extend(
            struct.pack(
                "<BBBBHHII",
                width_byte,
                height_byte,
                0,
                0,
                1,
                32,
                len(png_data),
                offset,
            )
        )
        data_blocks.extend(png_data)
        offset += len(png_data)

    path.write_bytes(header + directory + data_blocks)
    print(f"Created {path}")


def main() -> None:
    if not LOGO_PATH.exists():
        raise FileNotFoundError(f"Logo file not found: {LOGO_PATH}")

    ICONS_DIR.mkdir(parents=True, exist_ok=True)

    src_w, src_h, src_pixels = read_png_rgba(LOGO_PATH)

    sizes = [
        16, 24, 30, 32, 44, 48, 64, 71, 72, 89,
        96, 107, 128, 142, 150, 256, 284, 310, 512, 1024,
    ]
    png_variants: dict[int, bytes] = {}

    for size in sizes:
        rgba = resize_rgba_bilinear(src_w, src_h, src_pixels, size, size)
        png_variants[size] = make_png_rgba(size, size, rgba)

    # Primary Tauri bundle icons
    (ICONS_DIR / "32x32.png").write_bytes(png_variants[32])
    print(f"Created {ICONS_DIR / '32x32.png'}")

    (ICONS_DIR / "64x64.png").write_bytes(png_variants[64])
    print(f"Created {ICONS_DIR / '64x64.png'}")

    (ICONS_DIR / "128x128.png").write_bytes(png_variants[128])
    print(f"Created {ICONS_DIR / '128x128.png'}")

    (ICONS_DIR / "128x128@2x.png").write_bytes(png_variants[256])
    print(f"Created {ICONS_DIR / '128x128@2x.png'}")

    (ICONS_DIR / "icon.png").write_bytes(png_variants[512])
    print(f"Created {ICONS_DIR / 'icon.png'}")

    # Windows / Store / legacy square icons
    square_map = {
        "Square30x30Logo.png": 30,
        "Square44x44Logo.png": 44,
        "Square71x71Logo.png": 71,
        "Square89x89Logo.png": 89,
        "Square107x107Logo.png": 107,
        "Square142x142Logo.png": 142,
        "Square150x150Logo.png": 150,
        "Square284x284Logo.png": 284,
        "Square310x310Logo.png": 310,
        "StoreLogo.png": 50,  # special case below
    }

    for filename, size in square_map.items():
        if filename == "StoreLogo.png":
            rgba = resize_rgba_bilinear(src_w, src_h, src_pixels, 50, 50)
            write_png(ICONS_DIR / filename, 50, 50, rgba)
        else:
            (ICONS_DIR / filename).write_bytes(png_variants[size])
            print(f"Created {ICONS_DIR / filename}")

    # icns / ico
    build_icns(ICONS_DIR / "icon.icns", png_variants)
    build_ico(ICONS_DIR / "icon.ico", png_variants)

    # If android/ios folders already exist, refresh common launcher assets that are png-based.
    android_targets = {
        "mipmap-mdpi/ic_launcher.png": 48,
        "mipmap-mdpi/ic_launcher_round.png": 48,
        "mipmap-hdpi/ic_launcher.png": 72,
        "mipmap-hdpi/ic_launcher_round.png": 72,
        "mipmap-xhdpi/ic_launcher.png": 96,
        "mipmap-xhdpi/ic_launcher_round.png": 96,
        "mipmap-xxhdpi/ic_launcher.png": 144,
        "mipmap-xxhdpi/ic_launcher_round.png": 144,
        "mipmap-xxxhdpi/ic_launcher.png": 192,
        "mipmap-xxxhdpi/ic_launcher_round.png": 192,
    }

    android_dir = ICONS_DIR / "android"
    if android_dir.exists():
        for rel_path, size in android_targets.items():
            target = android_dir / rel_path
            target.parent.mkdir(parents=True, exist_ok=True)
            rgba = resize_rgba_bilinear(src_w, src_h, src_pixels, size, size)
            write_png(target, size, size, rgba)

        # Foreground assets use the same image for now.
        foreground_targets = {
            "mipmap-mdpi/ic_launcher_foreground.png": 108,
            "mipmap-hdpi/ic_launcher_foreground.png": 162,
            "mipmap-xhdpi/ic_launcher_foreground.png": 216,
            "mipmap-xxhdpi/ic_launcher_foreground.png": 324,
            "mipmap-xxxhdpi/ic_launcher_foreground.png": 432,
        }
        for rel_path, size in foreground_targets.items():
            target = android_dir / rel_path
            target.parent.mkdir(parents=True, exist_ok=True)
            rgba = resize_rgba_bilinear(src_w, src_h, src_pixels, size, size)
            write_png(target, size, size, rgba)

    ios_dir = ICONS_DIR / "ios"
    if ios_dir.exists():
        ios_sizes = {
            "AppIcon-20x20@1x.png": 20,
            "AppIcon-20x20@2x.png": 40,
            "AppIcon-20x20@2x-1.png": 40,
            "AppIcon-20x20@3x.png": 60,
            "AppIcon-29x29@1x.png": 29,
            "AppIcon-29x29@2x.png": 58,
            "AppIcon-29x29@2x-1.png": 58,
            "AppIcon-29x29@3x.png": 87,
            "AppIcon-40x40@1x.png": 40,
            "AppIcon-40x40@2x.png": 80,
            "AppIcon-40x40@2x-1.png": 80,
            "AppIcon-40x40@3x.png": 120,
            "AppIcon-60x60@2x.png": 120,
            "AppIcon-60x60@3x.png": 180,
            "AppIcon-76x76@1x.png": 76,
            "AppIcon-76x76@2x.png": 152,
            "AppIcon-83.5x83.5@2x.png": 167,
            "AppIcon-1024x1024@1x.png": 1024,
        }
        for filename, size in ios_sizes.items():
            target = ios_dir / filename
            rgba = resize_rgba_bilinear(src_w, src_h, src_pixels, size, size)
            write_png(target, size, size, rgba)

    print("Done")


if __name__ == "__main__":
    main()
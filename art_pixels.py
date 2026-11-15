"""RGBA pixel operations for the integrated artwork builders."""
from math import floor
import struct
import zlib


TRANSPARENT = (0, 0, 0, 0)


class Picture:
    def __init__(self, width, height, pixels=None):
        self.width, self.height = width, height
        self.pixels = list(pixels) if pixels is not None else [TRANSPARENT] * (width * height)

    @property
    def size(self):
        return self.width, self.height

    def __getitem__(self, point):
        x, y = point
        return self.pixels[y * self.width + x]

    def __setitem__(self, point, colour):
        x, y = point
        self.pixels[y * self.width + x] = colour

    def copy(self):
        return Picture(*self.size, self.pixels)

    def bounds(self):
        left, top, right, bottom = self.width, self.height, 0, 0
        for i, pixel in enumerate(self.pixels):
            if pixel[3]:
                y, x = divmod(i, self.width)
                left, top = min(left, x), min(top, y)
                right, bottom = max(right, x+1), max(bottom, y+1)
        return (left, top, right, bottom) if right else None

    def crop(self, bounds):
        left, top, right, bottom = bounds
        return Picture(right-left, bottom-top,
                       (self[x, y] for y in range(top, bottom) for x in range(left, right)))

    def sample(self, width, height, left, top, step):
        def coordinates(start, count):
            position = start + step/2
            for _ in range(count):
                yield floor(position)
                position += step

        result = Picture(width, height)
        xs = list(coordinates(left, width))
        for y, sy in enumerate(coordinates(top, height)):
            if 0 <= sy < self.height:
                for x, sx in enumerate(xs):
                    if 0 <= sx < self.width:
                        result[x, y] = self[sx, sy]
        return result


def read_overlay(data, size):
    """Read the bundled non-interlaced RGBA8 button layers."""
    if not data.startswith(b'\x89PNG\r\n\x1a\n') or len(data) < 33:
        raise ValueError('Invalid AI button PNG')
    width, height, depth, colour, compression, filter_method, interlace = struct.unpack_from('>IIBBBBB', data, 16)
    if data[8:16] != b'\0\0\0\rIHDR' or (width, height) != size or (
            depth, colour, compression, filter_method, interlace) != (8, 6, 0, 0, 0):
        raise ValueError('Expected an RGBA8 AI button PNG with matching dimensions')
    chunks = []
    offset = 8
    while offset + 12 <= len(data):
        length, tag = struct.unpack_from('>I4s', data, offset)
        end = offset + 8 + length
        if end+4 > len(data):
            raise ValueError('Truncated AI button PNG')
        if tag == b'IDAT':
            chunks.append(data[offset+8:end])
        if tag == b'IEND':
            break
        offset = end + 4
    stride = width * 4
    limit = height * (stride+1)
    decoder = zlib.decompressobj()
    filtered = decoder.decompress(b''.join(chunks), limit+1)
    if len(filtered) != limit or not decoder.eof:
        raise ValueError('Invalid AI button PNG pixel data')
    previous = bytearray(stride)
    pixels = bytearray()
    for offset in range(0, len(filtered), stride+1):
        mode = filtered[offset]
        row = bytearray(filtered[offset+1:offset+1+stride])
        if mode > 4:
            raise ValueError('Unknown PNG row filter')
        for i in range(stride):
            left = row[i-4] if i >= 4 else 0
            above = previous[i]
            diagonal = previous[i-4] if i >= 4 else 0
            if mode == 4:
                p = left + above - diagonal
                predictor = min((left, above, diagonal), key=lambda n: abs(p-n))
            else:
                predictor = (0, left, above, (left+above)//2)[mode]
            row[i] = (row[i] + predictor) & 255
        pixels.extend(row)
        previous = row
    return picture_from_bytes(width, height, pixels)


def picture_from_bytes(width, height, rgba):
    return Picture(width, height, struct.iter_unpack('4B', rgba))


def over(background, foreground):
    """Composite unpremultiplied RGBA using rounded 8-bit output."""
    if background.size != foreground.size:
        raise ValueError('Overlay dimensions must match the button')
    pixels = []
    for back, front in zip(background.pixels, foreground.pixels):
        alpha = front[3]
        if not alpha:
            pixels.append(back)
            continue
        back_weight = back[3] * (255-alpha)
        front_weight = alpha * 255
        total = back_weight + front_weight
        pixels.append(tuple((b*back_weight + f*front_weight + total//2)//total
                            for b, f in zip(back[:3], front[:3])) + ((total+127)//255,))
    return Picture(*background.size, pixels)

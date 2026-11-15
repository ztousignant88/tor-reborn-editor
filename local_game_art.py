"""Read and rebuild icon textures from the selected game's own artwork."""
from functools import lru_cache
from io import BytesIO
import struct
from zipfile import ZipFile

from art_pixels import picture_from_bytes
from bc7 import decode_bc7
from tools.menu_mods.compiler.spell_icons import TextureArc, encode_block
from tools.menu_mods.compiler.tor_formats import DatArchive, Pakd
from tools.menu_mods.compiler.torcrypt import decrypt

def texture_bank(data):
    pack = Pakd(DatArchive.read(data).pack)
    arc = TextureArc(pack.entry(0))
    return {row.name: row.body[32:32+struct.unpack_from('<I', row.body)[0]] for row in arc.resources}


def rename_texture(texture, name):
    begin = struct.unpack_from('<I', texture, 36)[0]
    end = struct.unpack_from('<I', texture, 24)[0]
    encoded = name.encode('ascii') + b'\0'
    if not 52 <= begin <= end - len(encoded):
        raise ValueError(f'Texture header is too small for {name}')
    return texture[:begin] + encoded.ljust(end-begin, b'\0') + texture[end:]


def decode_texture(texture):
    width, height, stride = struct.unpack_from('<HHI', texture, 8)
    offset = struct.unpack_from('<I', texture, 24)[0]
    if texture[16] != 13 or width % 4 or height % 4 or stride != width * 4:
        raise ValueError('Expected an aligned BC7 texture')
    return picture_from_bytes(width, height, decode_bc7(texture[offset:offset+width*height], width, height))


@lru_cache(maxsize=65536)
def encode_pixels(block):
    return encode_block(list(block))


def rebuild_texture(template, name, image, original=None):
    renamed = rename_texture(template, name)
    offset = struct.unpack_from('<I', renamed, 24)[0]
    w, h = struct.unpack_from('<HH', renamed, 8)
    if image.size != (w, h):
        raise ValueError(f'Wrong dimensions for {name}')
    out = bytearray(renamed)
    for y in range(0, h, 4):
        for x in range(0, w, 4):
            points = [(x+dx, y+dy) for dy in range(4) for dx in range(4)]
            block = tuple(image[p] if image[p][3] else (0, 0, 0, 0) for p in points)
            if original is not None and all(original[p] == px or not (original[p][3] or px[3]) for p, px in zip(points, block)):
                continue
            at = offset + ((y//4)*(w//4) + x//4)*16
            out[at:at+16] = encode_pixels(block)
    return bytes(out)


def indexed_object(data):
    with ZipFile(BytesIO(decrypt(data))) as archive:
        names = archive.namelist()
        if len(names) != 1 or not names[0].endswith('.pack'):
            raise ValueError('Unsupported sprite archive')
        body = Pakd(Pakd(archive.read(names[0])).entry(0)).entry(0)
    tex = 16 + struct.unpack_from('<I', body, 20)[0]
    _, length, start = struct.unpack_from('<III', body, tex)
    w, h, bits = struct.unpack_from('<HHH', body, tex+20)
    pixels = body[tex+start:tex+start+length]
    if bits == 4:
        pixels = bytes(n for byte in pixels for n in (byte & 15, byte >> 4))
    if bits not in (4, 8) or len(pixels) < w*h:
        raise ValueError('Unsupported indexed sprite sheet')
    return w, h, pixels[:w*h]


def battle_palettes(pack):
    bank = Pakd(pack.entry(2))
    for at in range(len(bank)):
        data = bank.entry(at)
        if len(data) < 36 or data[:4] != b'\0'*4:
            continue
        texture, base, table, count = struct.unpack_from('<4I', data, 20)
        if texture != base or not 20 <= count <= 256:
            continue
        result = []
        for i in range(count):
            start = 16 + base + struct.unpack_from('<I', data, 16+table+4*i)[0]
            length, offset = struct.unpack_from('<II', data, start+4)
            result.append(data[start+offset:start+offset+length])
        return result
    raise ValueError('Battle sprite palettes are missing')

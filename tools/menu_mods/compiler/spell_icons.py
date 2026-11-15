"""Bounded ARC append writer and BC7 mode-6 encoder for original 64px art.

ARC/BTX layout references: Gibbed.Reborn.FileFormats (zlib; see notices).
This independently written encoder follows Microsoft's BC7 mode-6 layout.
Existing resource bodies and IDs are preserved; the directory stays hash-sorted.
"""
from dataclasses import dataclass
import struct

from .tor_formats import FormatError, Pakd, u16, u32


def align(value: int) -> int:
    return (value + 31) & ~31


def name_hash(name: str) -> int:
    value = 0
    for char in name.encode("ascii"):
        value = (value * 33 + char) & 0xFFFFFFFF
    return (value + (value >> 5)) & 0xFFFFFFFF


@dataclass
class Resource:
    name: str
    identifier: int
    index: int
    record: bytes
    body: bytes


class TextureArc:
    def __init__(self, data: bytes):
        if data[:4] != b"ARC\0" or u16(data, 4) != 0x100:
            raise FormatError("Unsupported texture ARC")
        count, n = u16(data, 6), u16(data, 8)
        if not count or count != n or 48 + 4*n > len(data):
            raise FormatError("Expected one resource offset per texture")
        offsets = [u32(data, 48+4*i) for i in range(n)]
        if offsets != sorted(set(offsets)) or any(o % 32 for o in offsets):
            raise FormatError("Invalid ARC resource offsets")
        pos = align(48+4*n)
        last = offsets[-1]
        last_end = last+align(32+u32(data, last))
        if last_end > len(data) or len(data)-last_end > 31 or any(data[last_end:]):
            raise FormatError("Unexpected ARC trailer")
        self.trailer = data[last_end:]
        self.resources = []
        for _ in range(count):
            if pos+20 > len(data):
                raise FormatError("Truncated ARC directory")
            kind, small, index, hashed, c, flag, length, f, big = struct.unpack_from("<IHHIBBBBI", data, pos)
            end = pos + align(20+length)
            if kind != 0x786574 or c or f or flag not in (0, 1) or index >= n or end > offsets[0]:
                raise FormatError("Unsupported ARC texture record")
            name = data[pos+20:pos+20+length].rstrip(b"\0").decode("ascii")
            if not name or name_hash(name) != hashed:
                raise FormatError("ARC name hash mismatch")
            start = offsets[index]
            stop = offsets[index+1] if index+1 < n else last_end
            if start+32 > stop or u16(data, start+4) != 32 or start+32+u32(data, start) > stop:
                raise FormatError("Invalid ARC resource wrapper")
            if data[start+32:start+36] != b"btx\0":
                raise FormatError("Expected BTX texture")
            self.resources.append(Resource(name, big if flag else small, index,
                                           data[pos:end], data[start:stop]))
            pos = end
        if pos != offsets[0] or {r.index for r in self.resources} != set(range(n)):
            raise FormatError("Unsupported ARC directory gap or duplicate index")
        if len({r.name for r in self.resources}) != n or len({r.identifier for r in self.resources}) != n:
            raise FormatError("Duplicate texture identity")
        # Command archives may use resource-ID order. New directories are hash-sorted.
        self.data = data

    def append(self, textures: dict[str, bytes]) -> bytes:
        if not textures:
            return self.data
        old = self.resources
        if set(textures) & {r.name for r in old} or len(old)+len(textures) > 65535:
            raise FormatError("Cannot append duplicate or excessive textures")
        resources = list(old)
        next_id = max(r.identifier for r in old)+1
        for name, btx in sorted(textures.items()):
            encoded = name.encode("ascii")+b"\0"
            if len(encoded) > 255 or btx[:4] != b"btx\0":
                raise FormatError("Invalid new texture")
            index = len(resources)
            record = struct.pack("<IHHIBBBBI", 0x786574, 0, index, name_hash(name), 0, 1, len(encoded), 0, next_id)
            record = (record+encoded).ljust(align(20+len(encoded)), b"\0")
            body = struct.pack("<IH", len(btx), 32).ljust(32, b"\0")+btx
            body = body.ljust(align(len(body)), b"\0")
            resources.append(Resource(name, next_id, index, record, body))
            next_id += 1
        n = len(resources)
        directory = sorted(resources, key=lambda r: name_hash(r.name))
        header = bytearray(self.data[:48])
        struct.pack_into("<HH", header, 6, n, n)
        start = align(48+4*n)+sum(len(r.record) for r in directory)
        offsets, bodies = [], bytearray()
        for resource in sorted(resources, key=lambda r: r.index):
            offsets.append(start+len(bodies))
            bodies.extend(resource.body)
        result = bytes(header)+struct.pack(f"<{n}I", *offsets)
        result = result.ljust(align(len(result)), b"\0")+b"".join(r.record for r in directory)+bodies+self.trailer
        verify = TextureArc(result)
        lookup = {r.name: r for r in verify.resources}
        for resource in old:
            actual = lookup[resource.name]
            if (actual.record, actual.body) != (resource.record, resource.body):
                raise FormatError("Existing texture changed while appending")
        return result


def replace_single_pak(pack: Pakd, arc: bytes) -> bytes:
    if len(pack) != 1 or pack.total_size != len(pack.data):
        raise FormatError("Expected a single-entry aligned texture PAKD")
    header = bytearray(pack.data[:pack.offsets[0]])
    struct.pack_into("<I", header, 12, len(header)+len(arc))
    result = bytes(header)+arc
    if Pakd(result).entry(0) != arc:
        raise FormatError("Texture PAKD verification failed")
    return result


WEIGHTS = (0, 4, 9, 13, 17, 21, 26, 30, 34, 38, 43, 47, 51, 55, 60, 64)


def encode_block(pixels: list[tuple]) -> bytes:
    """Fit one RGBA line; refine endpoints, then store valid mode-6 bits."""
    # A farthest pair is a stable starting line, including transparent edges.
    def distance(a, b):
        return sum((x-y)**2 for x, y in zip(a, b))
    a = max(pixels, key=lambda p: distance(p, pixels[0]))
    b = max(pixels, key=lambda p: distance(p, a))

    def quantize(endpoint):
        candidates = []
        for parity in (0, 1):
            values = tuple(2*max(0, min(127, round((v-parity)/2)))+parity for v in endpoint)
            error = distance(values, endpoint)
            # Exact transparent/opaque endpoints avoid a faint block-shaped haze.
            if endpoint[3] < 0.5 and parity or endpoint[3] > 254.5 and not parity:
                error += 1e6
            candidates.append((error, values))
        return min(candidates)[1]

    def choose(a, b):
        palette = [tuple(((64-w)*x+w*y+32)//64 for x, y in zip(a, b)) for w in WEIGHTS]
        return [min(range(16), key=lambda i: distance(p, palette[i])) for p in pixels]

    best = None
    for _ in range(4):
        qa, qb = quantize(a), quantize(b)
        indices = choose(qa, qb)
        palette = [tuple(((64-w)*x+w*y+32)//64 for x, y in zip(qa, qb)) for w in WEIGHTS]
        error = sum(distance(p, palette[i]) for p, i in zip(pixels, indices))
        if best is None or error < best[0]:
            best = (error, qa, qb, indices)
        ts = [WEIGHTS[i]/64 for i in indices]
        aa, bb, ab = sum((1-t)**2 for t in ts), sum(t*t for t in ts), sum(t*(1-t) for t in ts)
        det = aa*bb-ab*ab
        if det < 1e-8:
            break
        xa = [sum((1-t)*p[c] for t, p in zip(ts, pixels)) for c in range(4)]
        xb = [sum(t*p[c] for t, p in zip(ts, pixels)) for c in range(4)]
        a = tuple(max(0, min(255, (bb*x-ab*y)/det)) for x, y in zip(xa, xb))
        b = tuple(max(0, min(255, (aa*y-ab*x)/det)) for x, y in zip(xa, xb))
    _, a, b, indices = best
    if indices[0] >= 8:
        a, b = b, a
        indices = [15-i for i in indices]
    bits, shift = 64, 7  # six zero bits followed by one: mode 6
    for channel in range(4):
        for endpoint in (a, b):
            bits |= (endpoint[channel] >> 1) << shift
            shift += 7
    for endpoint in (a, b):
        bits |= (endpoint[0] & 1) << shift
        shift += 1
    for i, index in enumerate(indices):
        bits |= index << shift
        shift += 3 if i == 0 else 4
    assert shift == 128
    return bits.to_bytes(16, "little")


def encode_bc7(image) -> bytes:
    if image.mode != "RGBA" or image.size != (64, 64):
        raise FormatError("Spell icon must be 64 x 64 RGBA")
    return b"".join(encode_block([image.getpixel((x+dx, y+dy)) for dy in range(4) for dx in range(4)])
                    for y in range(0, 64, 4) for x in range(0, 64, 4))


def make_btx(template: bytes, name: str, pixels: bytes) -> bytes:
    encoded = name.encode("ascii")+b"\0"
    if (len(template) != 4176 or template[:8] != b"btx\0\x03\x01\0\0" or
        template[16] != 13 or u32(template, 24) != 80 or len(encoded) != 16 or len(pixels) != 4096):
        raise FormatError("Unexpected native spell texture layout")
    result = bytearray(template)
    result[52:68] = encoded
    result[80:] = pixels
    return bytes(result)



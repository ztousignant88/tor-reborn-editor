"""Bounded Reborn SAVEDATA reader/writer, derived from the supplied PC code.

PC 1.0.2: block encode 0x191A10, decode 0x191BB0, MD5 0x1EC810,
XOR helper 0x1A0AA0. Save obfuscation shares the existing Gibbed tables.
Only fixed-size block changes are supported; other bytes remain identical.
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import struct

from .tor_formats import FormatError, _crypt, u32

SIGNATURE = bytes.fromhex("5341564544415441b2fb45a701e5a0dc")
MAIN_TAG = 0x10000001


def decode_payload(data: bytes, digest: bytes) -> bytes:
    if not data:
        raise FormatError("Empty save block")
    result = _crypt._rotl(data, 2)
    _crypt._xor(result, 0, _crypt.T2, 4)
    _crypt._xor(result, 0, _crypt.T3, (sum(digest) + 3) & 255)
    return bytes(result)


def encode_payload(data: bytes, digest: bytes) -> bytes:
    if not data:
        raise FormatError("Empty save block")
    result = bytearray(data)
    _crypt._xor(result, 0, _crypt.T3, (sum(digest) + 3) & 255)
    _crypt._xor(result, 0, _crypt.T2, 4)
    return bytes(_crypt._rotr(result, 2))


@dataclass(frozen=True)
class SaveBlock:
    tag: int
    offset: int
    total_size: int
    payload: bytes


class SaveArchive:
    def __init__(self, data: bytes, *, max_block_size: int = 4 * 1024 * 1024):
        if len(data) < 60 or data[:16] != SIGNATURE:
            raise FormatError("Unsupported save signature")
        count = u32(data, 16)
        if not 1 <= count <= 16:
            raise FormatError("Invalid save block count")
        self.original = data
        self.max_block_size = max_block_size
        self.blocks = {}
        offset = 60
        for _ in range(count):
            if offset + 84 > len(data):
                raise FormatError("Truncated save block header")
            tag, reserved, flags, size, total = struct.unpack_from("<5I", data, offset)
            if not 0x10000000 <= tag <= 0x10000004 or tag in self.blocks:
                raise FormatError("Unknown or duplicate save block")
            if reserved or flags != 3:
                raise FormatError("Unsupported save block flags")
            if not 0 < size <= self.max_block_size or total != ((84 + size + 3) & ~3):
                raise FormatError("Invalid save block size/alignment")
            if offset + total > len(data):
                raise FormatError("Save block exceeds file")
            digest = data[offset + 20:offset + 36]
            encoded = data[offset + 84:offset + 84 + size]
            payload = decode_payload(encoded, digest)
            if hashlib.md5(payload).digest() != digest:
                raise FormatError("Save block checksum mismatch")
            if encode_payload(payload, digest) != encoded:
                raise FormatError("Save block encoding does not round-trip")
            self.blocks[tag] = SaveBlock(tag, offset, total, payload)
            offset += total
        if offset != len(data):
            raise FormatError("Unexpected trailing save data")

    def rebuild(self, replacements: dict[int, bytes]) -> bytes:
        result = bytearray(self.original)
        for tag, payload in replacements.items():
            if tag not in self.blocks:
                raise FormatError("Save block is missing")
            block = self.blocks[tag]
            if len(payload) != len(block.payload):
                raise FormatError("Save block resizing is not supported")
            if payload == block.payload:
                continue
            digest = hashlib.md5(payload).digest()
            result[block.offset + 20:block.offset + 36] = digest
            result[block.offset + 84:block.offset + 84 + len(payload)] = encode_payload(payload, digest)
        encoded = bytes(result)
        checked = SaveArchive(encoded, max_block_size=self.max_block_size)
        if any(checked.blocks[tag].payload != replacements.get(tag, block.payload)
               for tag, block in self.blocks.items()):
            raise FormatError("Save rebuild validation failed")
        return encoded


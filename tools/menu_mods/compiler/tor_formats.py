"""Lossless game containers and bounded binary readers for the restoration tools.

Format references: Gibbed.LetUsClingTogether (zlib), Asvel's datamining
patterns (Unlicense). No game data is included in this module.
"""
from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
import importlib.util
import struct
import zipfile


class FormatError(ValueError):
    pass


def u16(data: bytes, offset: int) -> int:
    if offset < 0 or offset + 2 > len(data):
        raise FormatError("u16 outside payload")
    return struct.unpack_from("<H", data, offset)[0]


def u32(data: bytes, offset: int) -> int:
    if offset < 0 or offset + 4 > len(data):
        raise FormatError("u32 outside payload")
    return struct.unpack_from("<I", data, offset)[0]


_crypt_path = Path(__file__).resolve().parent / "torcrypt.py"
_spec = importlib.util.spec_from_file_location("restoration_crypt", _crypt_path)
_crypt = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_crypt)


@dataclass
class DatArchive:
    original: bytes
    zip_info: zipfile.ZipInfo
    pack: bytes
    comment: bytes

    @classmethod
    def read(cls, data: bytes, member: str | None = "pack") -> "DatArchive":
        if len(data) < 16:
            raise FormatError("DAT is too short")
        try:
            with zipfile.ZipFile(BytesIO(_crypt.decrypt(data))) as archive:
                entries = archive.infolist()
                if len(entries) != 1 or (member is not None and entries[0].filename != member) or entries[0].is_dir():
                    raise FormatError("Expected a ZIP with a single pack member")
                info = entries[0]
                return cls(data, info, archive.read(info), archive.comment)
        except (zipfile.BadZipFile, RuntimeError) as exc:
            raise FormatError(f"Invalid DAT ZIP: {exc}") from exc

    def rebuild(self, pack: bytes) -> bytes:
        if pack == self.pack:
            return self.original
        output = BytesIO()
        with zipfile.ZipFile(output, "w") as archive:
            archive.comment = self.comment
            archive.writestr(self.zip_info, pack)
        encoded = bytes(_crypt.encrypt(output.getvalue()))
        if DatArchive.read(encoded, self.zip_info.filename).pack != pack:
            raise FormatError("DAT verification failed")
        return encoded


class Pakd:
    """Preserve headers, IDs, and padding; replace only fixed-size entries."""
    def __init__(self, data: bytes):
        if len(data) < 16 or data[:4] != b"pakd":
            raise FormatError("Not a PAKD container")
        count = u32(data, 4)
        if count > (len(data) - 12) // 4:
            raise FormatError("Invalid PAKD entry count")
        self.offsets = [u32(data, 8 + i * 4) for i in range(count)]
        self.total_size = u32(data, 8 + count * 4)
        if self.total_size > len(data) or self.total_size < 12 + count * 4:
            raise FormatError("Invalid PAKD total size")
        if self.offsets and (self.offsets[0] < 12 + count * 4 or
                             self.offsets[-1] > self.total_size):
            raise FormatError("Invalid PAKD entry offset")
        if self.offsets != sorted(self.offsets):
            raise FormatError("PAKD offsets are not ordered")
        self.data = data

    def __len__(self) -> int:
        return len(self.offsets)

    def entry(self, index: int) -> bytes:
        if not 0 <= index < len(self):
            raise FormatError(f"PAKD entry {index} is out of range")
        end = self.offsets[index + 1] if index + 1 < len(self) else self.total_size
        return self.data[self.offsets[index]:end]

    def replace(self, replacements: dict[int, bytes]) -> bytes:
        result = bytearray(self.data)
        for index, payload in replacements.items():
            if len(payload) != len(self.entry(index)):
                raise FormatError("Fixed-size PAKD patch cannot resize entries")
            start = self.offsets[index]
            result[start:start + len(payload)] = payload
        return bytes(result)


class Xlce:
    def __init__(self, data: bytes):
        if len(data) < 16 or data[:4] != b"xlce":
            raise FormatError("Not an XLCE table")
        self.count, self.header, self.row_size = struct.unpack_from("<III", data, 4)
        if self.header < 16 or self.row_size == 0 or self.header + self.count * self.row_size > len(data):
            raise FormatError("Invalid XLCE dimensions")
        self.data = data

    def row(self, index: int) -> bytes:
        if not 0 <= index < self.count:
            raise FormatError(f"XLCE row {index} is out of range")
        start = self.header + index * self.row_size
        return self.data[start:start + self.row_size]

    def replace(self, replacements: dict[int, bytes]) -> bytes:
        result = bytearray(self.data)
        for index, row in replacements.items():
            self.row(index)
            if len(row) != self.row_size:
                raise FormatError("Replacement row has the wrong size")
            start = self.header + index * self.row_size
            result[start:start + self.row_size] = row
        return bytes(result)


def decompress_mlz0(data: bytes, maximum_size: int = 128 * 1024 * 1024) -> bytes:
    """MLZ0 wraps an LZ4 block. Validate every reference and declared size."""
    if data[:4] != b"MLZ0":
        raise FormatError("Not an MLZ0 asset")
    size = u32(data, 4)
    if size > maximum_size:
        raise FormatError("MLZ0 output exceeds limit")
    source = memoryview(data)[8:]
    output = bytearray()
    cursor = 0

    def length(base: int) -> int:
        nonlocal cursor
        if base == 15:
            while True:
                if cursor >= len(source):
                    raise FormatError("Truncated LZ4 length")
                extra = source[cursor]
                cursor += 1
                base += extra
                if extra != 255:
                    break
        return base

    while cursor < len(source):
        token = source[cursor]
        cursor += 1
        literals = length(token >> 4)
        if cursor + literals > len(source) or len(output) + literals > size:
            raise FormatError("LZ4 literal exceeds bounds")
        output.extend(source[cursor:cursor + literals])
        cursor += literals
        if cursor == len(source):
            break
        if cursor + 2 > len(source):
            raise FormatError("Truncated LZ4 match offset")
        distance = source[cursor] | source[cursor + 1] << 8
        cursor += 2
        match_length = length(token & 15) + 4
        if distance == 0 or distance > len(output) or len(output) + match_length > size:
            raise FormatError("Invalid LZ4 back reference")
        for _ in range(match_length):
            output.append(output[-distance])
    if len(output) != size:
        raise FormatError("MLZ0 declared size does not match output")
    return bytes(output)


def filetable_records(data: bytes) -> list[dict]:
    """Resolve Reborn's directory/file IDs to external paths and size slots."""
    if len(data) < 68 or u16(data, 0) != 0x1EF1 or u16(data, 6) != 4:
        raise FormatError("Unsupported FileTable header")
    names, directories = u16(data, 2), u16(data, 4)
    file_offset, external_offset = u32(data, 8), u32(data, 12)
    if not file_offset <= external_offset < len(data):
        raise FormatError("Not a Reborn external FileTable")
    dir_start = 68 + names * 8
    batch_start = dir_start + directories * 24
    if batch_start > file_offset:
        raise FormatError("Invalid FileTable directory table")
    records = []
    for index in range(directories):
        pos = dir_start + index * 24
        directory_id = u16(data, pos)
        batches = u16(data, pos + 10)
        batch_offset = u32(data, pos + 16)
        if batch_offset % 8:
            raise FormatError("Invalid batch alignment")
        for batch in range(batches):
            bpos = batch_start + batch_offset + batch * 8
            if bpos + 8 > file_offset:
                raise FormatError("Batch outside FileTable header")
            base_id, count, raw = struct.unpack_from("<HHI", data, bpos)
            if raw >> 29:
                raise FormatError("Expected Reborn batch flags")
            offset = raw & 0x1FFFFFFF
            for relative in range(count):
                pointer = file_offset + offset + relative * 4
                if pointer + 4 > external_offset:
                    raise FormatError("File pointer outside index")
                path_offset = external_offset + u32(data, pointer) * 8
                path_end = data.find(b"\0", path_offset)
                if path_end < 0 or path_end + 5 > len(data):
                    raise FormatError("Invalid external file record")
                records.append({"directory_id": directory_id,
                                "file_id": base_id + relative,
                                "path": data[path_offset:path_end].decode("ascii"),
                                "size": u32(data, path_end + 1),
                                "size_offset": path_end + 1})
    return records


def update_file_sizes(data: bytes, sizes: dict[str, tuple[int, int]]) -> bytes:
    """sizes maps paths to (expected old size, new size); preserve all else."""
    result = bytearray(data)
    found = set()
    for record in filetable_records(data):
        path = record["path"]
        if path not in sizes:
            continue
        old, new = sizes[path]
        if record["size"] != old or not 0 <= new <= 0xFFFFFFFF:
            raise FormatError(f"FileTable size precondition failed: {path}")
        struct.pack_into("<I", result, record["size_offset"], new)
        found.add(path)
    if found != set(sizes):
        raise FormatError(f"Paths missing from FileTable: {set(sizes) - found}")
    return bytes(result)


def efx_roots(data: bytes) -> dict[int, dict]:
    """Index numeric root definitions and their child-record counts in EFX0011."""
    if data[:8] != b"EFX0011\0" or u32(data, 12) != len(data):
        raise FormatError("Unsupported EFX header or declared size")
    roots = {}
    children = []
    cursor = 16
    while cursor < len(data):
        span, tag = u32(data, cursor), u32(data, cursor + 4)
        if span < 16 or span % 16 or cursor + span > len(data):
            raise FormatError("Invalid EFX record span")
        identifier = u32(data, cursor + 12)
        if tag == 0x06000100:
            if identifier in roots:
                raise FormatError("Duplicate EFX root ID")
            roots[identifier] = {"offset": cursor, "span": span,
                                 "header_identity_hex": data[cursor + 12:cursor + 40].hex(),
                                 "child_counts": {"06100100": 0, "06200100": 0}}
        elif tag in {0x06100100, 0x06200100}:
            children.append((identifier & 65535, f"{tag:08x}"))
        cursor += span
    for parent, tag in children:
        if parent not in roots:
            raise FormatError(f"EFX child references missing parent {parent}")
        roots[parent]["child_counts"][tag] += 1
    return roots

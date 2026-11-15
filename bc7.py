"""Decode BC7 texture blocks as specified by Direct3D."""

# BC7 partition and fix-up tables from Sergii Kudlai's bcdec (MIT).
# Each nibble encodes a pixel's subset and its fix-up flag, starting at the LSB.
PARTITIONS = (
    (
        0x9100110011001108, 0x9000100010001008,
        0x9110111011101118, 0x9110110011001008,
        0x9100100010000008, 0x9111111011101108,
        0x9111111011001008, 0x9110110010000008,
        0x9100100000000008, 0x9111111111101108,
        0x9111111010000008, 0x9110100000000008,
        0x9111111111101008, 0x9111111100000008,
        0x9111111111110008, 0x9111000000000008,
        0x9111011100010008, 0x0000000010001918,
        0x0111000900000008, 0x0000100011001918,
        0x0000000010001908, 0x0111001900010008,
        0x0011000900000008, 0x9000110011001118,
        0x0000100010001908, 0x0011000900010008,
        0x0110011001100918, 0x0011011001101908,
        0x0001011911101008, 0x0000111911110008,
        0x0111000110001918, 0x0011100110011908,
        0x9010101010101018, 0x9111000011110008,
        0x0101101009011018, 0x0011001911001108,
        0x0011110000111908, 0x0101010910101018,
        0x9001011010010118, 0x9010010101011018,
        0x0111001111001918, 0x0001001911001008,
        0x0011001001001908, 0x0011101111011908,
        0x0110100110010918, 0x9100001100111108,
        0x9001100101100118, 0x0000011009100008,
        0x0000001009110018, 0x0000010011100908,
        0x0100111009000008, 0x0010011900100008,
        0x9100100100110118, 0x9001001101101108,
        0x0011100111000918, 0x0110001110011908,
        0x9001001100110118, 0x9001110011000118,
        0x9000000101111118, 0x9110011100011008,
        0x9100110011110008, 0x0000111111001908,
        0x0111011101000908, 0x9110111000100018,
    ),
    (
        0xa222122011009108, 0x1222112a11009008,
        0x9122112a10020008, 0x911011002200a228,
        0xa211221900000008, 0xa200220011009108,
        0x911111112200a208, 0x9122112a11001108,
        0xa222111900000008, 0xa222111911110008,
        0xa222222219110008, 0xa100210029002108,
        0xa110211029102118, 0xa210221022902218,
        0xa221221121109108, 0x0222002a10029108,
        0xa211211011009008, 0x0022100a11009118,
        0xa211221922110008, 0x911122002200a208,
        0xa220222011109118, 0x1222122a10009008,
        0xa210221019000008, 0x0122092a00110008,
        0x000011002290a218, 0xa222221921002108,
        0x011012291a210118, 0x12211a2109100008,
        0xa200201920112208, 0xa222200201900118,
        0x91002a1022101108, 0x9222112a00020008,
        0xa221221920000008, 0x910021002200a228,
        0xa220220021009108, 0x02100a1002900218,
        0x00002a2219110008, 0x0210290a10210218,
        0x021010a921020218, 0x91002a1100221108,
        0x910000222a111108, 0xa222222210109018,
        0x9212121a00000008, 0xa211220022912208,
        0x910022001100a208, 0x922102201a210228,
        0x901022222a221018, 0x9212121a12120008,
        0xa222101010109018, 0x911022201110a228,
        0xa111200021912008, 0xa112211221920008,
        0xa220111011902228, 0xa000211921112008,
        0xa222011001900118, 0xa112291200000008,
        0xa222222201900118, 0xa200190011002208,
        0xa200221922112208, 0xa192000000000008,
        0x900020001000a008, 0xa229222022212228,
        0xa222222222229018, 0x0222102a11029118,
    ),
)

# Subsets, partition bits, RGB bits, alpha bits, P-bit layout, index widths.
MODES = (
    (3, 4, 4, 0, 'endpoint', 3, 0),
    (2, 6, 6, 0, 'subset',   3, 0),
    (3, 6, 5, 0, None,       2, 0),
    (2, 6, 7, 0, 'endpoint', 2, 0),
    (1, 0, 5, 6, None,       2, 3),
    (1, 0, 7, 8, None,       2, 2),
    (1, 0, 7, 7, 'endpoint', 4, 0),
    (2, 6, 5, 5, 'endpoint', 2, 0),
)
WEIGHTS = {
    2: (0, 21, 43, 64),
    3: (0, 9, 18, 27, 37, 46, 55, 64),
    4: (0, 4, 9, 13, 17, 21, 26, 30, 34, 38, 43, 47, 51, 55, 60, 64),
}


def decode_block(block):
    """Return the sixteen RGBA pixels of a 16-byte block in row order."""
    bits = int.from_bytes(block, 'little')
    mode = (bits & -bits).bit_length() - 1
    if not 0 <= mode < 8:
        return bytes(64)
    bits >>= mode + 1

    def take(width):
        nonlocal bits
        value = bits & ((1 << width) - 1)
        bits >>= width
        return value

    subsets, partition_bits, rgb_bits, alpha_bits, pbit, index_bits, other_bits = MODES[mode]
    partition = PARTITIONS[subsets-2][take(partition_bits)] if subsets > 1 else 8
    rotation = take(2) if other_bits else 0
    select = take(1) if mode == 4 else 0
    count = subsets * 2
    sizes = [rgb_bits, rgb_bits, rgb_bits] + ([alpha_bits] if alpha_bits else [])
    channels = [[take(size) for _ in range(count)] for size in sizes]
    if pbit:
        extra = [take(1) for _ in range(subsets if pbit == 'subset' else count)]
        if pbit == 'subset':
            extra = [bit for bit in extra for _ in range(2)]
        channels = [[2 * value + bit for value, bit in zip(channel, extra)] for channel in channels]
        sizes = [size + 1 for size in sizes]
    for channel, size in zip(channels, sizes):
        for i, value in enumerate(channel):
            high = value << (8 - size)
            channel[i] = high | (high >> size)
    if not alpha_bits:
        channels.append([255] * count)

    regions = [(partition >> (i * 4)) & 15 for i in range(16)]
    primary = [WEIGHTS[index_bits][take(index_bits - bool(region & 8))] for region in regions]
    secondary = [WEIGHTS[other_bits][take(other_bits - (i == 0))] for i in range(16)] if other_bits else primary
    colour, alpha = (secondary, primary) if select else (primary, secondary)
    output = bytearray()
    for i, region in enumerate(regions):
        start = (region & 3) * 2
        weights = (colour[i],) * 3 + (alpha[i],)
        pixel = [(channel[start] * (64 - weight) + channel[start+1] * weight + 32) >> 6
                 for channel, weight in zip(channels, weights)]
        if rotation:
            pixel[rotation-1], pixel[3] = pixel[3], pixel[rotation-1]
        output.extend(pixel)
    return bytes(output)


def decode_bc7(data, width, height):
    """Expand an aligned BC7 texture into row-major RGBA bytes."""
    if width <= 0 or height <= 0 or width % 4 or height % 4 or len(data) != width * height:
        raise ValueError('Invalid BC7 dimensions or data size')
    rgba = bytearray(width * height * 4)
    stride = width * 4
    for y in range(0, height, 4):
        for x in range(0, width, 4):
            start = y * width + x * 4
            pixels = decode_block(data[start:start+16])
            for row in range(4):
                dest = (y+row) * stride + x * 4
                rgba[dest:dest+16] = pixels[row*16:row*16+16]
    return rgba

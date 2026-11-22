#ifndef TOR_FLOOR_MARKER_H
#define TOR_FLOOR_MARKER_H

/* Draw-only tile quad, using the same primitive as a native ground shadow. */
typedef struct { float u, v, x, y, z; } TorFloorVertex;

static void tor_draw_floor_marker(unsigned char *image, void *draw, int x, int y,
                                  float half_width, uint32_t rgba) {
    void *texture = *(void **)(image + 0xf223d0);
    if (!draw || !texture) return;
    float point[4];
    ((void *(*)(void *, int, int))(image + 0x2dc4a0))(point, x, y);
    ((void *(*)(void *, void *, unsigned, int))(image + 0x321260))(texture, draw, 16, 0);
    ((void (*)(void *, const void *))(image + 0x1a08a0))(draw, image + 0xce2650);
    ((void (*)(void *, unsigned))(image + 0x1a15c0))(draw, 3);
    TorFloorVertex *vertices = ((void *(*)(unsigned, unsigned))(image + 0x298260))(80, 1);
    if (!vertices) return;
    const float floor = point[1] + 0.004f;
    const float left = point[0] - half_width, right = point[0] + half_width;
    const float front = point[2] - half_width, back = point[2] + half_width;
    vertices[0] = (TorFloorVertex){0.5f, 0.5f, left, floor, front};
    vertices[1] = (TorFloorVertex){0.5f, 0.5f, right, floor, front};
    vertices[2] = (TorFloorVertex){0.5f, 0.5f, left, floor, back};
    vertices[3] = (TorFloorVertex){0.5f, 0.5f, right, floor, back};
    ((void (*)(void *, unsigned, uint8_t))(image + 0x1a1450))(draw, 0x80, 1);
    ((void (*)(void *, unsigned, uint8_t))(image + 0x1a1450))(draw, 8, 1);
    ((void (*)(void *, unsigned))(image + 0x1a09d0))(draw, rgba);
    const float zero[4] = {0};
    ((void (*)(void *, unsigned, const void *, const void *))(image + 0x1a0940))(draw, 4, zero, zero);
    ((void (*)(void *, unsigned))(image + 0x1a13c0))(draw, 0x22);
    ((void (*)(void *, const void *))(image + 0x1a05d0))(draw, vertices);
    ((void (*)(void *, unsigned, unsigned))(image + 0x1a0ce0))(draw, 4, 4);
}

#endif

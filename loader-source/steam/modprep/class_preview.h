/* PC 1.0.2. The native scroll callback indexes preview labels by full list row.
 * The layout creates 24 labels before the expanded list publishes its count.
 * Grow the original owned vector after layout, using its native constructor. */
typedef struct {
    void **first, **end, **limit;
} MP_PreviewLabels;

typedef void *(*MP_NewPreviewLabel)(int style, unsigned char animate);
typedef void *(*MP_InsertPreviewLabel)(MP_PreviewLabels *, void **position, void **label);

static int mp_extend_preview_labels(MP_PreviewLabels *labels, unsigned count,
                                   MP_NewPreviewLabel create, MP_InsertPreviewLabel insert)
{
    uintptr_t first = (uintptr_t)labels->first;
    uintptr_t end = (uintptr_t)labels->end;
    uintptr_t limit = (uintptr_t)labels->limit;
    if (count > 255 || (!first && limit) || end < first || limit < end ||
        (end - first) % sizeof(void *) || (limit - end) % sizeof(void *))
        return 0;
    /* An empty vector means the game's layout callback has not run yet. */
    uintptr_t present = (end - first) / sizeof(void *);
    if (!present)
        return 1;
    for (; present < count; ++present) {
        void *label = create(0x4f, 1);
        if (!label)
            return 0;
        if (labels->end == labels->limit)
            insert(labels, labels->end, &label);
        else
            *labels->end++ = label;
    }
    return 1;
}

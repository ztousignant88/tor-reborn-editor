/* The stock planner indexes a fixed 64-by-64 matrix with world-map node IDs.
   The marker and road object arrays themselves are allocated from the tables. */
enum { WORLD_ROUTE_NODES = 96, WORLD_ROUTE_DEGREE = 16, WORLD_ROUTE_STEPS = 100 };

typedef struct {
    uint32_t cost, count;
    uint32_t nodes[WORLD_ROUTE_STEPS], roads[WORLD_ROUTE_STEPS];
    uint32_t flags;
} WorldRoute;
_Static_assert(sizeof(WorldRoute) == 0x32c, "Native world-map route record");

typedef struct { uint8_t target, road; uint16_t cost; } WorldRouteEdge;
static WorldRouteEdge world_route_edges[WORLD_ROUTE_NODES][WORLD_ROUTE_DEGREE];
static uint8_t world_route_degrees[WORLD_ROUTE_NODES];
static uint16_t world_route_distances[WORLD_ROUTE_NODES][WORLD_ROUTE_NODES];
static unsigned world_route_nodes;
static int world_route_expanded;

static int world_route_add(unsigned source, unsigned target, unsigned road, unsigned cost) {
    unsigned degree = world_route_degrees[source];
    if (degree == WORLD_ROUTE_DEGREE)
        return 0;
    world_route_edges[source][degree] = (WorldRouteEdge){target, road, cost};
    world_route_degrees[source] = (uint8_t)(degree + 1);
    if (cost < world_route_distances[source][target])
        world_route_distances[source][target] = (uint16_t)cost;
    return 1;
}

static void world_route_find_distances(unsigned count) {
    for (unsigned via = 1; via < count; ++via) {
        for (unsigned from = 1; from < count; ++from) {
            if (world_route_distances[from][via] == UINT16_MAX)
                continue;
            for (unsigned to = 1; to < count; ++to) {
                unsigned cost = world_route_distances[from][via] + world_route_distances[via][to];
                if (cost < world_route_distances[from][to])
                    world_route_distances[from][to] = (uint16_t)cost;
            }
        }
    }
}

static const uint8_t *world_route_map(void) {
    return *(const uint8_t *const *)(mm_base + 0xece930);
}

static void world_route_rebuild(void *native) {
    typedef uint8_t *(*GetRoad)(const void *, unsigned);
    typedef const uint8_t *(*GetNode)(const void *, unsigned);
    const uint8_t *map = world_route_map();
    world_route_nodes = 0;
    world_route_expanded = 0;
    if (map && *(const uint32_t *)(map + 0x30) == 0) {
        const uint8_t *nodes = *(const uint8_t *const *)(map + 0x45e8);
        const uint8_t *roads = *(const uint8_t *const *)(map + 0x45f8);
        if (nodes && roads) {
            unsigned count = *(const uint32_t *)(nodes + 0x0c);
            if (count > 64) {
                world_route_expanded = 1;
                if (count > WORLD_ROUTE_NODES)
                    return;
                unsigned road_count = *(const uint32_t *)(roads + 0x0c);
                const uint8_t *vtable = *(const uint8_t *const *)roads;
                GetRoad get_road = *(GetRoad const *)(vtable + 0x38);
                GetNode get_node = (void *)(mm_base + 0x43ca70);
                memset(world_route_degrees, 0, sizeof world_route_degrees);
                memset(world_route_distances, 0xff, sizeof world_route_distances);
                for (unsigned i = 0; i < count; ++i)
                    world_route_distances[i][i] = 0;
                for (unsigned i = 1; i < road_count && i <= UINT8_MAX; ++i) {
                    const uint8_t *road = get_road(roads, i);
                    if (!road || road[0x170] != 1)
                        continue;
                    const uint16_t *ends = *(const uint16_t *const *)(road + 0x140);
                    if (!ends || !ends[0] || !ends[1] || ends[0] >= count || ends[1] >= count)
                        continue;
                    const uint8_t *start = get_node(nodes, ends[0]);
                    const uint8_t *end = get_node(nodes, ends[1]);
                    if (!start || !end)
                        continue;
                    const uint8_t *start_vtable = *(const uint8_t *const *)start;
                    typedef uint8_t (*IsCleared)(const void *);
                    IsCleared cleared = *(IsCleared const *)(start_vtable + 0x48);
                    unsigned cost = ((*(const uint32_t *)(start + 0x78) == 3 &&
                        *(const uint32_t *)(end + 0x78) == 3) || cleared(start)) ? 1 : 10;
                    if (!world_route_add(ends[0], ends[1], i, cost) ||
                        !world_route_add(ends[1], ends[0], i, cost))
                        return;
                }
                world_route_find_distances(count);
                world_route_nodes = count;
                return;
            }
        }
    }
    ((void (*)(void *))(mm_base + 0x4345c0))(native);
}

static void world_route_paths(unsigned source, unsigned target, WorldRoute *path, unsigned step,
                              WorldRoute *results, uint32_t *used, unsigned capacity) {
    if (source == target) {
        path->count = step;
        results[(*used)++] = *path;
        return;
    }
    if (step >= WORLD_ROUTE_STEPS)
        return;
    for (unsigned i = 0; i < world_route_degrees[source] && *used < capacity; ++i) {
        WorldRouteEdge edge = world_route_edges[source][i];
        if (edge.cost + world_route_distances[edge.target][target] != world_route_distances[source][target])
            continue;
        path->nodes[step] = edge.target;
        path->roads[step] = edge.road;
        world_route_paths(edge.target, target, path, step + 1, results, used, capacity);
    }
}

static void world_route_query(void *native, WorldRoute *results, uint32_t *used, uint32_t *cost,
                              unsigned source, unsigned target, unsigned capacity) {
    const uint8_t *map = world_route_map();
    if (!map || *(const uint32_t *)(map + 0x30) != 0 ||
        (!world_route_expanded && source < 64 && target < 64)) {
        typedef void (*NativeQuery)(void *, WorldRoute *, uint32_t *, uint32_t *, unsigned, unsigned, unsigned);
        ((NativeQuery)(mm_base + 0x434dc0))(native, results, used, cost, source, target, capacity);
        return;
    }
    *used = *cost = 0;
    if (source >= world_route_nodes || target >= world_route_nodes || source == target ||
        !capacity || world_route_distances[source][target] == UINT16_MAX)
        return;
    WorldRoute path = {0};
    *cost = path.cost = world_route_distances[source][target];
    world_route_paths(source, target, &path, 0, results, used, capacity);
}

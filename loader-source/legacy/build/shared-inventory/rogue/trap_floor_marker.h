#ifndef TRAP_FLOOR_MARKER_H
#define TRAP_FLOOR_MARKER_H
/* Draw-only floor quads. No native map flags, blockers or actor registration.
 * Command sequence follows native ground-shadow renderer 39F770; constant
 * centre UVs sample its solid centre, giving a full square rather than a disc.
 * This is a native floor primitive in Rampart's style, not Rampart gameplay. */
typedef void (*TrapFloorPassFn)(void *,void *);
typedef void *(*TrapFloorTextureFn)(void *,void *,unsigned,int);
typedef void (*TrapFloorMatrixFn)(void *,const void *);
typedef void (*TrapFloorIntFn)(void *,unsigned);
typedef void *(*TrapFloorAllocateFn)(unsigned,unsigned);
typedef void (*TrapFloorFlagFn)(void *,unsigned,byte);
typedef void (*TrapFloorMaterialFn)(void *,unsigned,const void *,const void *);
typedef void (*TrapFloorVerticesFn)(void *,const void *);
typedef void (*TrapFloorSubmitFn)(void *,unsigned,unsigned);
static TrapFloorPassFn original_trap_floor_pass;
static TrapFloorTextureFn trap_floor_texture;
static TrapFloorMatrixFn trap_floor_matrix;
static TrapFloorIntFn trap_floor_topology,trap_floor_tint,trap_floor_format;
static TrapFloorAllocateFn trap_floor_allocate;
static TrapFloorFlagFn trap_floor_flag;
static TrapFloorMaterialFn trap_floor_material;
static TrapFloorVerticesFn trap_floor_vertices;
static TrapFloorSubmitFn trap_floor_submit;
static void **trap_floor_texture_context;
static const void *trap_floor_transform;
typedef struct { float u,v,x,y,z; } TrapFloorVertex;
static void trap_floor_quad(TrapFloorVertex out[4],const float point[4]){
    const float half=0.475f,y=point[1]+0.004f;
    out[0]=(TrapFloorVertex){0.5f,0.5f,point[0]-half,y,point[2]-half};
    out[1]=(TrapFloorVertex){0.5f,0.5f,point[0]+half,y,point[2]-half};
    out[2]=(TrapFloorVertex){0.5f,0.5f,point[0]-half,y,point[2]+half};
    out[3]=(TrapFloorVertex){0.5f,0.5f,point[0]+half,y,point[2]+half};
}
static void trap_draw_floor_tile(void *draw,TrapTile tile,unsigned owner_team){
    if(!draw || !trap_floor_texture_context || !*trap_floor_texture_context)return;
    float point[4];trap_native_position(point,tile.x,tile.y);
    trap_floor_texture(*trap_floor_texture_context,draw,16,0);
    trap_floor_matrix(draw,trap_floor_transform);trap_floor_topology(draw,3);
    TrapFloorVertex *vertices=trap_floor_allocate(80,1);if(!vertices)return;
    trap_floor_quad(vertices,point);
    trap_floor_flag(draw,0x80,1);trap_floor_flag(draw,8,1);
    /* Native 19E800 writes RGBA floats from low..high packed bytes. */
    trap_floor_tint(draw,owner_team==2?0xa0ff50c0u:0xa0ffff40u);
    float zero[4]={0};trap_floor_material(draw,4,zero,zero);
    trap_floor_format(draw,0x22);trap_floor_vertices(draw,vertices);trap_floor_submit(draw,4,4);
}
static void hook_trap_floor_pass(void *unit,void *draw){
    original_trap_floor_pass(unit,draw);
    if(!traps_enabled || !trap_floor_enabled || !draw || !trap_world.battle_key)return;
    void *battle=trap_native_battle();int index=trap_live_actor(battle,unit);if(index<0)return;
    /* This native pass is called per unit. Emit our private markers once,
     * using the first enabled roster unit, without assuming Denam/ID zero. */
    byte *units=pointer(battle,0x1b48);
    for(int i=0;i<index;++i)if(units[i*0x7d0+0x10])return;
    if(!((byte*)unit)[0x10])return;
    for(unsigned i=0;i<TRAP_CAPACITY;++i){TrapMarker marker;
        if(trap_marker_for(trap_world.slots+i,1,&marker))trap_draw_floor_tile(draw,marker.tile,trap_world.slots[i].owner_team);
    }
}
static void trap_floor_bind(void){
    trap_floor_texture=(TrapFloorTextureFn)(base+0x31ea10);trap_floor_matrix=(TrapFloorMatrixFn)(base+0x19e6d0);
    trap_floor_topology=(TrapFloorIntFn)(base+0x19f3f0);trap_floor_allocate=(TrapFloorAllocateFn)(base+0x296160);
    trap_floor_flag=(TrapFloorFlagFn)(base+0x19f280);trap_floor_tint=(TrapFloorIntFn)(base+0x19e800);
    trap_floor_material=(TrapFloorMaterialFn)(base+0x19e770);trap_floor_format=(TrapFloorIntFn)(base+0x19f1f0);
    trap_floor_vertices=(TrapFloorVerticesFn)(base+0x19e400);trap_floor_submit=(TrapFloorSubmitFn)(base+0x19eb10);
    trap_floor_texture_context=(void**)(base+0xf32df0);trap_floor_transform=base+0xcf3190;
}
#endif

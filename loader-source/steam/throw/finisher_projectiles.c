/* Visual identity is a weapon attack; the prepared command keeps the owned
 * finisher's damage, status, area, rank and ammunition rules. No effect-row
 * projectile flag is changed: that flag also bypasses area/repeated hits. */
typedef unsigned char (*ThrowPreviewFn)(const void*);
typedef void (*ThrowBallisticsFn)(void*,void*,const void*);
typedef void (*ThrowPerformFn)(void*,void*,const void*);
typedef void (*ThrowTickFn)(void*,void*);
typedef void (*ThrowTraceFn)(void*,void*,void*,unsigned,void*,unsigned,const void*);
typedef void (*ThrowModeFn)(void*,unsigned,const void*);
typedef unsigned (*ThrowImpactFn)(void*,void*,unsigned,uint16_t,unsigned,const void*,unsigned char,unsigned char);
typedef void *(*ThrowDescriptorFn)(void*,void*,void*,unsigned,int,const void*,unsigned,unsigned);
typedef unsigned char (*ThrowFxDoneFn)(unsigned);
typedef unsigned (*ThrowDirectionFn)(unsigned,unsigned,unsigned char);
static ThrowPreviewFn throw_preview_original;
static ThrowBallisticsFn throw_ballistics_original;
static ThrowPerformFn throw_perform_original;
static ThrowTickFn throw_tick_original;
static ThrowTraceFn throw_trace;
static ThrowModeFn throw_mode_original;
static ThrowImpactFn throw_impact_original;
static ThrowDescriptorFn throw_descriptor_original;
static ThrowFxDoneFn throw_fx_done;
static ThrowDirectionFn throw_direction;
static void (*throw_launch_original)(void*,void*,unsigned,void*,const void*,const void*);
static void throw_launch_hook(void *launch,void *battle,unsigned tile,void *actor,const void *command,const void *descriptor){
    const unsigned item=ammo_item(command);
    throw_launch_original(launch,battle,tile,actor,command,descriptor);
    if(item!=593&&item!=594&&item!=599&&item!=600)return;

    /* Set the native direction-aligned mode on the live launch state.
     * The same state feeds both the per-frame update and the renderer. */
    unsigned char *path=(unsigned char*)launch+0x10;
    const uint16_t flags=ammo_word(path,0xc0);
    const uint16_t aligned=(flags&~0x38u)|8u;
    const float no_spin=0.0f, diagonal=-45.0f;
    memcpy(path+0xc0,&aligned,sizeof(aligned));
    memcpy(path+0xa4,&no_spin,sizeof(no_spin));
    memcpy(path+0xa8,&diagonal,sizeof(diagonal));
    memcpy(path+0xb0,&no_spin,sizeof(no_spin));
    char line[128];
    snprintf(line,sizeof(line),"Spear launch: item=%u sprite=%u flags=%04x->%04x.\r\n",item,(unsigned)ammo_word(path,0xc2),(unsigned)flags,(unsigned)aligned);
    ammo_log(line);
}
static void (*throw_draw_original)(void*,const void*);
static void throw_draw_hook(void *renderer,const void *entry){
    unsigned char *path=ammo_pointer(entry,0);
    unsigned sprite=path?ammo_word(path,0xc2):0;
    if((sprite!=168&&sprite!=212)||(ammo_word(path,0xc0)&0x338)!=0x108){
        throw_draw_original(renderer,entry);
        return;
    }

    /* Mode 1 flattens the flight vector before making the sprite basis.
     * Mode 2 keeps the vertical component. Use it only while drawing Javelin or Pilum,
     * with a fixed correction for the sprite's diagonal artwork. */
    const uint16_t flags=ammo_word(path,0xc0);
    const uint16_t pitched=(flags&~0x38u)|0x10u;
    const float diagonal=-45.0f;
    float roll;
    memcpy(&roll,path+0xa8,sizeof(roll));
    memcpy(path+0xc0,&pitched,sizeof(pitched));
    memcpy(path+0xa8,&diagonal,sizeof(diagonal));
    throw_draw_original(renderer,entry);
    memcpy(path+0xc0,&flags,sizeof(flags));
    memcpy(path+0xa8,&roll,sizeof(roll));
}
static int (*throw_path_update_original)(void*,unsigned char);
typedef unsigned char (*ThrowFxPointFn)(const void*,void*,void*,float*);
static ThrowFxPointFn throw_fx_point_original;
static void **throw_fx_current;
static int (*throw_fx_create_meta)(int);
static void (*throw_fx_context)(int,void*);
static unsigned char (*throw_fx_page)(int,unsigned);
static void *(*throw_fx_battle_context)(void*);
static int (*throw_fx_create)(int,unsigned char);
static void (*throw_fx_params)(void*,int,int);
static void (*throw_fx_start)(void*);
static void (*throw_fx_position)(int,const void*);
static void (*throw_fx_release)(int);
static void *(*throw_tile_position)(void*,int,int);
static void *(*throw_target_unit)(int,void*);
struct ThrowVisual {
    void *actor,*result,*path,*job;uint16_t item;unsigned pending;
    unsigned total,index,pose_done,impact_seen,impact_fx,finished;
    int flight_fx,burst_fx;
    unsigned flight_started;
    float flight_point[4],flight_delta[3];
    unsigned char info[0x40],playback[0x5e10];
};
static struct ThrowVisual throw_visuals[30];
static _Thread_local struct ThrowVisual *throw_ticking,*throw_impact_visual;
static volatile LONG throw_visual_logs,throw_preview_logs;
static int throw_weapon_identity(const void *command,void *actor,unsigned char out[8]){
    if(!ammo_finisher(command))return 0;
    uint16_t item=ammo_command_item(command,actor);if(!item)return 0;
    memset(out,0,8);out[0]=2;memcpy(out+2,&item,2);return 1;
}
static struct ThrowVisual *throw_visual_find(void *actor){
    if(!actor)return 0;
    for(unsigned i=0;i<30;i++)if(throw_visuals[i].actor==actor)return &throw_visuals[i];
    return 0;
}
static void throw_stop_flight(struct ThrowVisual *v);
static void ammo_visual_clear(void *job){
    for(unsigned i=0;i<30;i++){
        struct ThrowVisual *v=&throw_visuals[i];
        if(v->job!=job)continue;
        throw_stop_flight(v);
        if(v->burst_fx)throw_fx_release(v->burst_fx);
        memset(v,0,sizeof(*v));
    }
}
static int throw_start_overlay(int selector,unsigned char variant,const float point[4]){
    int handle=throw_fx_create(selector,variant);
    if(!handle)return 0;
    _Alignas(16) unsigned char params[0x50];
    throw_fx_params(params,handle,4);
    memcpy(params+0x20,point,16);
    throw_fx_start(params);
    throw_fx_position(handle,point);
    return handle;
}
/* The original flight emitters all use a linear attachment with two
 * endpoints. Give only our instances two nearby points on the weapon's
 * tangent so their particles and ribbons follow the actual ballistic arc. */
static unsigned char throw_fx_point_hook(const void *definition,void *attachment,void *cache,float *out){
    void *current=*throw_fx_current;
    if(current){
        int handle;memcpy(&handle,(unsigned char*)current+4,sizeof(handle));
        void *route=ammo_pointer(attachment,0xe0);
        uintptr_t endpoint=(uintptr_t)definition-(uintptr_t)route;
        if(route&&(endpoint==0x168||endpoint==0x228)){
            for(unsigned i=0;i<30;i++){
                struct ThrowVisual *v=&throw_visuals[i];
                if(!v->flight_fx||v->flight_fx!=handle)continue;
                memcpy(out,v->flight_point,sizeof(v->flight_point));
                float offset=endpoint==0x168?-0.025f:0.025f;
                for(unsigned axis=0;axis<3;axis++)out[axis]+=offset*v->flight_delta[axis];
                return 1;
            }
        }
    }
    return throw_fx_point_original(definition,attachment,cache,out);
}
static void throw_stop_flight(struct ThrowVisual *v){
    if(v->flight_fx)throw_fx_release(v->flight_fx);
    v->flight_fx=0;
}
static void throw_start_flight(struct ThrowVisual *v,unsigned finisher){
    /* Common EFX event 13 identifies the missile-only child meta and page
     * for Sparksphere, Lightning Bow and the two Deadshot variants. */
    static const int metas[]={58,82,38,38};
    static const unsigned pages[]={1,1,1,2};
    int handle=throw_fx_create_meta(metas[finisher-416]);
    if(!handle)return;
    v->flight_fx=handle;
    throw_fx_context(handle,throw_fx_battle_context(ammo_base+0xd6ab80));
    _Alignas(16) unsigned char params[0x50];
    throw_fx_params(params,handle,4);
    memcpy(params+0x20,v->flight_point,16);
    throw_fx_start(params);
    if(!throw_fx_page(handle,pages[finisher-416]))throw_stop_flight(v);
}
static int throw_path_update_hook(void *path,unsigned char query){
    int state=throw_path_update_original(path,query);
    if(query||!path)return state;
    for(unsigned i=0;i<30;i++){
        struct ThrowVisual *v=&throw_visuals[i];
        if(!v->path||(unsigned char*)v->path+0x10!=path)continue;
        unsigned finisher=ammo_finisher(v->result);
        if(finisher<416||finisher>419)break;
        if((state==0||state==1)&&!v->impact_seen){
            float point[4],offset[4];
            memcpy(point,(unsigned char*)path+0x20,sizeof(point));
            memcpy(offset,(unsigned char*)path+0x70,sizeof(offset));
            for(unsigned axis=0;axis<3;axis++)point[axis]+=offset[axis];
            if(v->flight_started){
                for(unsigned axis=0;axis<3;axis++)v->flight_delta[axis]=point[axis]-v->flight_point[axis];
            }else{
                memcpy(v->flight_delta,(unsigned char*)path+0x40,sizeof(v->flight_delta));
            }
            memcpy(v->flight_point,point,3*sizeof(float));
            v->flight_point[3]=1.0f;
            if(!v->flight_started){
                v->flight_started=1;
                throw_start_flight(v,finisher);
            }
        }else{
            throw_stop_flight(v);
        }
        break;
    }
    return state;
}
static struct ThrowVisual *throw_visual_result(void *result){
    if(!result)return 0;
    for(unsigned i=0;i<30;i++)if(throw_visuals[i].result==result)return &throw_visuals[i];
    return 0;
}
static unsigned throw_part_target(struct ThrowVisual *v){
    const unsigned char *record=(unsigned char*)v->result+0x28+v->index*0x2d8;
    unsigned target;
    memcpy(&target,record+0xa,sizeof(target));
    if(ammo_finisher(v->result)==419&&throw_target_unit){
        int id=(int16_t)ammo_word(record,2);
        void *battle=ammo_pointer(v->actor,0x728);
        if(id>=0&&id<30&&battle){
            void *unit=throw_target_unit(id,battle);
            if(ammo_readable(unit,0x18))memcpy(&target,(unsigned char*)unit+0x14,sizeof(target));
        }
    }
    return target;
}
static void throw_prepare_part(struct ThrowVisual *v){
    /* Keep every original result at its original index. Native hit callbacks
     * still refer to that array. Only the actor's presentation sees one row. */
    memcpy(v->playback,v->result,sizeof(v->playback));
    memcpy(v->playback+0x28,(unsigned char*)v->result+0x28+v->index*0x2d8,0x2d8);
    memset(v->playback+0x28+0x2d8,0,29*0x2d8);v->playback[0x5578]=1;
    unsigned target=throw_part_target(v),source;memcpy(&source,(unsigned char*)v->actor+0x14,4);
    unsigned direction=throw_direction(source,target,*((unsigned char*)v->actor+0x30));
    memcpy(v->playback+0x20,&direction,4);
    void *playback=v->playback;memcpy(v->info+0x20,&playback,8);
    throw_stop_flight(v);
    v->flight_started=0;
    memset(v->path,0,0xe0);v->pending=1;v->pose_done=0;v->impact_seen=0;v->impact_fx=0;
}
static void throw_mode_hook(void *actor,unsigned mode,const void *info){
    /* The native end-of-pose transition normally releases the actor before
     * the projectile's impact. Hold only this owned animation's idle request,
     * until its impact finishes and the next individual throw can begin. */
    if(mode==0&&throw_ticking&&throw_ticking->actor==actor&&throw_ticking->total>1&&!throw_ticking->finished){
        throw_ticking->pose_done=1;return;
    }
    throw_mode_original(actor,mode,info);
}
static void *throw_descriptor_hook(void *out,void *result,void *extra,unsigned actor,int count,const void *position,unsigned fx,unsigned start){
    struct ThrowVisual *v=throw_impact_visual;
    /* Weapon launch/sound effects also carry result callbacks. Their visual
     * copy must resolve back to this throw's original record, never record 0
     * of a temporary presentation buffer. */
    for(unsigned i=0;i<30;i++)if(throw_visuals[i].total>1&&result==throw_visuals[i].playback){
        v=&throw_visuals[i];result=v->result;break;
    }
    if(v&&v->result==result){
        start=v->total>1?v->index:0;
        count=v->total>1?1:((unsigned char*)result)[0x5578];
    }
    return throw_descriptor_original(out,result,extra,actor,count,position,fx,start);
}
static unsigned throw_impact_hook(void *result,void *extra,unsigned actor,uint16_t item,unsigned count,const void *position,unsigned char a,unsigned char b){
    struct ThrowVisual *v=throw_visual_result(result);
    if(!v)return throw_impact_original(result,extra,actor,item,count,position,a,b);
    if(v->impact_seen)return 0; /* Never dispatch the same throw twice. */
    struct ThrowVisual *previous=throw_impact_visual;throw_impact_visual=v;
    unsigned fx=throw_impact_original(result,extra,actor,v->item,count,position,a,b);
    throw_impact_visual=previous;v->impact_seen=1;v->impact_fx=fx;
    unsigned finisher=ammo_finisher(result);
    if((finisher==416||finisher==417)&&throw_tile_position&&ammo_readable(v->actor,0x3b4)){
        _Alignas(16) float point[4];
        int x=(int16_t)ammo_word(v->actor,0x3b0);
        int y=(int16_t)ammo_word(v->actor,0x3b2);
        throw_tile_position(point,x,y);
        v->burst_fx=throw_start_overlay(finisher==416?99:122,finisher==416?5:0,point);
    }
    char line[192];snprintf(line,sizeof(line),"Throw sequence: effect=%u impact %u/%u record=%u target=%u fx=%u.\r\n",ammo_finisher(v->result),v->index+1,v->total,v->index,ammo_word(result,0x28+v->index*0x2d8+2),fx);ammo_log(line);
    return fx;
}
__attribute__((noinline)) static unsigned char throw_preview_hook(const void *command){
    uintptr_t caller=(uintptr_t)__builtin_return_address(0)-(uintptr_t)ammo_base;
    /* These two callers draw the world-space aim path and its forecast.
     * Leave the action preparation predicate and every other consumer alone. */
    if((caller==0x367bf2||caller==0x3c6fbe)&&ammo_finisher(command)){
        if(InterlockedIncrement(&throw_preview_logs)<=8)ammo_log("Finisher projectile: native prediction path enabled.\r\n");
        return 1;
    }
    return throw_preview_original(command);
}
static void throw_ballistics_hook(void *out,void *actor,const void *command){
    unsigned char weapon[8];
    throw_ballistics_original(out,actor,throw_weapon_identity(command,actor,weapon)?weapon:command);
}
static void throw_perform_hook(void *self,void *actor,const void *info){
    unsigned char weapon[8];
    void *result=ammo_readable(info,0x40)?ammo_pointer(info,0x20):0;
    void *path=ammo_readable(info,0x40)?ammo_pointer(info,0x38):0;
    if(!ammo_job||!ammo_readable(actor,0x730)||!ammo_readable(result,0x5579)||!ammo_readable(path,0xe0)||!throw_weapon_identity(info,actor,weapon)){
        throw_perform_original(self,actor,info);return;
    }
    struct ThrowVisual *v=throw_visual_find(actor);
    if(!v)for(unsigned i=0;i<30;i++)if(!throw_visuals[i].actor){v=&throw_visuals[i];break;}
    if(!v){throw_perform_original(self,actor,info);return;}
    unsigned char visual_info[0x40];memcpy(visual_info,info,sizeof(visual_info));memcpy(visual_info,weapon,8);
    memset(visual_info+0x10,0,8); /* No spell chant/attached spell performer. */
    memset(path,0,0xe0);
    memset(v,0,sizeof(*v));v->actor=actor;v->result=result;v->path=path;v->job=ammo_job;v->item=ammo_word(weapon,2);v->pending=1;v->total=1;
    unsigned finisher=ammo_finisher(result),count=((unsigned char*)result)[0x5578];
    if((finisher==418||finisher==419)&&count>1&&count<=30&&ammo_readable(result,sizeof(v->playback))){
        v->total=count;memcpy(v->info,visual_info,sizeof(v->info));throw_prepare_part(v);
        memcpy(visual_info,v->info,sizeof(visual_info));
        char line[160];snprintf(line,sizeof(line),"Throw sequence: effect=%u queued %u separate native weapon throws; ammo remains one committed payment.\r\n",finisher,count);ammo_log(line);
    }
    throw_perform_original(self,actor,visual_info);
}
static void throw_tick_hook(void *self,void *actor){
    struct ThrowVisual *v=throw_visual_find(actor);
    void *playback=v&&v->total>1?(void*)v->playback:(v?v->result:0);
    if(v&&v->pending&&ammo_readable(actor,0x730)&&ammo_pointer(actor,0x360)==playback&&ammo_pointer(actor,0x378)==v->path&&ammo_item((unsigned char*)actor+0x310)==v->item){
        /* ActionIterator writes the chosen tile to actor+3B0 AFTER entering
         * PERFORM_ACTION. Waiting for its first tick avoids the old target. */
        unsigned target,source;memcpy(&target,(unsigned char*)actor+0x3b0,4);memcpy(&source,(unsigned char*)actor+0x14,4);
        if(v->total>1||(ammo_finisher(v->result)==419&&((unsigned char*)v->result)[0x5578])){
            target=throw_part_target(v);
            memcpy((unsigned char*)actor+0x3b0,&target,4);
        }
        unsigned char collision[0x60]={0},weapon[8]={2};memcpy(weapon+2,&v->item,2);
        throw_trace(v->path,collision,ammo_pointer(actor,0x728),target,actor,source,weapon);
        v->pending=0;
        if(InterlockedIncrement(&throw_visual_logs)<=32){char line[192];snprintf(line,sizeof(line),"Finisher projectile: effect=%u item=%u native curved weapon playback; selected tile=(%d,%d), result-count=%u.\r\n",ammo_finisher(v->result),v->item,(int16_t)target,(int16_t)(target>>16),((unsigned char*)v->result)[0x5578]);ammo_log(line);}
    }
    struct ThrowVisual *previous=throw_ticking;throw_ticking=v;throw_tick_original(self,actor);throw_ticking=previous;
    if(v&&v->total>1&&!v->finished&&v->pose_done&&v->impact_seen&&(!v->impact_fx||throw_fx_done(v->impact_fx))){
        if(v->index+1<v->total){
            v->index++;throw_prepare_part(v);
            unsigned target=throw_part_target(v);memcpy((unsigned char*)actor+0x3b0,&target,4);
            throw_mode_original(actor,2,v->info);
        }else{
            v->finished=1;throw_mode_original(actor,0,0);
            ammo_log("Throw sequence: all individual throws and impacts finished; actor released.\r\n");
        }
    }
}

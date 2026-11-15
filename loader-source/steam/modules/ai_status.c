/* Status-focused AI (TO:R Editor integrated mod "Status-focused AI behaviours").
 *
 * The AI think task (0x2f37f0, its own thread) simulates every action and
 * scores each simulated result as a (gain, loss) pair; the think step keeps an
 * action only when gain - loss beats its threshold (0x2f512a). The game's
 * "apply status" scorer (0x3c3b10) computes
 *     target value x status AI value x profile weight (+0x12 own side,
 *     +0x14 enemies) x chance x status factor
 * and then stores that same number as BOTH gain and loss, so every status
 * result nets to zero, and a negative weight makes the loss negative, which
 * marks the whole action invalid. Found with this module's stage-1 log
 * (Almorica, 2026-11-08: Sleep on an enemy scored 49350 / 49350).
 *
 * Fix: while an in-scope unit thinks, a status score (v, v) becomes (v, 0)
 * for v >= 0 and (0, -v) for v < 0, the way damage is scored. The game's own
 * "skip" result (0, -1) and everything else are left alone.
 *
 * Scope (menu-mods.ini [AIStatus] AllProfiles): 0 = only AI numbers added
 * after the game's own 113 (the editor's new behaviours and duplicated
 * profiles), stock AI untouched; 1 = every AI number, stock ones included.
 * A bounded log in menu-mods.log: one line per in-scope think, and the scored
 * results of units with AI number 113 and up. */

#define AIS_FIRST_AI 113u
#define AIS_LOG_LIMIT 20000
#define AIS_THINK 0x2f5760u
#define AIS_SCORE 0x3c6450u
#define AIS_STATUS_SCORE 0x3c6b80u
#define AIS_UNIT_AI 0x1d8u
#define AIS_WORKSPACE_UNIT 0x1cb78u

typedef uint64_t (*AisFn)(uint64_t,uint64_t,uint64_t,uint64_t,uint64_t,uint64_t);
typedef struct {unsigned rva;unsigned char original[8];unsigned length;void *hook;AisFn *call;int call_site;} AisHook;

static volatile DWORD ais_thread;
/* full detail only for AI >= 113; other in-scope AI numbers get a one-line summary per think */
static volatile int ais_detail, ais_full_turn;
static volatile LONG ais_lines;
static int ais_first_ai=(int)AIS_FIRST_AI;
static unsigned ais_kinds[32],ais_fixed;
static AisFn ais_think,ais_score,ais_status_score;

#include "ai_weight_defaults.c"

static int ais_watching(void){return ais_thread&&GetCurrentThreadId()==ais_thread;}
static void ais_logf(const char *format,...){
    if(InterlockedIncrement(&ais_lines)>AIS_LOG_LIMIT)return;
    char line[256];va_list args;va_start(args,format);vsnprintf(line,sizeof(line),format,args);va_end(args);mm_log(line);
}

static uint64_t ais_think_hook(uint64_t a,uint64_t b,uint64_t c,uint64_t d,uint64_t e,uint64_t f){
    unsigned char *workspace=(unsigned char*)a,*unit=0;int ai=-1;
    if(mm_readable(workspace+AIS_WORKSPACE_UNIT,8))unit=*(unsigned char**)(workspace+AIS_WORKSPACE_UNIT);
    if(unit&&mm_readable(unit+AIS_UNIT_AI,1))ai=unit[AIS_UNIT_AI];
    int full=ai>=ais_first_ai;
    if(!full&&!ais_default_buffs)return ais_think(a,b,c,d,e,f);
    ais_full_turn=full;
    memset(ais_kinds,0,sizeof(ais_kinds));ais_fixed=0;ais_detail=full&&ai>=(int)AIS_FIRST_AI;ais_thread=GetCurrentThreadId();
    if(ais_detail)ais_logf("AI status: think begins, AI %d\r\n",ai);
    uint64_t result=ais_think(a,b,c,d,e,f);
    ais_thread=0;
    if(full)ais_logf("AI status: think ends, AI %d; status scores fixed %u; result kinds 1:%u 2:%u 4:%u 5:%u 17:%u 18:%u 19:%u 25:%u other:%u\r\n",ai,ais_fixed,
        ais_kinds[1],ais_kinds[2],ais_kinds[4],ais_kinds[5],ais_kinds[17],ais_kinds[18],ais_kinds[19],ais_kinds[25],ais_kinds[0]);
    return result;
}
/* scorer(context, out, ?, result): kind at +0x59, status at +0x5c, hit chance at +2; out = (gain, loss) */
static uint64_t ais_score_hook(uint64_t a,uint64_t b,uint64_t c,uint64_t d,uint64_t e,uint64_t f){
    uint64_t result=ais_score(a,b,c,d,e,f);
    if(ais_watching()&&ais_full_turn){
        unsigned char *ctx=(unsigned char*)a,*rec=(unsigned char*)d;int *out=(int*)b;
        if(mm_readable(rec,0x60)&&mm_readable(ctx,0x44)&&mm_readable(out,8)){
            unsigned kind=rec[0x59];ais_kinds[kind<32&&kind!=0?kind:0]++;
            if(kind&&ais_detail)ais_logf("  score kind %u status %d chance %d hostile %d -> %d / %d\r\n",kind,*(int*)(rec+0x5c),*(short*)(rec+2),*(int*)(ctx+0x40),out[0],out[1]);
        }
    }
    return result;
}
/* (v, v) -> (v, 0) or (0, -v); exported for the native test */
static void ais_split(int *out){
    if(out[0]!=out[1])return;
    int v=out[0];
    if(v>=0){out[1]=0;}
    else{out[0]=0;out[1]=v==(int)0x80000000?0x7fffffff:-v;}
}
static uint64_t ais_status_score_hook(uint64_t a,uint64_t b,uint64_t c,uint64_t d,uint64_t e,uint64_t f){
    uint64_t result=ais_status_score(a,b,c,d,e,f);
    if(ais_watching()&&mm_readable((void*)b,8)){
        int *out=(int*)b,game0=out[0],game1=out[1];
        if(ais_full_turn||ais_is_helpful_buff(a,game0))ais_split(out);
        if(out[0]!=game0||out[1]!=game1)ais_fixed++;
        if(ais_detail&&mm_readable((void*)d,0x10))
            ais_logf("  status score: status %d chance %d -> %d / %d (game: %d / %d)\r\n",*(int*)((unsigned char*)d+0xc),(int)e,out[0],out[1],game0,game1);
    }
    return result;
}

/* A hook replaces the first whole instructions (no RIP-relative ones) with a
 * jump to a relay slot near the game; the trampoline runs them and jumps back. */
static int ais_install(AisHook *h,unsigned char *relay,unsigned char *trampolines,unsigned i){
    unsigned char *site=mm_base+h->rva,*slot=relay+16*i,*tramp=trampolines+32*i;
    if(memcmp(site,h->original,h->length))return 0;
    if(h->call_site){
        int32_t displacement;
        memcpy(&displacement,site+1,sizeof displacement);
        *h->call=(AisFn)(void*)(site+5+displacement);
    }else{
        memcpy(tramp,site,h->length);mm_abs_jump(tramp+h->length,site+h->length);
        FlushInstructionCache(GetCurrentProcess(),tramp,32);
        *h->call=(AisFn)(void*)tramp;
    }
    mm_abs_jump(slot,h->hook);
    FlushInstructionCache(GetCurrentProcess(),slot,16);
    unsigned char patch[8];memset(patch,0x90,sizeof(patch));patch[0]=h->call_site?0xe8:0xe9;
    int32_t delta=(int32_t)(slot-(site+5));memcpy(patch+1,&delta,4);
    return mm_write(site,patch,h->length);
}
static void mm_install_ai_status(int status_enabled,int all_profiles,int buffs,int healing){
    if(!status_enabled&&!buffs&&!healing)return;
    ais_first_ai=status_enabled?(all_profiles?0:(int)AIS_FIRST_AI):256;
    ais_default_buffs=buffs;
    ais_default_healing=healing;
    AisHook hooks[4];
    unsigned count=0;
    if(status_enabled||buffs)
        hooks[count++]=(AisHook){AIS_THINK,{0x48,0x89,0x5c,0x24,0x10},5,(void*)ais_think_hook,&ais_think,0};
    if(status_enabled)
        hooks[count++]=(AisHook){AIS_SCORE,{0x48,0x89,0x5c,0x24,0x18},5,(void*)ais_score_hook,&ais_score,0};
    if(status_enabled||buffs)
        hooks[count++]=(AisHook){AIS_STATUS_SCORE,{0x48,0x89,0x6c,0x24,0x18},5,(void*)ais_status_score_hook,&ais_status_score,0};
    if(buffs||healing)
        hooks[count++]=(AisHook){0x2f5a73,{0xe8,0x38,0x1e,0x00,0x00},5,(void*)ais_prepare_hook,&ais_prepare,1};
    for(unsigned i=0;i<count;i++)if(memcmp(mm_base+hooks[i].rva,hooks[i].original,hooks[i].length)){
        ais_logf("AI status: disabled; native fingerprint mismatch at %#x.\r\n",hooks[i].rva);return;}
    unsigned char *relay=mm_near_page(),*trampolines=VirtualAlloc(0,4096,MEM_RESERVE|MEM_COMMIT,PAGE_EXECUTE_READWRITE);
    if(!relay||!trampolines){mm_log("AI status: disabled; allocation failed.\r\n");return;}
    for(unsigned i=0;i<count;i++)if(!ais_install(&hooks[i],relay,trampolines,i)){
        for(unsigned k=0;k<=i;k++)mm_write(mm_base+hooks[k].rva,hooks[k].original,hooks[k].length);
        mm_log("AI status: disabled; installation failed, hooks rolled back.\r\n");return;}
    if(buffs||healing)mm_log("AI Plus: default support weights enabled.\r\n");
    if(status_enabled)mm_log(all_profiles?"AI status: status scoring fixed for every AI number (stock AI included).\r\n"
        :"AI status: status scoring fixed for AI numbers 113 and up (stock AI unchanged).\r\n");
}

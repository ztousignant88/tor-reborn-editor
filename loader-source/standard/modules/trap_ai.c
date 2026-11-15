/* The native action list only collects equipped category-4 skills here.
 * Booby Trap is category 2. Offer that one skill to the dedicated profile
 * after the native list is built, keeping the ordinary cost and use checks. */
static unsigned mm_trap_profile;
static volatile LONG mm_trap_offers, mm_trap_scores, mm_trap_queued;
int rr_trap_ai_tile(const void *actor, uint32_t origin, uint32_t target);
int rr_trap_ai_ready(void);

static int mm_is_booby_trap(const unsigned char *action) {
    uint16_t skill,effect;
    memcpy(&skill,action+2,sizeof(skill));
    memcpy(&effect,action+6,sizeof(effect));
    return *action==4 && skill==327 && effect==607;
}

static int mm_trap_ai_actor(const unsigned char *actor) {
    if (!mm_readable(actor, 0x1d9) || actor[0x1d8] != mm_trap_profile) return 0;
    return !((unsigned char (*)(const void *,unsigned))(mm_base+0x33fc00))(actor,5);
}

static int mm_trap_ai_collect(const void *context, unsigned char *actions, int capacity) {
    const int count=((int (*)(const void *,void *,int))(mm_base+0x3bf120))(context,actions,capacity);
    const unsigned char *actor;
    memcpy(&actor,context,sizeof(actor));
    if (count<0 || count>=capacity || !mm_trap_ai_actor(actor)) return count;
    uint16_t skills[4];
    ((void *(*)(const void *,void *))(mm_base+0x330880))(actor+0x138,skills);
    for (unsigned i=0;i<4;i++) {
        if (skills[i]!=327) continue;
        unsigned char action[12]={0};
        ((void (*)(void *,unsigned))(mm_base+0x3be500))(action,327);
        uint16_t effect;
        memcpy(&effect,action+6,sizeof(effect));
        if (effect!=607 || !((unsigned char (*)(const void *,const void *,unsigned))(mm_base+0x3bc780))(action,actor,0))
            return count;
        memcpy(actions+12*count,action,sizeof(action));
        if (InterlockedIncrement(&mm_trap_offers)<=20) mm_log("Trap AI: Booby Trap added to the action list.\r\n");
        return count+1;
    }
    return count;
}

static int *mm_trap_ai_score(const unsigned char *ctx, int *out, const uint32_t *tile, unsigned flags) {
    const unsigned char *action;
    const unsigned char *actor;
    memcpy(&action,ctx+8,sizeof(action));
    memcpy(&actor,ctx+0x1a8,sizeof(actor));
    if (!mm_is_booby_trap(action) || !mm_trap_ai_actor(actor))
        return ((int *(*)(const void *,int *,const uint32_t *,unsigned))(mm_base+0x3c3e30))(ctx,out,tile,flags);
    uint32_t origin;
    memcpy(&origin,ctx,sizeof(origin));
    const int value = rr_trap_ai_tile(actor,origin,*tile);
    if (value && InterlockedIncrement(&mm_trap_scores)<=20) mm_log("Trap AI: legal Booby Trap target scored.\r\n");
    out[0]=value;
    out[1]=value?0:-1;
    return out;
}

/* 3BF9B0 writes a scored action's target to queue +0x2c. The active-skill
 * decoder normally takes queue +0x34, which belongs to auxiliary skills.
 * For the primary Booby Trap action, pass its scored tile to the decoder. */
static void *mm_trap_ai_command(void *out,const unsigned char *action,const unsigned char *target) {
    if (mm_is_booby_trap(action)) {
        target-=8;
        if (InterlockedIncrement(&mm_trap_queued)<=20) {
            int16_t tile[2];char message[96];
            memcpy(tile,target,sizeof(tile));
            snprintf(message,sizeof(message),"Trap AI: queued Booby Trap at (%d, %d).\r\n",tile[0],tile[1]);
            mm_log(message);
        }
    }
    return ((void *(*)(void *,const void *,const void *))(mm_base+0x412050))(out,action,target);
}

static void mm_install_trap_ai(unsigned profile) {
    if (profile<115 || profile>255 || !rr_trap_ai_ready()) return;
    const struct {unsigned address;unsigned char original[5];void *target;} sites[]={
        {0x3bf04b,{0xe8,0xd0,0,0,0},(void *)mm_trap_ai_collect},
        {0x2f5109,{0xe8,0x22,0xed,0x0c,0x00},(void *)mm_trap_ai_score},
        {0x3bf6bf,{0xe8,0x8c,0x29,0x05,0x00},(void *)mm_trap_ai_command},
    };
    const unsigned count=sizeof(sites)/sizeof(sites[0]);
    for (unsigned i=0;i<count;i++) {
        if (memcmp(mm_base+sites[i].address,sites[i].original,5)) {
            mm_log("Trap AI: unsupported native code.\r\n");
            return;
        }
    }
    unsigned char *relay=mm_near_page();
    if (!relay) return;
    for (unsigned i=0;i<count;i++) mm_abs_jump(relay+16*i,sites[i].target);
    FlushInstructionCache(GetCurrentProcess(),relay,16*count);
    mm_trap_profile=profile;
    for (unsigned i=0;i<count;i++) {
        unsigned char *site=mm_base+sites[i].address,patch[5]={0xe8};
        const int32_t offset=(int32_t)((relay+16*i)-(site+5));
        memcpy(patch+1,&offset,sizeof(offset));
        if (!mm_write(site,patch,sizeof(patch))) {
            for (unsigned j=0;j<=i;j++) mm_write(mm_base+sites[j].address,sites[j].original,5);
            mm_trap_profile=0;
            mm_log("Trap AI: hook installation failed.\r\n");
            return;
        }
    }
    char message[80];
    snprintf(message,sizeof(message),"Trap AI: profile %u prioritizes legal Booby Trap targets.\r\n",profile);
    mm_log(message);
}

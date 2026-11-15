/* Override Union Level reads, including generic flag readers used by menus.
 * The two native story-cap maintenance reads retain the real saved value so
 * story progression can continue normally while this module is active. */
typedef int (*MMFlagFn)(void*,unsigned);
static MMFlagFn mm_original_flag;
static volatile LONG mm_union_read_logs;
__attribute__((noinline)) static int mm_union_flag_hook(void *flags,unsigned id){
    uintptr_t caller=(uintptr_t)__builtin_return_address(0)-(uintptr_t)mm_base;
    if(id!=0x882u)return mm_original_flag(flags,id);
    int stored=mm_original_flag(flags,id);
    if(caller==0x2cf499u||caller==0x2cf653u)return stored;
    int maximum=*(int*)(mm_base+MM_NATIVE_MAXIMUM);
    int effective=maximum>0?maximum:1;
    if(InterlockedIncrement(&mm_union_read_logs)<=32){
        char line[160];snprintf(line,sizeof(line),"Union Level read: caller RVA 0x%llx, stored %d, effective %d.\r\n",(unsigned long long)caller,stored,effective);mm_log(line);
    }
    return effective;
}
static int mm_install_union_level(void){
    unsigned char *reader=mm_base+MM_FLAG_READER;
    if(memcmp(mm_base+MM_UNION_GETTER,fp_union_getter,sizeof(fp_union_getter))||
       memcmp(reader,fp_flag_reader,sizeof(fp_flag_reader))||
       memcmp(mm_base+0x2cf48f,fp_story_update,sizeof(fp_story_update))||
       memcmp(mm_base+0x2cf64e,fp_story_floor,sizeof(fp_story_floor))||
       memcmp(mm_base+MM_UNION_HUD_BLOCK,fp_union_hud,sizeof(fp_union_hud))){
        mm_log("Union Level module disabled: native reader or story-maintenance fingerprint mismatch.\r\n");return 0;
    }
    unsigned char *page=mm_near_page();if(!page){mm_log("Union Level module disabled: relay allocation failed.\r\n");return 0;}
    unsigned char *trampoline=page+64;
    memcpy(trampoline,reader,7);
    intptr_t distance=(mm_base+MM_FLAG_TABLE_POINTER)-(trampoline+7);
    if(distance<INT32_MIN||distance>INT32_MAX){VirtualFree(page,0,MEM_RELEASE);return 0;}
    int32_t displacement=(int32_t)distance;memcpy(trampoline+3,&displacement,4);
    mm_abs_jump(trampoline+7,reader+7);mm_original_flag=(MMFlagFn)trampoline;
    mm_abs_jump(page,(void*)mm_union_flag_hook);
    FlushInstructionCache(GetCurrentProcess(),page,96);
    unsigned char patch[7]={0xe9,0,0,0,0,0x90,0x90};
    displacement=(int32_t)(page-(reader+5));memcpy(patch+1,&displacement,4);
    if(!mm_write(reader,patch,sizeof(patch))){
        mm_write(reader,fp_flag_reader,sizeof(patch));
        mm_log("Union Level module disabled: reader hook failed; restoration attempted.\r\n");return 0;
    }
    /* Keep R8B=1 (propagate to the group's children), but pass visible=false
     * instead of true. This is the dedicated world-map Union Level group. */
    const unsigned char hide_group[]={0x31,0xd2,0x90,0x90};
    if(!mm_write(mm_base+MM_UNION_HUD_BLOCK+MM_UNION_HUD_VISIBLE_OFFSET,hide_group,sizeof(hide_group))){
        mm_write(reader,fp_flag_reader,sizeof(patch));
        mm_write(mm_base+MM_UNION_HUD_BLOCK,fp_union_hud,sizeof(fp_union_hud));
        mm_log("Union Level module disabled: HUD patch failed; restoration attempted.\r\n");return 0;
    }
    mm_log("Union Level module 005 ready: generic/capped reads use native maximum; story maintenance retained; world-map Union Level group hidden. Story flags and saves are not rewritten.\r\n");
    return 1;
}

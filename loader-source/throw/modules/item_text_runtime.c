/* PC 1.0.2. Included after skill_slots.c for the archive verifier. */
static int mit_install(void){
    static const unsigned sites[]={
        0x2e4ebc,0x3338a9,0x333c3a,0x3f1166,0x494486,0x521b4d,0x52c8d1,0x52c9e2
    };
    static const unsigned char original[]={0x05,0x9f,0x09,0,0};
    const unsigned count=sizeof(sites)/sizeof(sites[0]);
    for(unsigned i=0;i<count;i++){
        if(memcmp(mm_base+sites[i],original,sizeof(original)))return 0;
    }
    unsigned char *relay=mm_near_page();
    if(!relay)return 0;
    /* The native add receives the zero-based commodity text ID in EAX.
     * Preserve the other registers and apply the same ADD for stock IDs.
     * IDs 732–999 start at index 4008. Bad IDs use the default item text. */
    static const unsigned char lookup[]={
        0x3d,0xdc,0x02,0,0,   /* cmp eax, 732 */
        0x72,0x0f,           /* jb stock */
        0x3d,0xe8,0x03,0,0,  /* cmp eax, 1000 */
        0x73,0x06,           /* jae default */
        0x05,0xcc,0x0c,0,0,  /* add eax, 3276 */
        0xc3,                /* ret */
        0x31,0xc0,           /* default: xor eax, eax */
        0x05,0x9f,0x09,0,0,  /* stock: add eax, 2463 */
        0xc3
    };
    unsigned char branches[sizeof(sites)/sizeof(sites[0])][5];
    for(unsigned i=0;i<count;i++){
        const intptr_t delta=(intptr_t)relay-(intptr_t)(mm_base+sites[i]+5);
        if(delta<INT32_MIN||delta>INT32_MAX){
            VirtualFree(relay,0,MEM_RELEASE);
            return 0;
        }
        const int32_t relative=(int32_t)delta;
        branches[i][0]=0xe8;
        memcpy(branches[i]+1,&relative,sizeof(relative));
    }
    memcpy(relay,lookup,sizeof(lookup));
    FlushInstructionCache(GetCurrentProcess(),relay,sizeof(lookup));
    for(unsigned i=0;i<count;i++){
        if(!mm_write(mm_base+sites[i],branches[i],sizeof(original))){
            int restored=1;
            for(unsigned n=i+1;n>0;n--){
                if(!mm_write(mm_base+sites[n-1],original,sizeof(original)))restored=0;
            }
            if(restored)VirtualFree(relay,0,MEM_RELEASE);
            return 0;
        }
    }
    return 1;
}

static void mm_install_item_text(const wchar_t *config){
    const wchar_t *section=L"ModPreparationItemText";
    if(!GetPrivateProfileIntW(section,L"Enabled",0,config))return;
    if(!mps_verify_archive(config,section)||!mit_install()){
        mm_log("Mod Preparation item text disabled: archive or native hook mismatch.\r\n");
        return;
    }
    mm_log("Mod Preparation item text: IDs 1732-1999.\r\n");
}

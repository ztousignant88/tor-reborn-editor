/* Optional availability gates only. Native action execution and history stay
 * intact, and no saved story flags or per-unit AI preferences are rewritten. */
static int mm_unlock_feature(unsigned rva,const unsigned char *original,size_t size,int enabled,const char *name){
    char line[192];
    if(!enabled){snprintf(line,sizeof(line),"Early unlock: %s uses normal story availability.\r\n",name);mm_log(line);return 1;}
    if(memcmp(mm_base+rva,original,size)){
        snprintf(line,sizeof(line),"Early unlock: %s refused; native predicate fingerprint mismatch.\r\n",name);mm_log(line);return 0;
    }
    const unsigned char available[]={0xb8,1,0,0,0,0xc3};
    if(!mm_write(mm_base+rva,available,sizeof(available))){
        mm_write(mm_base+rva,original,sizeof(available));return 0;
    }
    snprintf(line,sizeof(line),"Early unlock: %s availability enabled; saved story settings unchanged.\r\n",name);mm_log(line);return 1;
}
static void mm_install_early_unlocks(int auto_battle,int chariot){
    mm_unlock_feature(MM_AUTO_BATTLE,fp_auto_battle,sizeof(fp_auto_battle),auto_battle,"Auto Battle / AI Control");
    mm_unlock_feature(MM_CHARIOT,fp_chariot,sizeof(fp_chariot),chariot,"Chariot");
}

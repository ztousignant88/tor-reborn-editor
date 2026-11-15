/* PC 1.0.2. Community memberships live in the runtime, so disabling the
 * module restores the original membership without rewriting any gear rows. */
#define EQS_FIRST 7u
#define EQS_LIMIT 39u
#define EQS_EQUIPMENT 761u
#define EQS_SKILLS 800u
#define EQS_MEMBERS_AT (8u+2u*(EQS_LIMIT-EQS_FIRST))
#define EQS_FILE_SIZE (EQS_MEMBERS_AT+EQS_EQUIPMENT)
#define EQS_EQUIP_OFFSET 0x6a

typedef void (*EqsScan)(unsigned char *,const uint16_t *);
typedef void *(*EqsManager)(void);
typedef const unsigned char *(*EqsEquipment)(void *,uint16_t);
typedef struct {void *base;unsigned char *next;} EqsCursor;
typedef void (*EqsCodec)(unsigned char *,uint32_t,EqsCursor *);

static EqsScan eqs_stock_scan;
static EqsManager eqs_manager;
static EqsEquipment eqs_equipment;
static EqsCodec eqs_read,eqs_write;
static unsigned char eqs_owners[EQS_EQUIPMENT];

static unsigned eqs_owner(uint16_t equipment) {
    return equipment<EQS_EQUIPMENT ? eqs_owners[equipment] : 0;
}

static int eqs_has_custom(const uint16_t *equipment) {
    for (unsigned i=0;i<7;i++) if (eqs_owner(equipment[i])) return 1;
    return 0;
}

static void eqs_scan(unsigned char *skills,const uint16_t *equipment) {
    if (!eqs_has_custom(equipment)) {
        eqs_stock_scan(skills,equipment);
        return;
    }
    unsigned counts[EQS_LIMIT]={0};
    for (unsigned i=0;i<7;i++) {
        const uint16_t item=equipment[i];
        if (!item) continue;
        unsigned group=eqs_owner(item);
        if (!group) {
            const unsigned char *record=eqs_equipment(eqs_manager(),item);
            group=record ? record[0x77] : 0;
            if (group>=EQS_FIRST) group=0;
        }
        counts[group]++;
    }
    skills[1]=0;
    for (unsigned id=1;id<EQS_LIMIT;id++) {
        if (counts[id]>=3) skills[1]=(unsigned char)id;
    }
}

/* The only two unit serializers (party and battle) share the call sites
 * below. In each, equipment sits 0x6a bytes before the skill structure.
 * The first two encoded skill bytes are the header and the cached set ID. */
static void eqs_write_unit(unsigned char *skills,uint32_t version,EqsCursor *cursor) {
    unsigned char *encoded=cursor->next;
    eqs_write(skills,version,cursor);
    const uint16_t *equipment=(const void *)(skills-EQS_EQUIP_OFFSET);
    if (skills[1]>=EQS_FIRST || eqs_has_custom(equipment)) {
        unsigned char stock[2]={0,0};
        eqs_stock_scan(stock,equipment);
        encoded[1]=stock[1];
    }
}

static void eqs_read_unit(unsigned char *skills,uint32_t version,EqsCursor *cursor) {
    eqs_read(skills,version,cursor);
    const uint16_t *equipment=(const void *)(skills-EQS_EQUIP_OFFSET);
    if (skills[1]>=EQS_FIRST || eqs_has_custom(equipment)) eqs_scan(skills,equipment);
}

static int eqs_decode(const unsigned char *data,uint16_t *skills,unsigned char *owners) {
    if (memcmp(data,"TORSET01",8)||data[EQS_MEMBERS_AT]) return 0;
    for (unsigned id=EQS_FIRST;id<EQS_LIMIT;id++) {
        uint16_t skill;
        memcpy(&skill,data+8+2*(id-EQS_FIRST),2);
        if (skill>=EQS_SKILLS) return 0;
        skills[id]=skill;
    }
    for (unsigned id=1;id<EQS_EQUIPMENT;id++) {
        const unsigned group=data[EQS_MEMBERS_AT+id];
        if (group && (group<EQS_FIRST || group>=EQS_LIMIT || !skills[group])) return 0;
    }
    memcpy(owners,data+EQS_MEMBERS_AT,EQS_EQUIPMENT);
    return 1;
}

#ifndef EQS_UNIT_TEST
#include "equipment_set_free_skills.c"
static void mm_install_equipment_sets(const wchar_t *config) {
    if (!GetPrivateProfileIntW(L"ModPreparationEquipmentSets",L"Enabled",0,config)) return;
    int free_skill=GetPrivateProfileIntW(L"ModPreparationEquipmentSets",L"SlotFreeSkills",0,config)==1;
    wchar_t path[32768];
    wcscpy(path,config);
    wchar_t *slash=wcsrchr(path,L'\\');
    if (!slash) return;
    wcscpy(slash+1,L"modprep-equipment-sets.bin");
    HANDLE file=CreateFileW(path,GENERIC_READ,FILE_SHARE_READ,NULL,OPEN_EXISTING,FILE_ATTRIBUTE_NORMAL,NULL);
    unsigned char data[EQS_FILE_SIZE+1];
    DWORD length=0;
    int read_ok=file!=INVALID_HANDLE_VALUE && ReadFile(file,data,sizeof(data),&length,NULL);
    if (file!=INVALID_HANDLE_VALUE) CloseHandle(file);
    uint16_t skills[EQS_LIMIT];
    memcpy(skills,mm_base+0x693c08,2*EQS_FIRST);
    if (!read_ok || length!=EQS_FILE_SIZE || !eqs_decode(data,skills,eqs_owners)) {
        mm_log("Equipment sets: invalid project definitions. Original sets retained.\r\n");
        return;
    }
    const struct {unsigned rva,target;void *replacement;unsigned char opcode;} calls[]={
        {0x330784,0x447c50,(void *)eqs_scan,0xe8},
        {0x44120a,0x447c50,(void *)eqs_scan,0xe8},
        {0x33035a,0x447b30,(void *)eqs_write_unit,0xe8},
        {0x32fed2,0x447980,(void *)eqs_read_unit,0xe8},
        {0x334efb,0x447c50,(void *)eqs_scan,0xe9},
        {0x33568b,0x447c50,(void *)eqs_scan,0xe9},
        {0x423373,0x3bfb20,(void *)eqs_collect_free_skill,0xe8},
    };
    uint16_t worn_skills[EQS_LIMIT]={0};
    memcpy(worn_skills,mm_base+0x693c18,2*EQS_FIRST);
    /* Match the skills the stock game applies directly while worn. */
    for(unsigned id=EQS_FIRST;id<EQS_LIMIT;id++){
        for(unsigned stock=1;stock<EQS_FIRST;stock++){
            if(skills[id]==worn_skills[stock])worn_skills[id]=skills[id];
        }
    }
    const struct {unsigned rva;unsigned char code[7];unsigned worn;} readers[]={
        {0x4484a5,{0x48,0x8d,0x0d,0x5c,0xb7,0x24,0x00},0},
        {0x448eba,{0x48,0x8d,0x15,0x47,0xad,0x24,0x00},0},
        {0x448485,{0x48,0x8d,0x0d,0x8c,0xb7,0x24,0x00},1},
    };
    enum { CALLS=sizeof(calls)/sizeof(*calls), READERS=sizeof(readers)/sizeof(*readers),
           SITES=CALLS+READERS, RELAYS=CALLS*16 };
    const unsigned call_count=CALLS-!free_skill;
    unsigned char original[SITES][7],patch[SITES][7];
    for (unsigned i=0;i<call_count;i++) {
        const int32_t offset=(int32_t)(calls[i].target-(calls[i].rva+5));
        original[i][0]=patch[i][0]=calls[i].opcode;
        memcpy(original[i]+1,&offset,4);
        if (memcmp(mm_base+calls[i].rva,original[i],5)) goto unsupported;
    }
    for (unsigned i=0;i<READERS;i++) {
        memcpy(original[CALLS+i],readers[i].code,7);
        if (memcmp(mm_base+readers[i].rva,original[CALLS+i],7)) goto unsupported;
    }
    unsigned char *relay=mm_near_page();
    if (!relay) goto unsupported;
    unsigned char *table=relay+RELAYS;
    memcpy(table,skills,sizeof(skills));
    memcpy(table+sizeof(skills),worn_skills,sizeof(worn_skills));
    for (unsigned i=0;i<call_count;i++) {
        mm_abs_jump(relay+16*i,calls[i].replacement);
        const int32_t offset=(int32_t)((relay+16*i)-(mm_base+calls[i].rva+5));
        memcpy(patch[i]+1,&offset,4);
    }
    for (unsigned i=0;i<READERS;i++) {
        memcpy(patch[CALLS+i],original[CALLS+i],3);
        const int32_t offset=(int32_t)(table+readers[i].worn*sizeof(skills)-(mm_base+readers[i].rva+7));
        memcpy(patch[CALLS+i]+3,&offset,4);
    }
    eqs_stock_scan=(EqsScan)(mm_base+0x447c50);
    eqs_manager=(EqsManager)(mm_base+0x2e6f20);
    eqs_equipment=(EqsEquipment)(mm_base+0x2e6ab0);
    eqs_write=(EqsCodec)(mm_base+0x447b30);
    eqs_read=(EqsCodec)(mm_base+0x447980);
    FlushInstructionCache(GetCurrentProcess(),relay,RELAYS);
    unsigned sites[SITES];
    for(unsigned i=0;i<CALLS;i++)sites[i]=calls[i].rva;
    for(unsigned i=0;i<READERS;i++)sites[CALLS+i]=readers[i].rva;
    /* Install the readers before any path can produce an extended live ID. */
    const unsigned order[]={CALLS,CALLS+1,CALLS+2,2,3,0,1,4,5,6};
    for (unsigned n=0;n<call_count+READERS;n++) {
        unsigned i=order[n];
        if (!mm_write(mm_base+sites[i],patch[i],i<CALLS?5:7)) {
            for (unsigned j=n+1;j>0;j--) {
                i=order[j-1];
                mm_write(mm_base+sites[i],original[i],i<CALLS?5:7);
            }
            mm_log("Equipment sets: hooks failed and were rolled back.\r\n");
            return;
        }
    }
    mm_log("Equipment sets: community bonuses enabled.\r\n");
    return;
unsupported:
    mm_log("Equipment sets: unsupported native code. Original sets retained.\r\n");
}
#endif

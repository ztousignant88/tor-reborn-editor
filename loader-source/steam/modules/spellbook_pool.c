/* Disposable extended automatic loadout helpers. A unit's equipped spell
 * slots store spellbook item IDs. Its effect comes from the commodity row. */
#include <stdint.h>
#include <string.h>

enum { BOOK_CAPACITY=1000, EFFECT_CAPACITY=1030, BOOK_TYPE=0x22 };
enum { PARTY_COUNT=105, PARTY_STRIDE=0x7e0, PARTY_START=0x1acf8, CORE=0x40, SPELL_SLOTS=0xfc };

typedef void (*ApplyProfile)(unsigned char *,uint16_t,uint16_t,uint16_t *,uint32_t *);
typedef void (*FilterLevel)(uint16_t *,uint32_t,int);
typedef uint16_t (*UnitLevel)(const unsigned char *);
typedef uint16_t (*ItemQuantity)(const void *,uint16_t);

struct Families {
    const uint16_t *ids;
    uint32_t count;
};

static uint16_t book_u16(const unsigned char *p){
    uint16_t value;
    memcpy(&value,p,sizeof(value));
    return value;
}

static uint32_t book_u32(const unsigned char *p){
    uint32_t value;
    memcpy(&value,p,sizeof(value));
    return value;
}

__declspec(dllexport) int build_book_pool(
    uint16_t *out,const uint16_t *inventory,const unsigned char *books,
    const unsigned char *effects,const struct Families *families
){
    unsigned char allowed[EFFECT_CAPACITY]={0};
    const unsigned book_count=book_u32(books+4);
    const unsigned effect_count=book_u32(effects+4);
    if(book_count>BOOK_CAPACITY||effect_count>EFFECT_CAPACITY||
       book_u32(books+12)!=56||book_u32(effects+12)!=180||families->count>4)return 0;
    const unsigned char *effect=effects+book_u32(effects+8);
    for(unsigned i=1;i<effect_count;i++){
        const unsigned group=book_u16(effect+i*180+0xa4);
        if(!group)continue;
        for(unsigned j=0;j<families->count;j++){
            if(group==families->ids[j]){
                allowed[i]=1;
                break;
            }
        }
    }
    const unsigned char *book=books+book_u32(books+8);
    for(unsigned i=0;i<book_count;i++,book+=56){
        const unsigned effect_id=book_u16(book+4);
        out[i]=book[2]==BOOK_TYPE&&effect_id<effect_count&&allowed[effect_id]?inventory[i]:0;
    }
    memset(out+book_count,0,(BOOK_CAPACITY-book_count)*sizeof(*out));
    return 1;
}

__declspec(dllexport) uint16_t pick_spellbook(const uint16_t *pool,uint32_t *seed){
    unsigned eligible=0;
    for(unsigned i=0;i<BOOK_CAPACITY;i++)eligible+=pool[i]!=0;
    if(!eligible)return 0;
    *seed=*seed*0x343fdu+0x269ec3u;
    unsigned choice=((*seed>>16)&0x7fff)%eligible;
    for(unsigned i=0;i<BOOK_CAPACITY;i++){
        if(pool[i]&&choice--==0)return (uint16_t)(1000+i);
    }
    return 0;
}

__declspec(dllexport) uint16_t *pick_spellbook_slot(
    const uint16_t *pool,uint16_t *out,uint32_t *seed
){
    *out=pick_spellbook(pool,seed);
    return out;
}

/* Model the two incoming native paths using C-managed scratch arrays.
 * The core entry takes an explicit 1,000-word pool in this fixture. */
__declspec(dllexport) void npc_spellbook_loadout(
    const unsigned char *image,unsigned char *unit,const unsigned char *entry,uint32_t *seed
){
    const uint16_t profile=entry[0x1b];
    if(!profile)return;
    for(unsigned i=0;i<4;i++)if(book_u16(unit+SPELL_SLOTS+2*i))return;
    uint16_t pool[BOOK_CAPACITY];
    for(unsigned i=0;i<BOOK_CAPACITY;i++)pool[i]=999;
    const uint16_t level=((UnitLevel)(image+0x333c20))(unit);
    ((FilterLevel)(image+0x443c90))(pool,unit[0x49],(int16_t)level);
    ((ApplyProfile)(image+0x4450c0))(unit,profile,level,pool,seed);
}

__declspec(dllexport) void party_spellbook_loadout(
    const unsigned char *image,unsigned char *state,unsigned unit_index
){
    if(unit_index>=PARTY_COUNT)return;
    unsigned char *record=state+PARTY_START+unit_index*PARTY_STRIDE;
    if(!record[0])return;
    const unsigned char *books;
    memcpy(&books,image+0xd68318,sizeof(books));
    const unsigned count=book_u32(books+4);
    if(count>BOOK_CAPACITY||book_u32(books+12)!=56)return;

    unsigned char *unit=record+CORE;
    memset(unit+SPELL_SLOTS,0,8);
    const unsigned char *inventory=image+0xed3960;
    const unsigned char *rows=books+book_u32(books+8);
    uint16_t pool[BOOK_CAPACITY]={0};
    for(unsigned i=0;i<count;i++){
        if(rows[i*56+2]==BOOK_TYPE){
            pool[i]=((ItemQuantity)(image+0x39c8c0))(inventory,(uint16_t)(1000+i));
        }
    }
    for(unsigned p=0;p<PARTY_COUNT;p++){
        const unsigned char *member=inventory+PARTY_START+p*PARTY_STRIDE;
        if(!member[0]||member+CORE==unit)continue;
        for(unsigned i=0;i<4;i++){
            const unsigned item=book_u16(member+CORE+SPELL_SLOTS+2*i);
            if(item>=1000&&item<1000+count&&pool[item-1000])pool[item-1000]--;
        }
    }
    const int level=(int)book_u32(image+0xd68280);
    ((FilterLevel)(image+0x443c90))(pool,unit[0x49],level);
    uint32_t seed=1;
    ((ApplyProfile)(image+0x4450c0))(unit,1,(uint16_t)level,pool,&seed);
}

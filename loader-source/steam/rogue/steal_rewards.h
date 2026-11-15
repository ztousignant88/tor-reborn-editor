#ifndef STEAL_REWARDS_H
#define STEAL_REWARDS_H
#define STEAL_GOTH_CAP 99999999u
static uint32_t money_at(const void *p,unsigned off){uint32_t v;memcpy(&v,(const byte*)p+off,4);return v;}
static void set_money(void *p,unsigned off,uint32_t v){memcpy((byte*)p+off,&v,4);}
static const byte *native_commodity_row(uint16_t item) {
    if(!base || item<1000)return NULL;
    byte *table=pointer(base,0xd68318);
    unsigned index=item-1000u;
    if(!table || money_at(table,12)!=56 || index>=money_at(table,4))return NULL;
    return table+money_at(table,8)+index*56u;
}
static int loot_item_room(void *inventory,uint16_t item,unsigned quantity) {
    unsigned cap=0,index=0;
    if(item && item<STEAL_ARMAMENT_COUNT){
        const byte *row=equipment_definition(item);
        if(!row || !equipment_tier(item))return 0;
        cap=row[0x50]?1u:999u;index=item;
    }else if(item>=1000 && item<2000){
        const byte *row=commodity_row?commodity_row(item):NULL;
        if(!row || !row[2] || row[0x0d])return 0;
        cap=row[0x0c]?1u:999u;index=0x300u+item-1000u;
    }else return 0;
    int count = added_armament(item) ? equipment_inventory_count(inventory,item)
                                     : word(inventory,index*2u);
    return quantity && quantity<=cap && count>=0 && (unsigned)count<=cap-quantity;
}
static unsigned loot_candidates(void *target,void *inventory,unsigned actor,unsigned slots[4],unsigned weights[4]) {
    const byte *row=encounter_row?encounter_row((byte*)target+0x138):NULL;
    if(!row || actor>=30)return 0;
    unsigned count=0;
    for(unsigned slot=0;slot<4;++slot){
        unsigned off=0x76+4u*slot,quantity=row[off+2],weight=row[off+3];
        uint16_t item=word(row,off);
        if(!(state.loot[actor]&(1u<<slot)) && weight && loot_item_room(inventory,item,quantity)){
            slots[count]=slot;weights[count]=weight;++count;
        }
    }
    return count;
}
static unsigned gold_amount(void *target,void *manager,unsigned actor) {
    if(actor>=30 || (state.gold&(1u<<actor)) || !effective_level)return 0;
    unsigned level=effective_level((byte*)target+0x138);
    uint32_t current=money_at(manager,0x14),earned=money_at(manager,0x1c);
    if(!level || level>255 || current>=STEAL_GOTH_CAP)return 0;
    unsigned amount=level*100u;
    if(amount>STEAL_GOTH_CAP-current)amount=STEAL_GOTH_CAP-current;
    return amount<=UINT32_MAX-earned?amount:0;
}
static int theft_reward_available(void *target,void *manager,unsigned actor,int role) {
    if(!theft_role_enabled(role))return 0;
    if(role==THEFT_GOLD)return gold_amount(target,manager,actor)!=0;
    if(role==THEFT_LOOT){unsigned slots[4],weights[4];return loot_candidates(target,(byte*)manager+0x64,actor,slots,weights)!=0;}
    unsigned slots[7];return equipment_candidates_for(target,(byte*)manager+0x64,slots,role)!=0;
}
static int loot_commit(void *job,void *target,void *inventory,unsigned actor,uint16_t *item,unsigned *quantity,unsigned *slot_out) {
    unsigned slots[4],weights[4],count;
    if(!job || !add_item || actor>=30)return EQUIPMENT_REJECTED;
    if(equipment_action_seen(job))return EQUIPMENT_DUPLICATE;
    count=loot_candidates(target,inventory,actor,slots,weights);if(!count)return EQUIPMENT_NOTHING;
    unsigned total=0;for(unsigned i=0;i<count;++i)total+=weights[i];
    uint32_t rng=state.rng;unsigned draw=equipment_draw(&rng,total),selected=0;
    while(selected+1<count && draw>=weights[selected]){draw-=weights[selected];++selected;}
    const byte *row=encounter_row((byte*)target+0x138);unsigned slot=slots[selected],offset=0x76+slot*4u;
    uint16_t reward=word(row,offset);unsigned n=row[offset+2];
    if(!equipment_action_mark(job))return EQUIPMENT_REJECTED;
    if (added_armament(reward)) {
        if (!equipment_try_award_added(inventory,reward,n)) {
            equipment_forget_action(job);return EQUIPMENT_REJECTED;
        }
    } else {
        unsigned counter=reward<1000?reward:0x300u+reward-1000u;
        uint16_t before=word(inventory,counter*2u);
        for(unsigned i=0;i<n;++i){byte result[2]={0};add_item(inventory,result,reward);
            if(!result[0] || word(inventory,counter*2u)!=(unsigned)before+i+1u){
                memcpy((byte*)inventory+counter*2u,&before,2);equipment_forget_action(job);return EQUIPMENT_REJECTED;
            }
        }
    }
    state.loot[actor]|=(byte)(1u<<slot);state.rng=rng;
    *item=reward;*quantity=n;*slot_out=slot;return EQUIPMENT_ADDED;
}
static int gold_commit(void *job,void *target,void *manager,unsigned actor,unsigned *amount_out) {
    if(!job || actor>=30)return EQUIPMENT_REJECTED;
    if(equipment_action_seen(job))return EQUIPMENT_DUPLICATE;
    unsigned amount=gold_amount(target,manager,actor);if(!amount)return EQUIPMENT_NOTHING;
    if(!equipment_action_mark(job))return EQUIPMENT_REJECTED;
    set_money(manager,0x14,money_at(manager,0x14)+amount);
    set_money(manager,0x1c,money_at(manager,0x1c)+amount);
    state.gold|=1u<<actor;*amount_out=amount;return EQUIPMENT_ADDED;
}
#endif

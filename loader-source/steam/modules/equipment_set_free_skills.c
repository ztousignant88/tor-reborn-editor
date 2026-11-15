/* The battle command picker reserves 300 entries. Add the current set's
 * active skill after the stock collector has gathered the regular slots. */
static int eqs_collect_free_skill(uint16_t *out,const unsigned char *unit){
    typedef int (*Collect)(uint16_t *,const unsigned char *);
    typedef uint16_t (*SetSkill)(const unsigned char *);
    int count=((Collect)(mm_base+0x3bfb20))(out,unit);
    const unsigned char *status=unit+0xbe;
    if(!status[1] || status[1]>=EQS_LIMIT || count<0 || count>=300)return count;
    uint16_t skill=((SetSkill)(mm_base+0x4484a0))(status);
    const unsigned char *table;
    memcpy(&table,mm_base+0xd682f8,sizeof(table));
    if(!skill || !table)return count;
    uint32_t rows,offset,stride;
    memcpy(&rows,table+4,sizeof(rows));
    memcpy(&offset,table+8,sizeof(offset));
    memcpy(&stride,table+12,sizeof(stride));
    if(skill>=rows || (stride!=102 && stride!=166) || table[offset+(size_t)skill*stride+2]!=2)return count;
    for(int i=0;i<count;i++)if(out[i]==skill)return count;
    out[count]=skill;
    return count+1;
}

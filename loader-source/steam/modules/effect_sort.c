/* PC 1.0.2 sorter prototype. Keep the 902-entry saved order and append
 * expanded effect IDs in their caller order. The high flag stays intact. */
#include <stdint.h>
#include <string.h>

enum { STOCK_EFFECTS=902, SORT_CAPACITY=1030, ORDER_OFFSET=0x2090 };

__declspec(dllexport) void sort_effects(const unsigned char *context,uint16_t *items,int count){
    if(count<2||count>SORT_CAPACITY)return;
    uint16_t sorted[SORT_CAPACITY];
    unsigned char written[SORT_CAPACITY]={0};
    int used=0;
    for(unsigned index=0;index<STOCK_EFFECTS;index++){
        uint16_t ident;
        memcpy(&ident,context+ORDER_OFFSET+2*index,2);
        if(ident>=STOCK_EFFECTS)continue;
        for(int j=0;j<count;j++){
            if(!written[j]&&(items[j]&0x7fff)==ident){
                sorted[used++]=items[j];
                written[j]=1;
                break;
            }
        }
    }
    for(int j=0;j<count;j++)if(!written[j])sorted[used++]=items[j];
    memcpy(items,sorted,(size_t)used*sizeof(*items));
}

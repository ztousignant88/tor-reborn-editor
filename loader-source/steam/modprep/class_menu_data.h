#ifndef MP_CLASS_MENU_DATA_H
#define MP_CLASS_MENU_DATA_H
#include <stdint.h>
#include <stddef.h>
#include <string.h>
typedef struct {const unsigned char *rows,*races;uint32_t count,templates;} MP_ClassMenuData;
#define MP_MENU_TEMPLAR_ALIAS 3u
#define MP_TEMPLAR_FIRST 81u
#define MP_TEMPLAR_LAST 96u
#define MP_TEMPLAR_PICTURE_BASE 4096u
static uint32_t mpc_u32(const unsigned char *p){return(uint32_t)p[0]|((uint32_t)p[1]<<8)|((uint32_t)p[2]<<16)|((uint32_t)p[3]<<24);}
static uint16_t mpc_u16(const unsigned char *p){return(uint16_t)((unsigned)p[0]|((unsigned)p[1]<<8));}
static uint32_t mpc_crc(const unsigned char *p,size_t n){uint32_t v=0xffffffff;while(n--){v^=*p++;for(unsigned i=0;i<8;i++)v=(v>>1)^((v&1)?0xedb88320:0);}return ~v;}
static int mpc_open(MP_ClassMenuData *out,const unsigned char *data,size_t size,const unsigned char project[32],const unsigned char allocation[32]){
    if(!out)return 0;memset(out,0,sizeof(*out));
    if(!data||size<100||memcmp(data,"TORCLM02",8)||mpc_u32(data+8)!=2)return 0;
    uint32_t n=mpc_u32(data+12);size_t end=96+(size_t)n*8;
    if(!n||n>65536||mpc_u32(data+16)!=8||mpc_u32(data+20)!=96||mpc_u32(data+24)!=size||end+4>size||mpc_crc(data+96,size-96)!=mpc_u32(data+28))return 0;
    uint32_t templates=mpc_u32(data+end);
    if(!templates||templates>65536||size!=end+4+templates||memcmp(data+32,project,32)||memcmp(data+64,allocation,32))return 0;
    for(uint32_t c=0;c<n;c++){
        const unsigned char *r=data+96+(size_t)c*8;uint32_t mode=mpc_u32(r+4);
        if(mode>MP_MENU_TEMPLAR_ALIAS||(mode&&(!mpc_u16(r)||mpc_u16(r+2)==65535))||
           (mode==1&&c<80)||(mode==2&&(!c||c>=80||c==17||c==18)))return 0;
        if(mode==MP_MENU_TEMPLAR_ALIAS){
            if(c<MP_TEMPLAR_FIRST||c>MP_TEMPLAR_LAST||mpc_u16(r)!=mpc_u16(data+96+(size_t)(c-80)*8))return 0;
            unsigned icon=mpc_u16(r+2);
            if(icon<=MP_TEMPLAR_PICTURE_BASE||icon>MP_TEMPLAR_PICTURE_BASE+7||icon==MP_TEMPLAR_PICTURE_BASE+6)return 0;
        }
    }
    for(uint32_t t=0;t<templates;t++){unsigned r=data[end+4+t];if(r>12&&r!=255)return 0;}
    out->rows=data+96;out->count=n;out->races=data+end+4;out->templates=templates;return 1;
}
#endif

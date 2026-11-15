#include "permissions.h"
#include <string.h>

static uint32_t mp_u32(const uint8_t *p){
    return (uint32_t)p[0]|((uint32_t)p[1]<<8)|((uint32_t)p[2]<<16)|((uint32_t)p[3]<<24);
}
static uint32_t mp_crc32(const uint8_t *p,size_t n){
    uint32_t crc=UINT32_C(0xffffffff);
    while(n--){crc^=*p++;for(unsigned b=0;b<8;b++)crc=(crc>>1)^((crc&1)?UINT32_C(0xedb88320):0);}
    return ~crc;
}
int mp_permissions_open(MP_Permissions *out,const void *data,size_t size){
    if(!out)return 0;
    memset(out,0,sizeof(*out));
    if(!data||size<112||size>64u*1024u*1024u)return 0;
    const uint8_t *p=(const uint8_t*)data;
    if(memcmp(p,"TORPERM1",8)||mp_u32(p+8)!=1||mp_u32(p+12)!=112)return 0;
    uint32_t g=mp_u32(p+16),c=mp_u32(p+20),t=mp_u32(p+24),s=mp_u32(p+28);
    uint32_t m=mp_u32(p+32),a=mp_u32(p+36),n=mp_u32(p+40),crc=mp_u32(p+44);
    if(!g||g>65536||!c||c>65536||!t||t>65536||s!=(g+7)/8||m!=112)return 0;
    if((uint64_t)m+(uint64_t)c*s!=a||(uint64_t)a+(uint64_t)t*4!=n||n!=size)return 0;
    if(mp_crc32(p+112,size-112)!=crc)return 0;
    for(uint32_t i=0;i<t;i++)if(mp_u32(p+a+(size_t)i*4)>=g)return 0;
    if(g%8)for(uint32_t i=0;i<c;i++)if(p[m+(size_t)i*s+s-1]>>(g%8))return 0;
    *out=(MP_Permissions){p,g,c,t,s,m,a};return 1;
}
int mp_permissions_group(const MP_Permissions *view,uint32_t template_id,uint32_t *group){
    if(!view||!view->data||!group||template_id>=view->templates)return 0;
    *group=mp_u32(view->data+view->assign+(size_t)template_id*4);return 1;
}
int mp_permissions_allows(const MP_Permissions *view,uint32_t template_id,uint32_t class_id,int *allowed){
    uint32_t group;
    if(!allowed||!view||class_id>=view->classes||!mp_permissions_group(view,template_id,&group))return 0;
    *allowed=(view->data[view->matrix+(size_t)class_id*view->stride+group/8]>>(group%8))&1;return 1;
}

#ifndef MP_INFO_PAGES_CORE_H
#define MP_INFO_PAGES_CORE_H
#include <stdint.h>
#include <string.h>
#define MPI_MAX_CLASSES 255
/* AA7..ABA are page types; ABC is a native layout field. */
#define MPI_MAX_PAGES 21
#define MPI_NATIVE_ROWS 79
typedef struct {unsigned count,class_pages,capacity;unsigned char type[MPI_MAX_PAGES];int item_page;} MP_InfoPlan;
static int mpi_plan(MP_InfoPlan *out,const unsigned char *old,unsigned old_count,unsigned classes,unsigned capacity){
    if(!out)return 0;memset(out,0,sizeof(*out));out->item_page=-1;
    if(!old||old_count>MPI_MAX_PAGES||classes>MPI_MAX_CLASSES||!capacity||capacity>MPI_NATIVE_ROWS)return 0;
    unsigned pages=classes?(classes+capacity-1)/capacity:1;int replaced=0;
    for(unsigned i=0;i<old_count;i++){
        unsigned type=old[i];if(type==4)continue;
        unsigned n=type==3?pages:1;if(type==3){if(replaced)return 0;replaced=1;}
        if(out->count+n>MPI_MAX_PAGES)return 0;
        if(type==5&&out->item_page<0)out->item_page=(int)out->count;
        while(n--)out->type[out->count++]=(unsigned char)type;
    }
    if(!replaced)return 0;
    out->class_pages=pages;out->capacity=capacity;return 1;
}
static int mpi_slice(const MP_InfoPlan *plan,unsigned page,unsigned classes,unsigned *start,unsigned *count){
    if(!plan||!start||!count||page>=plan->count||plan->type[page]!=3||classes>MPI_MAX_CLASSES||!plan->capacity)return 0;
    unsigned chunk=0;for(unsigned i=0;i<page;i++)if(plan->type[i]==3)chunk++;
    *start=chunk*plan->capacity;if(*start>classes)return 0;
    *count=classes-*start;if(*count>plan->capacity)*count=plan->capacity;return 1;
}
#endif

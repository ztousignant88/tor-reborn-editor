#ifndef MENU_SPEED_RULES_H
#define MENU_SPEED_RULES_H
#include <stdint.h>
typedef struct {int64_t real_anchor,virtual_anchor;double rate;} MMClock;
typedef struct {uint32_t real_anchor;uint64_t virtual_anchor;double rate;} MMTickClock;
enum {MM_SPEED_STEPS=5};
static unsigned mm_next_step(unsigned step){return (step+1u)%MM_SPEED_STEPS;}
static int mm_native_fast(unsigned step){return step>0&&step<MM_SPEED_STEPS;}
static double mm_step_rate(unsigned step,int active){static const double rates[MM_SPEED_STEPS]={1,1,2,3,5};return active&&step<MM_SPEED_STEPS?rates[step]:1.0;}
static int64_t mm_clock_read(const MMClock *c,int64_t real){return c->virtual_anchor+(int64_t)((double)(real-c->real_anchor)*c->rate);}
static void mm_clock_change(MMClock *c,int64_t real,double rate){c->virtual_anchor=mm_clock_read(c,real);c->real_anchor=real;c->rate=rate;}
static uint64_t mm_tick_read(const MMTickClock *c,uint32_t real){return c->virtual_anchor+(uint64_t)((double)(uint32_t)(real-c->real_anchor)*c->rate);}
static void mm_tick_change(MMTickClock *c,uint32_t real,double rate){c->virtual_anchor=mm_tick_read(c,real);c->real_anchor=real;c->rate=rate;}
#endif

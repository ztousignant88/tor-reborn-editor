#ifndef STEAL_NOTIFICATION_H
#define STEAL_NOTIFICATION_H

/* Native DropItemMenu parameters, established by 0x3AA6D0 -> 0x2E9D50.
 * The menu displays this list only. The separate 0x3AA820 coordinator normally
 * awards its contents after dismissal; Steal deliberately never calls it. */
typedef struct { uint16_t item,quantity; byte special,padding; } StealPopupEntry;
typedef struct {
    uint32_t count;
    StealPopupEntry entries[512];
    uint32_t delay;
    byte flag,padding[3];
} StealPopupArgs;
_Static_assert(sizeof(StealPopupEntry)==6,"Native popup entry size");
_Static_assert(offsetof(StealPopupArgs,delay)==0xc04,"Native popup delay offset");
_Static_assert(sizeof(StealPopupArgs)==0xc0c,"Native popup argument size");

typedef void (*BuildQueueFn)(void *);
typedef void (*PopupOpenFn)(const StealPopupArgs *);
typedef int (*PopupStatusFn)(void);
typedef void (*QueueAppendFn)(void *,void *);
static BuildQueueFn original_build_queue;
static PopupOpenFn popup_open;
static PopupStatusFn popup_status;
static QueueAppendFn queue_append;
typedef struct { char *text;uint32_t duration;uint16_t style;byte zero,flag,replace; } StealToastArgs;
_Static_assert(offsetof(StealToastArgs,replace)==0x10,"Native message argument offset");
typedef void (*ToastOpenFn)(StealToastArgs *,int);
typedef int (*ToastStatusFn)(int);
static ToastOpenFn toast_open;
static ToastStatusFn toast_status;
typedef struct { void *job; unsigned pending; uint16_t item,quantity;unsigned gold;char message[80]; } StealNoticeContext;
static _Thread_local StealNoticeContext notice_context;

typedef struct {
    void **vtable;
    uint32_t state,padding;
    unsigned polls;
    byte seen_open;
    StealPopupArgs args;
    unsigned gold;
    char text[80];
    StealToastArgs toast;
} StealNoticeJob;

static void *notice_destroy(void *object,unsigned flags) {
    if(flags&1u)HeapFree(GetProcessHeap(),0,object);
    return object;
}
static byte notice_false(void *object) {(void)object;return 0;}
static void notice_noop(void *object) {(void)object;}
static void notice_begin(void *object) {
    StealNoticeJob *job=object;
    if(job->gold || job->text[0]){
        if(job->gold)snprintf(job->text,sizeof(job->text),"Stole %u Goth.",job->gold);
        job->toast=(StealToastArgs){job->text,180,0x100,0,1,0};toast_open(&job->toast,0);
        log_line("Steal notification: native message for %u Goth; display only",job->gold);
    }else{
        popup_open(&job->args);
        log_line("Steal notification: native item panel requested for item %u x%u; display only",(unsigned)job->args.entries[0].item,(unsigned)job->args.entries[0].quantity);
    }
}
static byte notice_done(void *object) {
    StealNoticeJob *job=object;
    int status=(job->gold || job->text[0])?toast_status(0):popup_status();
    ++job->polls;
    if(status!=1)job->seen_open=1;
    /* UI opening is queued. Do not finish in the same tick before it opens. */
    if(status==1 && job->polls>=3 && (job->seen_open || job->polls>=60))return 1;
    return 0;
}
static void notice_update(void *object) {
    StealNoticeJob *job=object;
    if(job->state==0){notice_begin(job);job->state=1;}
    if(job->state==1 && notice_done(job)){
        job->state=2;
        log_line("Steal notification: item panel finished; no additional inventory award");
    }
}
static void *notice_vtable[]={notice_destroy,notice_update,notice_done,notice_false,
                              notice_begin,notice_noop,notice_noop};

static int append_steal_notice(void *parent) {
    if(!parent || !popup_open || !popup_status || !queue_append)return 0;
    if((notice_context.gold || notice_context.message[0]) && (!toast_open || !toast_status))return 0;
    uint32_t head=0,tail=0;
    memcpy(&head,(byte*)parent+0x88,4);
    memcpy(&tail,(byte*)parent+0x8c,4);
    if(head>=16 || tail>=16 || ((tail+1)&15u)==head)return 0;
    StealNoticeJob *job=HeapAlloc(GetProcessHeap(),HEAP_ZERO_MEMORY,sizeof(*job));
    if(!job)return 0;
    job->vtable=notice_vtable;
    job->args.count=1;
    job->args.entries[0].item=notice_context.item?notice_context.item:1000;
    job->args.entries[0].quantity=notice_context.quantity?notice_context.quantity:1;
    job->gold=notice_context.gold;
    memcpy(job->text,notice_context.message,sizeof(job->text));
    queue_append(parent,job);
    uint32_t after=0;memcpy(&after,(byte*)parent+0x8c,4);
    if(after!=((tail+1)&15u)){
        HeapFree(GetProcessHeap(),0,job);
        return 0;
    }
    return 1;
}

static void hook_build_queue(void *job) {
    StealNoticeContext previous=notice_context;
    notice_context=(StealNoticeContext){.job=job};
    original_build_queue(job);
    unsigned pending=notice_context.pending;
    StealNoticeContext payload=notice_context;
    notice_context=previous;
    /* Append only after the native effect/animation jobs have been queued. */
    if(pending){
        StealNoticeContext previous_payload=notice_context;
        notice_context.item=payload.item;notice_context.quantity=payload.quantity;notice_context.gold=payload.gold;
        memcpy(notice_context.message,payload.message,sizeof(notice_context.message));
        if(!append_steal_notice(job))log_line("Steal notification: queue unavailable; item was still awarded once");
        else log_line("Steal notification: queued after native action effects");
        notice_context=previous_payload;
    }
}

static void request_steal_quantity_notice(uint16_t item,uint16_t quantity) {
    if(notice_context.job){notice_context.pending=1;notice_context.item=item;notice_context.quantity=quantity;notice_context.gold=0;}
    else log_line("Steal notification: no action-job context; item award preserved");
}
static void request_steal_notice_for(uint16_t item) {request_steal_quantity_notice(item,1);}
static void request_steal_gold_notice(unsigned gold) {
    if(notice_context.job){notice_context.pending=1;notice_context.gold=gold;notice_context.quantity=0;notice_context.item=0;}
    else log_line("Steal notification: no action-job context; Gold award preserved");
}
static void request_steal_notice(void) { request_steal_notice_for(1000); }
static void request_trap_notice(const char *text){
    if(!notice_context.job)return;
    notice_context.pending=1;notice_context.item=notice_context.quantity=0;notice_context.gold=0;
    snprintf(notice_context.message,sizeof(notice_context.message),"%s",text);
}

#endif

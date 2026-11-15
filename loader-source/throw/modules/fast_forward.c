static unsigned ff_step;
static void *ff_manager;
static int ff_adopted;
static int ff_reset_pending;
static int ff_global;
static int ff_battle_active;
static const wchar_t *ff_labels[]={L"Normal",L"Fast",L"Fast+ (2x timing)",L"Faster (3x timing)",L"Turbo (5x timing)"};
static const char *ff_names[]={"Normal","Fast","Fast+ (2x timing)","Faster (3x timing)","Turbo (5x timing)"};
static unsigned ff_current_step(void) { return ff_reset_pending ? 0 : ff_step; }

static void ff_refresh(void) {
    unsigned step = ff_current_step();
    mm_set_rate(ff_global ? 5.0 : mm_step_rate(step, ff_battle_active));
    mm_update_caption(ff_labels[step], mm_native_fast(step) && !ff_battle_active);
}

static LRESULT WINAPI ff_dispatch(const MSG *message) {
    // Skip auto-repeat and system keys such as Alt+F4.
    if (message->message == WM_KEYDOWN && !(message->lParam & (1L << 30)) &&
        (message->wParam == VK_F3 || message->wParam == VK_F4)) {
        HWND foreground = GetForegroundWindow();
        if (foreground && GetAncestor(message->hwnd, GA_ROOT) == foreground) {
            if (message->wParam == VK_F4) {
                ff_global = !ff_global;
                mm_log(ff_global ? "Fast Forward: F4 global mode on.\r\n"
                                 : "Fast Forward: F4 global mode off.\r\n");
            } else {
                ff_global = 0;
                ff_reset_pending = 1;
                mm_log("Fast Forward: F3 reset to Normal.\r\n");
            }
            InterlockedExchange(&mm_caption_dirty, 1);
            ff_refresh();
        }
    }
    return mm_original_dispatch(message);
}
__attribute__((used,noinline)) unsigned char mm_cycle(void *manager){
    if(!mm_readable(manager,0x32b))return 0;
    if(!ff_adopted||ff_manager!=manager){ff_step=((unsigned char*)manager)[0x329]?1:0;ff_adopted=1;ff_manager=manager;}
    ff_step=mm_next_step(ff_current_step());
    ff_reset_pending=0;
    ((unsigned char*)manager)[0x329]=(unsigned char)mm_native_fast(ff_step);
    mm_caption_dirty=1;
    char line[120];snprintf(line,sizeof(line),"Fast Forward: step %u/%u = %s\r\n",ff_step+1,MM_SPEED_STEPS,ff_names[ff_step]);mm_log(line);
    return (unsigned char)mm_native_fast(ff_step);
}
__attribute__((used,noinline)) void mm_tick(void *manager){
    if (!mm_readable(manager, 0x32b)) {
        ff_battle_active = 0;
        ff_refresh();
        return;
    }
    if(!ff_adopted||ff_manager!=manager){ff_step=((unsigned char*)manager)[0x329]?1:0;ff_adopted=1;ff_manager=manager;mm_caption_dirty=1;}
    unsigned char *battle = manager;
    int active = battle[0x328] != 0;
    if (ff_reset_pending && (ff_step != 0 || active || battle[0x329])) {
        ff_step = 0;
        battle[0x329] = 0; /* Native selected speed. */
        battle[0x328] = 0; /* Active speed for the native transition below. */
        active = 0;
        mm_caption_dirty = 1;
        mm_original_ui(0);
    }
    ff_reset_pending = 0;
    ff_battle_active = active;
    ff_refresh();
}
// Both native toggle blocks keep the battle manager in RBX. Return CL as the
// original SETE block did; the native UI setter still runs immediately after.
__attribute__((naked,used)) static void mm_cycle_bridge(void){__asm__(
    "sub $0x28,%rsp\n\t"
    "mov %rbx,%rcx\n\t"
    "call mm_cycle\n\t"
    "mov %al,%cl\n\t"
    "add $0x28,%rsp\n\tret");}
// Replace the native MOV [RBX+328],AL. Preserve flags and volatile registers
// except AL, which must report the final active flag to the native comparison.
__attribute__((naked,used)) static void mm_tick_bridge(void){__asm__(
    "mov %al,0x328(%rbx)\n\t"
    "pushfq\n\tpush %rax\n\tpush %rcx\n\tpush %rdx\n\tpush %r8\n\tpush %r9\n\tpush %r10\n\tpush %r11\n\t"
    "sub $0x88,%rsp\n\t"
    "movdqu %xmm0,0x20(%rsp)\n\tmovdqu %xmm1,0x30(%rsp)\n\tmovdqu %xmm2,0x40(%rsp)\n\t"
    "movdqu %xmm3,0x50(%rsp)\n\tmovdqu %xmm4,0x60(%rsp)\n\tmovdqu %xmm5,0x70(%rsp)\n\t"
    "mov %rbx,%rcx\n\tcall mm_tick\n\t"
    "movdqu 0x20(%rsp),%xmm0\n\tmovdqu 0x30(%rsp),%xmm1\n\tmovdqu 0x40(%rsp),%xmm2\n\t"
    "movdqu 0x50(%rsp),%xmm3\n\tmovdqu 0x60(%rsp),%xmm4\n\tmovdqu 0x70(%rsp),%xmm5\n\t"
    "add $0x88,%rsp\n\tpop %r11\n\tpop %r10\n\tpop %r9\n\tpop %r8\n\tpop %rdx\n\tpop %rcx\n\tpop %rax\n\tpopfq\n\tmov 0x328(%rbx),%al\n\tret");}

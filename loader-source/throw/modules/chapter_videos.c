typedef unsigned char (*MMMovieOpen)(unsigned,unsigned short,unsigned short);
typedef void (*MMMovieStop)(unsigned);
static MMMovieOpen mm_original_movie;
static MMMovieStop mm_stop_movie;
static unsigned char mm_movie_request(uintptr_t caller,unsigned kind,unsigned short group,unsigned short id){
    unsigned char result=mm_original_movie(kind,group,id);
    if(result&&caller==MM_STORY_MOVIE_RETURN&&group==2000&&id>=2&&id<=8){
        mm_stop_movie(0);
        mm_log("Chapter video: automatic native skip requested for story playback.\r\n");
    }
    return result;
}
__attribute__((noinline)) static unsigned char mm_movie_hook(unsigned kind,unsigned short group,unsigned short id){
    uintptr_t caller=(uintptr_t)__builtin_return_address(0)-(uintptr_t)mm_base;
    return mm_movie_request(caller,kind,group,id);
}
static int mm_install_chapter_videos(void){
    if(memcmp(mm_base+MM_MOVIE_OPEN,fp_movie_open,sizeof(fp_movie_open))||
       memcmp(mm_base+MM_STORY_MOVIE_CALL,fp_story_movie,sizeof(fp_story_movie))||
       memcmp(mm_base+MM_MOVIE_STOP,fp_movie_stop,sizeof(fp_movie_stop))){
        mm_log("Chapter videos: disabled; playback fingerprint mismatch.\r\n");return 0;
    }
    unsigned char *relay=mm_near_page();if(!relay)return 0;
    unsigned char *trampoline=relay+64;
    memcpy(trampoline,fp_movie_open,8);mm_abs_jump(trampoline+8,mm_base+MM_MOVIE_OPEN+8);
    mm_original_movie=(MMMovieOpen)trampoline;mm_stop_movie=(MMMovieStop)(mm_base+MM_MOVIE_STOP);
    mm_abs_jump(relay,(void*)mm_movie_hook);FlushInstructionCache(GetCurrentProcess(),relay,96);
    unsigned char patch[8]={0xe9,0,0,0,0,0x90,0x90,0x90};
    int32_t delta=(int32_t)(relay-(mm_base+MM_MOVIE_OPEN+5));memcpy(patch+1,&delta,4);
    if(!mm_write(mm_base+MM_MOVIE_OPEN,patch,sizeof(patch))){mm_write(mm_base+MM_MOVIE_OPEN,fp_movie_open,sizeof(patch));return 0;}
    mm_log("Chapter videos: story chapter IDs 2-8 automatically skipped through native stop; other movie requests unchanged.\r\n");return 1;
}

#ifndef TOR_VERSUS_ROUND_CARD_H
#define TOR_VERSUS_ROUND_CARD_H

enum {
    VS_ROUND_TITLE = 1,
    VS_SEMIFINAL_ONE = 2,
    VS_SEMIFINAL_TWO = 3,
    VS_FINAL_TITLE = 4,
    VS_QUARTERFINAL_ONE = 5,
    VS_QUARTERFINAL_FOUR = 8,
    VS_CHAMPIONS_TITLE = 9,
    VS_TEAM_NAME_CAPACITY = 57,
    VS_CHAMPIONS_MS = 3800,
    VS_CARD_MS = 1400,
    VS_TRANSITION_MS = 45000,
};

struct IDXGISwapChain;
void vs_set_round_card(unsigned title, unsigned duration);
void vs_set_matchup_card(unsigned title, unsigned duration,
                         const wchar_t names[2][VS_TEAM_NAME_CAPACITY]);
void vs_set_champions_card(const wchar_t *name);
unsigned vs_visible_round_card(void);
#ifdef TOR_VERSUS_PILOT_TEST
__declspec(dllexport) void vs_champions_subtitle_test(wchar_t *name);
__declspec(dllexport) void vs_matchup_names_test(wchar_t names[2][VS_TEAM_NAME_CAPACITY]);
#endif
HRESULT vs_present_round_card(struct IDXGISwapChain *swap_chain, UINT interval);

#endif

/* Draw the round title over the final frame. The game still updates its
 * scene, reward menus, and formation behind the card. */
#define COBJMACROS
#include <windows.h>
#include <d3d11.h>
#include <stdint.h>
#include <string.h>
#include <wchar.h>
#include "versus_round_card.h"

static const wchar_t *const vs_round_titles[] = {
    L"", L"Round 1", L"Semifinal 1", L"Semifinal 2", L"Final",
    L"Quarterfinal 1", L"Quarterfinal 2", L"Quarterfinal 3", L"Quarterfinal 4",
    L"Tournament Champions",
};
static const GUID vs_texture_iid = {
    0x6f15aaf2, 0xd208, 0x4e89, {0x9a, 0xb4, 0x48, 0x95, 0x35, 0xd3, 0x4f, 0x9c},
};

/* Publish the timer and both names together for the graphics thread. */
static volatile LONG64 vs_card_state;
static SRWLOCK vs_card_lock = SRWLOCK_INIT;
static wchar_t vs_caption_names[2][VS_TEAM_NAME_CAPACITY];
static ID3D11Texture2D *vs_card_texture;
static ID3D11Device *vs_card_device;
static D3D11_TEXTURE2D_DESC vs_card_desc;
static unsigned vs_card_title;
static wchar_t vs_texture_names[2][VS_TEAM_NAME_CAPACITY];

static void vs_publish_card(unsigned title, unsigned duration, const wchar_t *first, const wchar_t *second) {
    AcquireSRWLockExclusive(&vs_card_lock);
    wcsncpy(vs_caption_names[0], first, VS_TEAM_NAME_CAPACITY - 1);
    wcsncpy(vs_caption_names[1], second, VS_TEAM_NAME_CAPACITY - 1);
    const ULONGLONG until = GetTickCount64() + duration;
    InterlockedExchange64(&vs_card_state, title ? (LONG64)((until << 8) | title) : 0);
    ReleaseSRWLockExclusive(&vs_card_lock);
}

void vs_set_round_card(unsigned title, unsigned duration) {
    vs_publish_card(title, duration, L"", L"");
}

void vs_set_matchup_card(unsigned title, unsigned duration,
                         const wchar_t names[2][VS_TEAM_NAME_CAPACITY]) {
    vs_publish_card(title, duration, names[0], names[1]);
}

void vs_set_champions_card(const wchar_t *name) {
    vs_publish_card(VS_CHAMPIONS_TITLE, VS_TRANSITION_MS, name, L"");
}

static unsigned vs_read_card(wchar_t names[2][VS_TEAM_NAME_CAPACITY]) {
    AcquireSRWLockShared(&vs_card_lock);
    unsigned title = vs_visible_round_card();
    if (title) memcpy(names, vs_caption_names, sizeof vs_caption_names);
    ReleaseSRWLockShared(&vs_card_lock);
    return title;
}

#ifdef TOR_VERSUS_PILOT_TEST
void vs_champions_subtitle_test(wchar_t *name) {
    wchar_t names[2][VS_TEAM_NAME_CAPACITY] = {0};
    vs_read_card(names);
    wcscpy(name, names[0]);
}

void vs_matchup_names_test(wchar_t names[2][VS_TEAM_NAME_CAPACITY]) {
    vs_read_card(names);
}
#endif

unsigned vs_visible_round_card(void) {
    const ULONGLONG state = (ULONGLONG)InterlockedCompareExchange64(&vs_card_state, 0, 0);
    return GetTickCount64() < (state >> 8) ? (unsigned)(state & 0xff) : 0;
}

static void vs_release_round_texture(void) {
    if (vs_card_texture) ID3D11Texture2D_Release(vs_card_texture);
    vs_card_texture = NULL;
    vs_card_device = NULL;
}

static HFONT vs_card_font(int size, int weight) {
    return CreateFontW(-size, 0, 0, 0, weight, FALSE, FALSE, FALSE,
                       DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                       ANTIALIASED_QUALITY, FF_ROMAN, L"Georgia");
}

static void vs_draw_matchup_line(HDC dc, int width, int center, int size,
                                COLORREF color, const wchar_t *text) {
    HFONT font = vs_card_font(size, FW_BOLD);
    if (!font) return;
    HGDIOBJ old = SelectObject(dc, font);
    const int margin = width / 12;
    SIZE measured;
    if (GetTextExtentPoint32W(dc, text, (int)wcslen(text), &measured) &&
        measured.cx > width - 2 * margin) {
        HFONT fitted = vs_card_font(max(9, size * (width - 2 * margin) / measured.cx), FW_BOLD);
        if (fitted) {
            SelectObject(dc, fitted);
            DeleteObject(font);
            font = fitted;
        }
    }
    SetTextColor(dc, color);
    RECT box = {margin, center - size, width - margin, center + size};
    DrawTextW(dc, text, -1, &box, DT_SINGLELINE | DT_CENTER | DT_VCENTER | DT_NOPREFIX | DT_END_ELLIPSIS);
    SelectObject(dc, old);
    DeleteObject(font);
}

static void vs_draw_matchup(HDC dc, int width, int height, unsigned title,
                            const wchar_t names[2][VS_TEAM_NAME_CAPACITY]) {
    const int middle = height / 2, gap = max(12, height / 12);
    const int name_size = max(12, min(height / 15, width / 16));
    HBRUSH gold = CreateSolidBrush(RGB(162, 130, 73));
    if (gold) {
        const int y = middle + gap / 3;
        const int bottom = y + max(1, height / 540);
        RECT left = {width * 25 / 100, y, width * 43 / 100, bottom};
        RECT right = {width * 57 / 100, y, width * 75 / 100, bottom};
        FillRect(dc, &left, gold);
        FillRect(dc, &right, gold);
        DeleteObject(gold);
    }
    vs_draw_matchup_line(dc, width, middle - gap * 2, max(12, height / 23),
                         RGB(240, 223, 178), vs_round_titles[title]);
    vs_draw_matchup_line(dc, width, middle - gap * 2 / 3, name_size, RGB(172, 215, 249), names[0]);
    vs_draw_matchup_line(dc, width, middle + gap / 3, max(10, min(height / 33, width / 44)),
                         RGB(214, 175, 105), L"VERSUS");
    vs_draw_matchup_line(dc, width, middle + gap * 4 / 3, name_size, RGB(245, 172, 155), names[1]);
}

static ID3D11Texture2D *vs_build_round_texture(ID3D11Device *device,
                                             const D3D11_TEXTURE2D_DESC *backbuffer,
                                             unsigned title, const wchar_t names[2][VS_TEAM_NAME_CAPACITY]) {
    const int width = (int)backbuffer->Width, height = (int)backbuffer->Height;
    const int champions = title == VS_CHAMPIONS_TITLE;
    const int font_height = max(12, min(height / 13, width / (champions ? 19 : 12)));
    BITMAPINFO info = {0};
    info.bmiHeader.biSize = sizeof info.bmiHeader;
    info.bmiHeader.biWidth = width;
    info.bmiHeader.biHeight = -height;
    info.bmiHeader.biPlanes = 1;
    info.bmiHeader.biBitCount = 32;

    HDC dc = CreateCompatibleDC(NULL);
    if (!dc) return NULL;
    uint32_t *pixels = NULL;
    HBITMAP bitmap = CreateDIBSection(dc, &info, DIB_RGB_COLORS, (void **)&pixels, NULL, 0);
    HFONT font = vs_card_font(font_height, FW_BOLD);
    ID3D11Texture2D *texture = NULL;
    if (bitmap && pixels && font) {
        HGDIOBJ old_bitmap = SelectObject(dc, bitmap);
        HGDIOBJ old_font = SelectObject(dc, font);
        PatBlt(dc, 0, 0, width, height, BLACKNESS);
        SetBkMode(dc, TRANSPARENT);
        if (names[0][0] && names[1][0]) {
            vs_draw_matchup(dc, width, height, title, names);
        } else {
            HBRUSH line = CreateSolidBrush(RGB(162, 130, 73));
            if (line) {
                const int half = min(width / 3, font_height * 5);
                const int y = height / 2 + (champions ? 0 : font_height);
                RECT rule = {width / 2 - half, y, width / 2 + half, y + max(1, height / 540)};
                FillRect(dc, &rule, line);
                DeleteObject(line);
            }
            SetTextColor(dc, RGB(240, 223, 178));
            RECT box = {0, 0, width, height};
            if (champions) box.bottom = height - font_height * 3 / 2;
            DrawTextW(dc, vs_round_titles[title], -1, &box, DT_SINGLELINE | DT_CENTER | DT_VCENTER | DT_NOPREFIX);
            if (champions) {
                const int name_size = max(10, min(font_height * 3 / 4, width / 28));
                HFONT name_font = vs_card_font(name_size, FW_NORMAL);
                if (name_font) SelectObject(dc, name_font);
                SetTextColor(dc, RGB(250, 238, 209));
                RECT name_box = {width / 16, height / 2 + font_height / 3,
                                 width - width / 16, height / 2 + font_height * 7 / 4};
                DrawTextW(dc, names[0], -1, &name_box,
                          DT_SINGLELINE | DT_CENTER | DT_VCENTER | DT_NOPREFIX | DT_END_ELLIPSIS);
                if (name_font) {
                    SelectObject(dc, font);
                    DeleteObject(name_font);
                }
            }
        }
        GdiFlush();
        const int rgba = backbuffer->Format == DXGI_FORMAT_R8G8B8A8_UNORM ||
                         backbuffer->Format == DXGI_FORMAT_R8G8B8A8_UNORM_SRGB;
        for (size_t i = 0; i < (size_t)width * height; ++i) {
            const uint32_t rgb = pixels[i];
            pixels[i] = 0xff000000u | (rgba ? ((rgb & 0xffu) << 16) | (rgb & 0xff00u) |
                                              ((rgb >> 16) & 0xffu) : (rgb & 0xffffffu));
        }
        D3D11_TEXTURE2D_DESC desc = *backbuffer;
        desc.Usage = D3D11_USAGE_DEFAULT;
        desc.BindFlags = 0;
        desc.CPUAccessFlags = 0;
        desc.MiscFlags = 0;
        const D3D11_SUBRESOURCE_DATA initial = {pixels, (UINT)width * 4, 0};
        ID3D11Device_CreateTexture2D(device, &desc, &initial, &texture);
        SelectObject(dc, old_font);
        SelectObject(dc, old_bitmap);
    }
    if (font) DeleteObject(font);
    if (bitmap) DeleteObject(bitmap);
    DeleteDC(dc);
    return texture;
}

static void vs_draw_round_card(ID3D11Texture2D *backbuffer, unsigned title,
                               const wchar_t names[2][VS_TEAM_NAME_CAPACITY]) {
    D3D11_TEXTURE2D_DESC desc;
    ID3D11Texture2D_GetDesc(backbuffer, &desc);
    if (desc.ArraySize != 1 || desc.MipLevels != 1 || desc.SampleDesc.Count != 1 ||
        !desc.Width || !desc.Height || desc.Width > 8192 || desc.Height > 8192 ||
        (desc.Format != DXGI_FORMAT_R8G8B8A8_UNORM && desc.Format != DXGI_FORMAT_R8G8B8A8_UNORM_SRGB &&
         desc.Format != DXGI_FORMAT_B8G8R8A8_UNORM && desc.Format != DXGI_FORMAT_B8G8R8A8_UNORM_SRGB))
        return;
    ID3D11Device *device = NULL;
    ID3D11Texture2D_GetDevice(backbuffer, &device);
    if (!device) return;
    if (device != vs_card_device || title != vs_card_title ||
        desc.Width != vs_card_desc.Width || desc.Height != vs_card_desc.Height ||
        desc.Format != vs_card_desc.Format || memcmp(names, vs_texture_names, sizeof vs_texture_names)) {
        vs_release_round_texture();
        vs_card_texture = vs_build_round_texture(device, &desc, title, names);
        if (vs_card_texture) {
            vs_card_device = device;
            vs_card_desc = desc;
            vs_card_title = title;
            memcpy(vs_texture_names, names, sizeof vs_texture_names);
        }
    }
    if (vs_card_texture) {
        ID3D11DeviceContext *context = NULL;
        ID3D11Device_GetImmediateContext(device, &context);
        if (context) {
            ID3D11DeviceContext_CopyResource(context, (ID3D11Resource *)backbuffer,
                                             (ID3D11Resource *)vs_card_texture);
            ID3D11DeviceContext_Release(context);
        }
    }
    ID3D11Device_Release(device);
}

HRESULT vs_present_round_card(IDXGISwapChain *swap_chain, UINT interval) {
    wchar_t names[2][VS_TEAM_NAME_CAPACITY] = {0};
    const unsigned title = vs_read_card(names);
    ID3D11Texture2D *backbuffer = NULL;
    if (!title) {
        vs_release_round_texture();
    } else if (SUCCEEDED(IDXGISwapChain_GetBuffer(swap_chain, 0, &vs_texture_iid, (void **)&backbuffer))) {
        vs_draw_round_card(backbuffer, title, names);
        ID3D11Texture2D_Release(backbuffer);
    }
    return IDXGISwapChain_Present(swap_chain, interval, 0);
}

// FFmpegin AC-3-, E-AC-3- ja DTS-purkajat wasm-rajapinnan takana.
//
// Chrome ei pura mitään näistä kolmesta, ja mitatussa kirjastossa 53 %
// mkv-jaksojen ääniraidoista on juuri niitä. Käsin kirjoitettu AC-3-purku
// (vendor/ac3) kattaisi vain osan eikä E-AC-3 ole sama bittivirta, joten
// purku otetaan sieltä missä se on jo oikein.
//
// Ulostulo on aina lomitettu stereo pyydetyllä näytetaajuudella. Kiinteä
// muoto ei ole yksinkertaistus vaan vaatimus: purettu ääni koodataan
// selaimen AAC-koodaimella MSE:tä varten, ja se hyväksyy vain 44 100 ja
// 48 000 Hz — AC-3 sallii myös 32 000 Hz:n. Samasta syystä kanavamäärä on
// kiinteä: DTS-purkaja ei laske kaikkia virtoja stereoksi, ja mitatussa
// kirjastossa on tiedostoja joissa mono vaihtuu stereoksi kesken raidan.
// Kumpikin muutos kaataisi koodaimen kesken toiston.
//
// Alaslaskenta pyydetään ensisijaisesti purkajalta itseltään
// (`downmix`-valitsin), koska se käyttää virran omia cmixlev/surmixlev-tasoja
// — se on mitä AC-3 tarkoittaa, ja mitattuna eri tulos kuin swresamplen
// yleisellä matriisilla. Swresample hoitaa lopun: näytetaajuuden, lomituksen
// ja ne virrat joita purkaja ei suostunut laskemaan.

#include <stdlib.h>
#include <string.h>

#include <emscripten.h>
#include <libavcodec/avcodec.h>
#include <libavutil/channel_layout.h>
#include <libavutil/opt.h>
#include <libswresample/swresample.h>

// Purettavat koodekit. Numerot ovat tämän rajapinnan omat, eivät FFmpegin.
enum { FA_AC3 = 0, FA_EAC3 = 1, FA_DTS = 2 };

#define OUT_CHANNELS 2

typedef struct {
    AVCodecContext *dec;
    AVCodecParserContext *parser;
    AVPacket *pkt;
    AVFrame *frame;
    SwrContext *swr;

    int out_rate;        // pyydetty näytetaajuus
    int in_rate;         // mistä swr on rakennettu
    int in_format;
    AVChannelLayout in_layout;

    float *out;          // lomitettu stereo
    int out_cap;         // kapasiteetti näytteinä per kanava
    int out_len;         // tuotetut näytteet per kanava
} FaCtx;

static enum AVCodecID codec_id(int sel) {
    switch (sel) {
        case FA_AC3:  return AV_CODEC_ID_AC3;
        case FA_EAC3: return AV_CODEC_ID_EAC3;
        case FA_DTS:  return AV_CODEC_ID_DTS;
        default:      return AV_CODEC_ID_NONE;
    }
}

// Ulostulopuskuri kasvaa tarpeen mukaan eikä kutistu: kehyskoko on vakio,
// joten muutama ensimmäinen kasvatus riittää koko toiston ajaksi.
static int reserve(FaCtx *c, int samples) {
    int need = c->out_len + samples;
    if (need <= c->out_cap) return 1;
    int cap = c->out_cap ? c->out_cap : 8192;
    while (cap < need) cap *= 2;
    float *grown = realloc(c->out, (size_t)cap * OUT_CHANNELS * sizeof(float));
    if (!grown) return 0;
    c->out = grown;
    c->out_cap = cap;
    return 1;
}

EMSCRIPTEN_KEEPALIVE
FaCtx *fa_open(int sel, int out_rate) {
    const AVCodec *codec = avcodec_find_decoder(codec_id(sel));
    if (!codec || out_rate <= 0) return NULL;

    FaCtx *c = calloc(1, sizeof(FaCtx));
    if (!c) return NULL;
    c->out_rate = out_rate;

    c->dec = avcodec_alloc_context3(codec);
    c->pkt = av_packet_alloc();
    c->frame = av_frame_alloc();
    if (!c->dec || !c->pkt || !c->frame) goto fail;

    AVChannelLayout stereo = AV_CHANNEL_LAYOUT_STEREO;
    // Ei virhe jos ei mene läpi: DTS:ssä alaslaskentakertoimet ovat
    // valinnaisia, ja silloin purkaja antaa raidan omat kanavat.
    // Swresample laskee ne stereoksi jäljempänä.
    av_opt_set_chlayout(c->dec, "downmix", &stereo, AV_OPT_SEARCH_CHILDREN);

    // Kehysraja tulee Matroskan lohkosta useimmiten valmiina, mutta lohko saa
    // sisältää useamman kehyksen eikä katkennut lataus osu kehysrajalle.
    // Jäsennin hoitaa molemmat.
    c->parser = av_parser_init(codec->id);
    if (!c->parser) goto fail;

    if (avcodec_open2(c->dec, codec, NULL) < 0) goto fail;
    return c;

fail:
    if (c->parser) av_parser_close(c->parser);
    av_frame_free(&c->frame);
    av_packet_free(&c->pkt);
    avcodec_free_context(&c->dec);
    free(c);
    return NULL;
}

EMSCRIPTEN_KEEPALIVE
void fa_close(FaCtx *c) {
    if (!c) return;
    swr_free(&c->swr);
    av_channel_layout_uninit(&c->in_layout);
    if (c->parser) av_parser_close(c->parser);
    av_frame_free(&c->frame);
    av_packet_free(&c->pkt);
    avcodec_free_context(&c->dec);
    free(c->out);
    free(c);
}

/**
 * Muunnin puretusta muodosta ulostulomuotoon. Rakennetaan uudelleen jos
 * lähde vaihtuu kesken raidan; ulostulo ei silloinkaan muutu, joten
 * puskurissa jo olevat näytteet kelpaavat edelleen.
 */
static int ensure_swr(FaCtx *c) {
    const AVFrame *f = c->frame;
    if (c->swr && f->sample_rate == c->in_rate && f->format == c->in_format
        && av_channel_layout_compare(&f->ch_layout, &c->in_layout) == 0) return 1;

    swr_free(&c->swr);
    AVChannelLayout stereo = AV_CHANNEL_LAYOUT_STEREO;
    int err = swr_alloc_set_opts2(&c->swr,
        &stereo, AV_SAMPLE_FMT_FLT, c->out_rate,
        &f->ch_layout, (enum AVSampleFormat)f->format, f->sample_rate,
        0, NULL);
    if (err < 0 || swr_init(c->swr) < 0) { swr_free(&c->swr); return 0; }

    av_channel_layout_uninit(&c->in_layout);
    if (av_channel_layout_copy(&c->in_layout, &f->ch_layout) < 0) return 0;
    c->in_rate = f->sample_rate;
    c->in_format = f->format;
    return 1;
}

static int drain(FaCtx *c) {
    for (;;) {
        int err = avcodec_receive_frame(c->dec, c->frame);
        if (err == AVERROR(EAGAIN) || err == AVERROR_EOF) return 1;
        if (err < 0) return 0;

        if (!ensure_swr(c)) { av_frame_unref(c->frame); return 0; }
        // Näytetaajuutta nostettaessa ulos tulee enemmän kuin sisään meni, ja
        // muuntimeen jää edellisen kutsun häntä — molemmat mukaan varaukseen.
        int room = swr_get_out_samples(c->swr, c->frame->nb_samples);
        if (room < 0 || !reserve(c, room)) { av_frame_unref(c->frame); return 0; }

        uint8_t *dst = (uint8_t *)(c->out + (size_t)c->out_len * OUT_CHANNELS);
        int got = swr_convert(c->swr, &dst, room,
                              (const uint8_t **)c->frame->extended_data, c->frame->nb_samples);
        av_frame_unref(c->frame);
        if (got < 0) return 0;
        c->out_len += got;
    }
}

// Yksi jäsennetty kehys purkajalle. Rikkoutunut kehys ei ole syy lopettaa:
// seuraava synkkasana löytyy ja ääni jatkuu. Vain purkajan tilavirhe
// keskeyttää.
static int feed(FaCtx *c, uint8_t *frame, int len) {
    c->pkt->data = frame;
    c->pkt->size = len;
    if (avcodec_send_packet(c->dec, c->pkt) < 0) return 1;
    return drain(c);
}

/**
 * Syöttää puskurin purkajalle. Ulostulo kertyy fa_output()-puskuriin;
 * fa_take() nollaa laskurin seuraavaa erää varten.
 *
 * @return puskurissa olevat näytteet per kanava, tai -1 virheestä
 */
EMSCRIPTEN_KEEPALIVE
int fa_decode(FaCtx *c, const uint8_t *data, int len) {
    if (!c) return -1;
    while (len > 0) {
        uint8_t *frame = NULL;
        int frame_len = 0;
        int used = av_parser_parse2(c->parser, c->dec, &frame, &frame_len,
                                    data, len, AV_NOPTS_VALUE, AV_NOPTS_VALUE, 0);
        if (used < 0) return -1;
        data += used;
        len -= used;
        if (frame_len > 0 && !feed(c, frame, frame_len)) return -1;
    }
    return c->out_len;
}

/**
 * Loppuhuuhtelu. Jäsentimeen jää aina viimeinen kehys odottamaan seuraavaa
 * synkkasanaa, joka ei koskaan tule — ilman tätä raidan viimeinen 32 ms jäisi
 * pois. Vasta sen jälkeen huuhdellaan purkaja ja muunnin.
 */
EMSCRIPTEN_KEEPALIVE
int fa_flush(FaCtx *c) {
    if (!c) return -1;
    uint8_t *frame = NULL;
    int frame_len = 0;
    av_parser_parse2(c->parser, c->dec, &frame, &frame_len,
                     NULL, 0, AV_NOPTS_VALUE, AV_NOPTS_VALUE, 0);
    if (frame_len > 0 && !feed(c, frame, frame_len)) return -1;

    avcodec_send_packet(c->dec, NULL);
    if (!drain(c)) return -1;

    if (c->swr) {
        int tail = swr_get_out_samples(c->swr, 0);
        if (tail > 0 && reserve(c, tail)) {
            uint8_t *dst = (uint8_t *)(c->out + (size_t)c->out_len * OUT_CHANNELS);
            int got = swr_convert(c->swr, &dst, tail, NULL, 0);
            if (got > 0) c->out_len += got;
        }
    }
    return c->out_len;
}

EMSCRIPTEN_KEEPALIVE float *fa_output(FaCtx *c) { return c ? c->out : NULL; }
EMSCRIPTEN_KEEPALIVE int fa_channels(FaCtx *c) { return c ? OUT_CHANNELS : 0; }
EMSCRIPTEN_KEEPALIVE int fa_sample_rate(FaCtx *c) { return c ? c->out_rate : 0; }
EMSCRIPTEN_KEEPALIVE void fa_take(FaCtx *c) { if (c) c->out_len = 0; }

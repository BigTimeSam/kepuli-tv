// FFmpeg's AC-3, E-AC-3 and DTS decoders behind a wasm interface.
//
// Chrome decodes none of the three, and in the measured library 53% of the
// audio tracks in mkv episodes are exactly those. A hand-written AC-3
// decoder (vendor/ac3) would cover only part of it, and E-AC-3 is not the
// same bitstream, so the decoding is taken from where it is already right.
//
// The output is always interleaved stereo at the requested sample rate. The
// fixed format is not a simplification but a requirement: the decoded audio
// is encoded with the browser's own encoder for MSE — AAC, or Opus where
// there is no AAC — and AAC accepts only 44,100 and 48,000 Hz, Opus 48,000;
// AC-3 also allows 32,000 Hz. The channel count is
// fixed for the same reason: the DTS decoder does not downmix every stream
// to stereo, and the measured library holds files where mono turns into
// stereo mid-track. Either change would crash the encoder mid-playback.
//
// The downmix is asked of the decoder itself where possible (the `downmix`
// option), because it uses the stream's own cmixlev/surmixlev levels — that
// is what AC-3 means, and measured, a different result from swresample's
// generic matrix. Swresample handles the rest: the sample rate, the
// interleaving, and the streams the decoder declined to downmix.

#include <stdlib.h>
#include <string.h>

#include <emscripten.h>
#include <libavcodec/avcodec.h>
#include <libavutil/channel_layout.h>
#include <libavutil/opt.h>
#include <libswresample/swresample.h>

// The codecs that can be decoded. The numbers belong to this interface, not
// to FFmpeg.
enum { FA_AC3 = 0, FA_EAC3 = 1, FA_DTS = 2 };

#define OUT_CHANNELS 2

typedef struct {
    AVCodecContext *dec;
    AVCodecParserContext *parser;
    AVPacket *pkt;
    AVFrame *frame;
    SwrContext *swr;

    int out_rate;        // the requested sample rate
    int in_rate;         // what swr was built from
    int in_format;
    AVChannelLayout in_layout;

    float *out;          // lomitettu stereo
    int out_cap;         // capacity in samples per channel
    int out_len;         // samples produced per channel
} FaCtx;

static enum AVCodecID codec_id(int sel) {
    switch (sel) {
        case FA_AC3:  return AV_CODEC_ID_AC3;
        case FA_EAC3: return AV_CODEC_ID_EAC3;
        case FA_DTS:  return AV_CODEC_ID_DTS;
        default:      return AV_CODEC_ID_NONE;
    }
}

// The output buffer grows as needed and never shrinks: the frame size is
// fixed, so the first few growths suffice for the whole playback.
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
    // Not an error if it does not take: in DTS the downmix coefficients are
    // optional, and the decoder then hands back the track's own channels.
    // Swresample mixes them to stereo further down.
    av_opt_set_chlayout(c->dec, "downmix", &stereo, AV_OPT_SEARCH_CHILDREN);

    // A frame boundary usually comes ready from the Matroska block, but a
    // block may hold several frames and an interrupted download does not
    // land on a frame boundary. The parser handles both.
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
 * The resampler from the decoded format to the output format. Rebuilt if the
 * source changes mid-track; even then the output does not change, so the
 * samples already in the buffer remain valid.
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
        // When the sample rate goes up, more comes out than went in, and
        // the tail of the previous call stays in the resampler — both are
        // accounted for in the allocation.
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

// One parsed frame to the decoder. A corrupt frame is no reason to stop:
// the next sync word will be found and the audio goes on. Only a decoder
// state error aborts.
static int feed(FaCtx *c, uint8_t *frame, int len) {
    c->pkt->data = frame;
    c->pkt->size = len;
    if (avcodec_send_packet(c->dec, c->pkt) < 0) return 1;
    return drain(c);
}

/**
 * Feeds a buffer to the decoder. The output accumulates in the fa_output()
 * buffer; fa_take() clears the counter for the next batch.
 *
 * @return the samples in the buffer per channel, or -1 on error
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
 * The final flush. The parser always keeps the last frame waiting for the
 * next sync word, which never comes — without this the track's final 32 ms
 * would be lost. Only after that are the decoder and the resampler flushed.
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

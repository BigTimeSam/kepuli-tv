// MKV:n toisto MediaSourcen kautta.
//
// Chrome ei ota Matroskaa vastaan, mutta sen sisällä oleva H.264 tai HEVC
// kelpaa sellaisenaan. Tiedosto luetaan verkosta virtana, klusterit puretaan
// (mkv.js) ja kehykset pakataan uudelleen fMP4-paloiksi (mp4.js). Kuvaa ei
// pureta eikä koodata — vain kontti vaihtuu, joten työ on kevyttä.
//
// Reunaehdot jotka määräävät rakenteen:
//
// - Tili sallii yhden yhtäaikaisen yhteyden, joten avoinna on aina täsmälleen
//   yksi lataus. Kelaus katkaisee sen ja avaa uuden.
// - Palvelin ei paljasta content-rangea JS:lle, joten tiedoston koko haetaan
//   erikseen Range-vapaalla pyynnöllä, joka katkaistaan heti otsakkeiden
//   jälkeen.
// - Cues on mitatuissa tiedostoissa tiedoston lopussa (esim. 366 Mt:n
//   kohdalla), joten kelaustaulu haetaan omalla pyynnöllään ja vasta
//   tarvittaessa.

import { parseHeader, ID, Reader } from './ebml.js';
import { t } from './i18n.js';
import { BufferedBytes, frames } from './mkv.js';
import { initSegment, mediaSegment, decodeTimes, durations, VIDEO_TIMESCALE } from './mp4.js';
import { videoMime, AUDIO_MIME } from './probe.js';
import { decodable } from './ffaudio.js';
import { AudioTranscoder, encoderSetup, RATE as DECODED_RATE, CHANNELS as DECODED_CHANNELS } from './transcode.js';
import { SubtitleTracks, isTextSubtitle, preferred } from './subs.js';

const HEADER_BYTES = 256 * 1024;
const CUES_BYTES = 4 * 1024 * 1024;

// Kuinka pitkälle eteenpäin puskuroidaan ennen kuin lataus odottaa.
const BUFFER_AHEAD = 60;
// Kuinka paljon jo katsottua jätetään taakse ennen siivousta.
const BUFFER_BEHIND = 30;
const MAX_PENDING_BYTES = 8 * 1024 * 1024;

// Videopala katkaistaan avainkuvaan, mutta vasta kun palassa on tarpeeksi
// kehyksiä: liian lyhyt pala tekisi moof-otsikoista suhteettoman kalliita.
const MIN_SEGMENT_FRAMES = 48;
const AUDIO_SEGMENT_FRAMES = 100;

// Lataus voi katketa kesken tiedoston: palvelin sulkee yhteyden, verkko
// pätkii. Toisto jatkuu viimeisen kokonaisen klusterin alusta, koska
// puolikas klusteri jättäisi purkajalle vajaan kuvaryhmän — VideoToolbox
// vastaa siihen virheellä -12909 eikä toisto enää palaudu.
const MAX_RESUMES = 6;
const RESUME_DELAY_MS = 700;

const AAC_FRAME_LENGTHS = [960, 1024, 1920, 2048];

// Mykkä toisto pysähtyy itsestään: Chrome kohtelee ääniraidatonta elementtiä
// autoplay-sääntöjen mukaan ja pysäyttää sen aika ajoin. Mitatussa ajossa
// tauko tuli 17,8 sekunnin kohdalla readyState 4:llä ja 62 sekunnin puskurilla,
// eikä sitä edeltänyt mikään tapahtuma. Ääniraidan kanssa toistavat jaksot
// eivät pysähdy kertaakaan, joten jatkaminen rajataan tähän tapaukseen.
const MAX_SILENT_RESUMES = 20;


export class Remuxer {
  /**
   * @param {HTMLVideoElement} video
   * @param {string} url
   * @param {{onError:Function, onFirstAppend:Function, onNotice:Function,
   *          onSubtitles:Function, startAt:number, subtitleLang:string|null}} opts
   */
  constructor(video, url, {
    onError, onFirstAppend, onNotice, onSubtitles, startAt = 0, subtitleLang = null,
  } = {}) {
    this.video = video;
    this.url = url;
    this.onError = onError || (() => {});
    this.onFirstAppend = onFirstAppend || (() => {});
    this.onNotice = onNotice || (() => {});
    this.onSubtitles = onSubtitles || (() => {});
    this.startAt = startAt;
    this.subtitleLang = subtitleLang;

    this.ms = null;
    this.objectUrl = null;
    this.connection = null;
    this.generation = 0;          // kasvaa kelatessa, mitätöi vanhan pumpun
    this.destroyed = false;

    this.header = null;
    this.videoTrack = null;
    this.audioTrack = null;
    this.decodeTrack = null;      // raita joka puretaan itse, jos sellaista tarvitaan
    this.transcoder = null;
    this.subs = null;             // SubtitleTracks, jos tekstiraitoja on
    this.subtitleList = [];
    this.buffers = { video: null, audio: null };
    this.queues = { video: Promise.resolve(), audio: Promise.resolve() };
    this.sequence = 1;
    this.audioNominal = 1024;
    this.audioDts = null;
    this.cues = null;
    this.cuesTried = false;
    this.stream = null;
    this.started = false;
    this.onSeeking = () => this.handleSeek();
    this.onPause = () => this.resumeSilent();
    this.silentResumes = 0;
    this.state = { phase: 'alku', pending: 0, lastPts: 0, segments: 0, reading: false, resumes: 0 };
    this.clusterAt = null;        // viimeisimmän klusterin sijainti tiedostossa
    this.resumes = 0;
  }

  /* ------------------------------------------------------------ elinkaari */

  async start() {
    this.ms = new MediaSource();
    this.objectUrl = URL.createObjectURL(this.ms);
    const open = new Promise((resolve) => this.ms.addEventListener('sourceopen', resolve, { once: true }));
    this.video.src = this.objectUrl;
    await open;
    if (this.destroyed) return;

    // Koodaimen mittaus ei riipu tiedostosta ja tulos on sivukohtainen, joten
    // se käynnistetään rinnan otsikon luvun kanssa. Otsikon luku jättää
    // yhteyden auki lukija odottamaan, eikä sitä kannata pysäyttää mittauksen
    // ajaksi — tili sallii yhden yhteyden, joten sitä ei voi vain avata
    // uudelleen.
    encoderSetup().catch(() => { /* openTranscoder kertoo syyn */ });

    await this.readHeader();
    if (this.destroyed) return;

    // Ennen lähdepuskureita: purkaja kertoo ääniraidan lopullisen muodon,
    // jota init-pala tarvitsee.
    await this.openTranscoder();
    if (this.destroyed) return;

    // Sukupolvi kiinnitetään ennen alkupaloja: append() merkitsee jokaisen
    // lisäyksen sen hetkiseen sukupolveen, ja myöhempi kasvatus hylkäisi
    // juuri jonotetut alkupalat vanhentuneina. Ilman niitä SourceBuffer
    // torjuu ensimmäisen mediapalan.
    const generation = ++this.generation;

    // Kesto ennen lähdepuskureita: MediaSource kieltäytyy kestosta jos jokin
    // puskuri on kesken lisäystä. Ilman kestoa seekable rajautuu puskuroituun
    // osaan ja selain typistää kelauksen sen loppuun.
    if (this.header.duration) {
      try {
        this.ms.duration = this.header.duration;
      } catch (err) {
        console.warn('[iptv] keston asetus epäonnistui', err);
      }
    }
    this.setupTracks();
    this.setupSubtitles();
    this.video.addEventListener('seeking', this.onSeeking);
    if (!this.audioTrack) this.video.addEventListener('pause', this.onPause);

    // Alusta toistettaessa jatketaan otsikon lukeneesta virrasta. Jatkokohta
    // vaatii kelaustaulun, jonka haku vie yhteyden — silloin virta suljetaan.
    let offset = 0;
    if (this.startAt > 1) {
      const target = await this.clusterFor(this.startAt);
      if (this.destroyed || generation !== this.generation) return;
      if (target != null) offset = target;
      else this.startAt = 0;
    }
    this.pump(offset, generation).catch((err) => this.fail(err));
  }

  destroy() {
    this.destroyed = true;
    this.generation++;
    this.video.removeEventListener('seeking', this.onSeeking);
    this.video.removeEventListener('pause', this.onPause);
    if (this.subs) { this.subs.destroy(); this.subs = null; }
    if (this.transcoder) { this.transcoder.close(); this.transcoder = null; }
    this.subtitleList = [];
    if (this.stream) {
      try { this.stream.ctrl.abort(); } catch { /* jo suljettu */ }
      this.stream = null;
    }
    this.closeConnection();
    try {
      if (this.ms && this.ms.readyState === 'open') this.ms.endOfStream();
    } catch { /* jo suljettu */ }
    if (this.objectUrl) { URL.revokeObjectURL(this.objectUrl); this.objectUrl = null; }
    this.ms = null;
  }

  fail(err) {
    if (this.destroyed) return;
    if (err && err.name === 'AbortError') return;
    console.warn('[iptv] remux epäonnistui', err);
    this.onError(err);
  }

  /* -------------------------------------------------------------- verkko */

  closeConnection() {
    const open = this.connection;
    this.connection = null;
    if (open) { try { open.abort(); } catch { /* jo suljettu */ } }
  }

  /** Yksi lataus kerrallaan: edellinen katkaistaan aina ensin. */
  async openRange(from, to) {
    this.closeConnection();
    if (this.stream) {
      try { this.stream.ctrl.abort(); } catch { /* jo suljettu */ }
      this.stream = null;
    }
    const ctrl = new AbortController();
    this.connection = ctrl;
    const range = to != null ? `bytes=${from}-${to}` : `bytes=${from}-`;
    const res = await fetch(this.url, {
      signal: ctrl.signal, cache: 'no-store', credentials: 'omit', headers: { Range: range },
    });
    if (!res.ok) throw new Error(`palvelin vastasi ${res.status}`);
    return { res, ctrl };
  }

  async readRange(from, to) {
    const { res, ctrl } = await this.openRange(from, to);
    const reader = res.body.getReader();
    const parts = [];
    let total = 0;
    const cap = to != null ? to - from + 1 : Infinity;
    while (total < cap) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      total += value.byteLength;
    }
    try { ctrl.abort(); } catch { /* runko oli jo loppu */ }
    if (this.connection === ctrl) this.connection = null;
    const out = new Uint8Array(total);
    let at = 0;
    for (const part of parts) { out.set(part, at); at += part.byteLength; }
    return out;
  }

  /**
   * Lukee otsikon tiedoston alusta ja jättää yhteyden auki: sama virta
   * jatkuu klustereihin. Erillinen otsikkopyyntö tarkoittaisi kahta
   * yhteyttä peräkkäin, ja tili sallii yhden — palvelin katkaisi
   * jälkimmäisen muutaman sekunnin jälkeen.
   */
  async readHeader() {
    const { res, ctrl } = await this.openRange(0, null);
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    while (total < HEADER_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
    }
    const bytes = new Uint8Array(total);
    let at = 0;
    for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }

    const header = parseHeader(bytes);
    if (!header.ok) {
      try { ctrl.abort(); } catch { /* jo suljettu */ }
      throw new Error('raitatietoja ei löytynyt');
    }
    this.stream = { reader, ctrl, chunks, offset: 0 };
    this.header = header;

    const tracks = header.tracks;
    this.videoTrack = tracks.find((t) => t.type === 1 && videoMime(t)) || null;
    // Tiedostossa voi olla useampi ääniraita — otetaan ensimmäinen jonka
    // Chrome osaa purkaa. Juuri tämä pelastaa levyt joissa on sekä AC3 että
    // AAC: pelkkä oletusraita olisi usein se väärä, ja koskematon raita on
    // aina parempi kuin uudelleen koodattu.
    this.audioTrack = tracks.find((t) => t.type === 2 && supportedAudio(t)) || null;
    // Muuten raita joka puretaan itse. Mitatuista 45:stä ac3/eac3-jaksosta
    // yhdessäkään ei ollut vaihtoehtoista raitaa, joten ilman tätä ne
    // jäisivät mykiksi.
    this.decodeTrack = this.audioTrack ? null
      : tracks.find((t) => t.type === 2 && decodable(t.codecId)) || null;
    if (!this.videoTrack) throw new Error('toistettavaa videoraitaa ei löytynyt');
  }

  /* --------------------------------------------------------- lähdepuskurit */

  setupTracks() {
    const videoType = `video/mp4; codecs="${videoMime(this.videoTrack)}"`;
    this.buffers.video = this.ms.addSourceBuffer(videoType);
    this.buffers.video.mode = 'segments';
    this.append('video', initSegment([{
      id: 1, kind: 'video', timescale: VIDEO_TIMESCALE,
      codec: this.videoTrack.codecId === 'V_MPEGH/ISO/HEVC' ? 'hevc' : 'h264',
      priv: this.videoTrack.priv, width: this.videoTrack.width, height: this.videoTrack.height,
    }]));

    if (this.audioTrack) {
      // Puretulla raidalla muoto on transcode.js:n kiinteä stereo 48 kHz, ei
      // alkuperäisen raidan — ja AudioSpecificConfig tulee koodaimelta, koska
      // Matroskan CodecPrivate kuvaa purettua muotoa eikä koodattua.
      const decoded = Boolean(this.transcoder);
      const rate = decoded ? DECODED_RATE : (this.audioTrack.outputRate || this.audioTrack.rate || 48000);
      const mime = decoded ? 'mp4a.40.2' : AUDIO_MIME[this.audioTrack.codecId];
      this.buffers.audio = this.ms.addSourceBuffer(`audio/mp4; codecs="${mime}"`);
      this.buffers.audio.mode = 'segments';
      this.append('audio', initSegment([{
        id: 2, kind: 'audio', timescale: rate, codec: 'aac',
        priv: decoded ? this.transcoder.description : this.audioTrack.priv,
        channels: decoded ? DECODED_CHANNELS : this.audioTrack.channels,
        rate,
      }]));
    }
  }

  /**
   * Avaa purkajan raidalle jota Chrome ei pura. Epäonnistuminen ei estä
   * toistoa: kuva menee läpi ilman ääntä, ja katsojalle kerrotaan miksi.
   */
  async openTranscoder() {
    if (!this.decodeTrack) return;
    try {
      if (!(await AudioTranscoder.available(this.decodeTrack.codecId))) {
        throw new Error('selaimessa ei ole AAC-koodainta');
      }
      const transcoder = await AudioTranscoder.open(this.decodeTrack.codecId, (err) => this.audioFailed(err));
      if (this.destroyed) { transcoder.close(); return; }
      this.transcoder = transcoder;
      this.audioTrack = this.decodeTrack;
    } catch (err) {
      console.warn('[iptv] ääniraidan purku ei onnistu', err);
      this.onNotice(t('remux.noaudio'));
    }
  }

  /**
   * Koodain kaatui kesken toiston. Ääniraita on jätettävä pois kokonaan:
   * kuivunut lähdepuskuri jättäisi kuvankin odottamaan ääntä jota ei enää
   * tule.
   */
  audioFailed(err) {
    if (this.destroyed || !this.transcoder) return;
    console.warn('[iptv] äänen koodaus keskeytyi', err);
    this.transcoder.close();
    this.transcoder = null;
    const sb = this.buffers.audio;
    this.buffers.audio = null;
    try { if (sb && this.ms && this.ms.readyState === 'open') this.ms.removeSourceBuffer(sb); } catch { /* toisto jatkuu silti */ }
    this.onNotice(t('remux.audiostopped'));
  }

  /**
   * Tekstitysraidat elementille ja kielivalinnan mukainen raita näkyviin.
   * Raidat luodaan ennen ensimmäistä klusteria, jotta valitsin on paikallaan
   * heti kun kuva lähtee — cuet valuvat sisään sitä mukaa kuin puretaan.
   */
  setupSubtitles() {
    const tracks = this.header.tracks.filter(isTextSubtitle);
    if (!tracks.length) { this.report([], null); return; }
    // Takaisinkutsu laukeaa vain sovelluksen ulkopuolelta tulleesta
    // vaihdosta — selaimen omasta tekstitysvalikosta — koska select() on jo
    // kirjannut oman valintansa.
    this.subs = new SubtitleTracks(this.video, (active) => this.report(this.subtitleList, active, true));
    this.subtitleList = this.subs.setup(tracks);
    this.report(this.subtitleList, this.subs.select(preferred(this.subtitleList, this.subtitleLang)));
  }

  report(tracks, active, external = false) {
    if (this.destroyed) return;
    this.onSubtitles({ tracks, active, external });
  }

  /** Raidan vaihto katsojan valinnasta. null piilottaa tekstityksen. */
  selectSubtitle(number) {
    if (!this.subs) return null;
    const active = this.subs.select(number);
    this.report(this.subtitleList, active);
    return active;
  }

  /** Lisäykset jonossa raidoittain: SourceBuffer ottaa vastaan yhden kerrallaan. */
  append(kind, data) {
    const sb = this.buffers[kind];
    if (!sb) return Promise.resolve();
    const generation = this.generation;
    this.queues[kind] = this.queues[kind].then(async () => {
      if (this.destroyed || generation !== this.generation || !this.ms || this.ms.readyState !== 'open') return;
      try {
        await this.appendOnce(sb, data);
      } catch (err) {
        if (err && err.name === 'QuotaExceededError') {
          await this.evict(kind, true);
          try { await this.appendOnce(sb, data); } catch (retry) { this.fail(retry); }
        } else this.fail(err);
      }
    });
    return this.queues[kind];
  }

  appendOnce(sb, data) {
    return new Promise((resolve, reject) => {
      const done = () => { sb.removeEventListener('updateend', done); sb.removeEventListener('error', bad); resolve(); };
      const bad = () => { sb.removeEventListener('updateend', done); sb.removeEventListener('error', bad); reject(new Error('SourceBuffer hylkäsi palan')); };
      sb.addEventListener('updateend', done);
      sb.addEventListener('error', bad);
      try { sb.appendBuffer(data); } catch (err) { bad(); reject(err); }
    });
  }

  /** Poistaa katsotun osan puskurista, jottei muisti kasva rajatta. */
  async evict(kind, aggressive = false) {
    const sb = this.buffers[kind];
    const ranges = timeRanges(sb);
    if (!ranges) return;
    const now = this.video.currentTime;
    const keepFrom = Math.max(0, now - (aggressive ? 5 : BUFFER_BEHIND));
    const start = ranges.start(0);
    if (keepFrom - start < 5) return;
    await new Promise((resolve) => {
      const done = () => { sb.removeEventListener('updateend', done); resolve(); };
      sb.addEventListener('updateend', done);
      try { sb.remove(start, keepFrom); } catch { done(); }
    });
  }

  /* ---------------------------------------------------------------- pumppu */

  /**
   * Lukee tiedostoa annetusta kohdasta, purkaa klusterit ja syöttää palat
   * eteenpäin. Sukupolvi mitätöi ajon, jos kelaus ehtii väliin.
   */
  async pump(offset, generation) {
    let reader;
    let ctrl;
    const bytes = new BufferedBytes();
    if (this.stream && this.stream.offset === offset) {
      // Otsikon lukenut virta jatkuu tästä; jo luetut tavut annetaan
      // purkajalle uudelleen, koska se aloittaa tiedoston alusta.
      ({ reader, ctrl } = this.stream);
      for (const chunk of this.stream.chunks) bytes.push(chunk);
      this.stream = null;
      this.connection = ctrl;
    } else {
      const opened = await this.openRange(offset, null);
      reader = opened.res.body.getReader();
      ctrl = opened.ctrl;
    }

    let complete = false;
    const network = (async () => {
      try {
        for (;;) {
          if (this.destroyed || generation !== this.generation) break;
          await this.waitForRoom(bytes, generation);
          const { done, value } = await reader.read();
          if (done) { complete = true; break; }
          bytes.push(value);
        }
      } catch (err) {
        this.state.netError = err && err.name ? `${err.name}: ${err.message}` : String(err);
        if (!(err && err.name === 'AbortError')) bytes.fail(err);
      } finally {
        bytes.end();
      }
    })();

    this.clusterAt = offset;
    const onCluster = (at) => { this.clusterAt = offset + at; };
    // Virran loppuminen on ohimenevää ja jatkettavissa; kelvoton tunnus taas
    // tarkoittaa että tiedosto itse on rikki. Mitatussa tapauksessa jaksoa
    // seurasi kolme megatavua nollia eikä yhtään klusteria — sellaisesta ei
    // uudelleenyrittämällä pääse eteenpäin.
    let damaged = null;
    const onStop = (reason, at) => {
      this.state.stop = `${reason} @ ${offset + at}`;
      if (!reason.startsWith('virta loppui')) damaged = offset + at;
    };
    const tracks = new Map(this.header.tracks.map((t) => [t.number, t]));
    const videoNumber = this.videoTrack.number;
    const audioNumber = this.audioTrack ? this.audioTrack.number : -1;
    const rate = this.audioTrack ? (this.audioTrack.outputRate || this.audioTrack.rate || 48000) : 48000;

    let pendingVideo = [];
    let pendingAudio = [];
    let decodedFrames = 0;
    let broke = false;
    this.audioDts = null;
    // Jatkokohta ei osu kehyksen rajalle eikä koodaimen jonossa oleva ääni
    // kuulu enää tähän kohtaan tiedostoa.
    if (this.transcoder) await this.transcoder.restart();
    this.state.phase = 'purkaa';
    this.state.reading = true;

    try {
      for await (const frame of frames(bytes, { timestampScale: this.header.timestampScale, tracks, onCluster, onStop })) {
        if (this.destroyed || generation !== this.generation) break;
        this.state.pending = bytes.available;
        this.state.lastPts = frame.pts / 1e9;

        if (frame.track === videoNumber) {
          if (frame.keyframe && pendingVideo.length >= MIN_SEGMENT_FRAMES) {
            this.flushVideo(pendingVideo, generation);
            pendingVideo = [];
          }
          pendingVideo.push(frame);
        } else if (frame.track === audioNumber) {
          if (this.transcoder) {
            await this.transcoder.push(frame);
            if (++decodedFrames >= AUDIO_SEGMENT_FRAMES) {
              this.flushDecoded(generation);
              decodedFrames = 0;
            }
          } else {
            pendingAudio.push(frame);
            if (pendingAudio.length >= AUDIO_SEGMENT_FRAMES) {
              this.flushAudio(pendingAudio, rate, generation);
              pendingAudio = [];
            }
          }
        } else if (this.subs && this.subs.has(frame.track)) {
          // Tekstitys ei kulje MediaSourcen läpi vaan suoraan elementin
          // omalle raidalle, joten sitä ei tarvitse paloitella eikä jonottaa.
          this.subs.push(frame.track, frame.pts, frame.duration, frame.data);
        }
      }
      if (generation === this.generation && !this.destroyed) {
        // Kesken katkennutta kuvaryhmää ei syötetä eteenpäin: purkaja saisi
        // vajaan ryhmän ja kaatuisi. Se luetaan uudelleen jatkettaessa.
        if (complete && pendingVideo.length) this.flushVideo(pendingVideo, generation);
        if (complete && pendingAudio.length) this.flushAudio(pendingAudio, rate, generation);
        if (this.transcoder) {
          // Koodaimeen jää aina viimeiset kehykset, ja ne on annettava ulos
          // myös katkenneessa ajossa: jatko alkaa klusterin alusta, eikä
          // väliin jäänyttä ääntä lueta uudelleen. Huuhtelu lisää ketjun
          // loppuun vajaan kehyksen verran hiljaisuutta, mutta seuraava ketju
          // ankkuroidaan taas omaan PTS:äänsä — venymistä ei siis kerry,
          // toisin kuin jos huuhtelua käytettäisiin vastapaineeseen.
          // Purkajan häntä kuuluu vain oikeaan loppuun.
          if (complete) await this.transcoder.finish();
          else await this.transcoder.drain();
          this.flushDecoded(generation);
        }
        await this.queues.video;
        await this.queues.audio;
        if (complete) this.finish(generation);
      }
      this.state.phase = complete ? 'valmis' : damaged !== null ? 'tiedosto rikki' : 'katkesi';
      if (damaged !== null && generation === this.generation && !this.destroyed) {
        // Viimeistä kuvaryhmää ei syötetä: se jäi kesken, ja purkaja vastaa
        // vajaaseen ryhmään virheellä -12909 eikä toisto palaudu siitä.
        // Toisto päättyy siis siististi viimeiseen ehjään ryhmään.
        await this.queues.video;
        await this.queues.audio;
        this.finish(generation);
        console.warn('[iptv] tiedosto katkeaa tavussa %d (%s)', damaged, this.state.stop);
        this.onNotice(t('remux.truncated', { time: formatClock(this.bufferedEnd()) }));
      }
      broke = !complete && damaged === null && generation === this.generation && !this.destroyed;
    } finally {
      this.state.reading = false;
      try { ctrl.abort(); } catch { /* jo suljettu */ }
      if (this.connection === ctrl) this.connection = null;
      await network.catch(() => {});
    }
    // Vasta yhteyden sulkemisen jälkeen: tili sallii yhden kerrallaan, joten
    // uutta ei saa avata ennen kuin edellinen on varmasti kiinni.
    if (broke) await this.resume(generation);
  }

  /**
   * Jatkaa lataamista viimeisen kokonaisen klusterin alusta. Onnistunut
   * jatko nollaa laskurin, joten pitkä elokuva kestää useita katkoja — vain
   * peräkkäiset epäonnistumiset lopettavat yrittämisen.
   */
  async resume(generation) {
    if (this.resumes >= MAX_RESUMES) {
      this.state.phase = 'katkesi lopullisesti';
      this.onError(new Error('lataus katkesi toistuvasti'));
      return;
    }
    this.resumes++;
    this.state.resumes = this.resumes;
    const from = this.clusterAt;
    this.state.phase = `jatketaan tavusta ${from} (${this.resumes}/${MAX_RESUMES})`;
    console.warn('[iptv] lataus katkesi, jatketaan tavusta %d (%d/%d)', from, this.resumes, MAX_RESUMES);
    await new Promise((resolve) => setTimeout(resolve, RESUME_DELAY_MS * this.resumes));
    if (this.destroyed || generation !== this.generation) return;
    // Ääniraidan ketju alkaa alusta, koska jatkokohta ei osu kehyksen rajalle.
    this.audioDts = null;
    await this.pump(from, generation);
  }

  /** Odottaa kunnes puskurissa on tilaa. Estää koko tiedoston lataamisen. */
  async waitForRoom(bytes, generation) {
    for (;;) {
      if (this.destroyed || generation !== this.generation) return;
      const ahead = this.bufferedAhead();
      if (bytes.available < MAX_PENDING_BYTES && ahead < BUFFER_AHEAD) return;
      this.state.phase = `odottaa tilaa (puskurissa ${Math.round(ahead)} s, jonossa ${Math.round(bytes.available / 1024)} kt)`;
      await this.evict('video');
      await this.evict('audio');
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  /** Puskuroidun kuvan viimeinen hetki sekunteina. */
  bufferedEnd() {
    const ranges = timeRanges(this.buffers.video);
    return ranges ? ranges.end(ranges.length - 1) : 0;
  }

  bufferedAhead() {
    const sb = this.buffers.video;
    const ranges = timeRanges(sb);
    if (!ranges) return 0;
    const now = this.video.currentTime;
    for (let i = 0; i < ranges.length; i++) {
      if (now >= ranges.start(i) - 0.5 && now <= ranges.end(i)) return ranges.end(i) - now;
    }
    // Toistokohta on puskurin ulkopuolella: dataa tarvitaan heti, eikä
    // etäisyys johonkin toiseen alueeseen saa jarruttaa latausta.
    return 0;
  }

  flushVideo(list, generation) {
    if (generation !== this.generation) return;
    const ticks = list.map((f) => Math.round((f.pts * VIDEO_TIMESCALE) / 1e9));
    const { dts, cts } = decodeTimes(ticks);
    const fallback = this.videoTrack.defaultDuration
      ? Math.round((this.videoTrack.defaultDuration * VIDEO_TIMESCALE) / 1e9)
      : 3750;
    const durs = durations(dts, fallback);
    const samples = list.map((frame, i) => ({
      data: frame.data, dts: dts[i], cts: cts[i], duration: durs[i], keyframe: frame.keyframe,
    }));
    this.append('video', mediaSegment(this.sequence++, 1, samples));
    this.state.segments++;
    this.resumes = 0;
    if (!this.started) { this.started = true; this.onFirstAppend(); }
  }

  /**
   * Ääni ketjutetaan peräkkäin nimelliskestolla. Matroskan aikaleimat ovat
   * millisekunnin tarkkuudella, joten AAC-kehyksen 21,333 ms pyöristyisi ja
   * virhe kertyisi tunnissa sekunneiksi.
   */
  flushAudio(list, rate, generation) {
    if (generation !== this.generation || !this.buffers.audio) return;
    if (this.audioDts == null) {
      this.audioNominal = nominalFrame(list, rate);
      this.audioDts = Math.round((list[0].pts * rate) / 1e9);
    }
    const samples = [];
    for (const frame of list) {
      const wanted = Math.round((frame.pts * rate) / 1e9);
      // Iso poikkeama tarkoittaa aukkoa tai kelausta: sarja aloitetaan alusta.
      if (Math.abs(wanted - this.audioDts) > rate / 4) this.audioDts = wanted;
      samples.push({ data: frame.data, dts: this.audioDts, cts: 0, duration: this.audioNominal, keyframe: true });
      this.audioDts += this.audioNominal;
    }
    this.append('audio', mediaSegment(this.sequence++, 2, samples));
  }

  /**
   * Valmiit AAC-kehykset lähdepuskuriin. Ajat tulevat koodaimelta valmiiksi
   * ketjutettuina, mutta yksi mediapala saa sisältää vain yhtenäisen jakson:
   * tfdt kertoo vain ensimmäisen ajan ja loput lasketaan kestoista.
   */
  flushDecoded(generation) {
    if (generation !== this.generation || !this.buffers.audio || !this.transcoder) return;
    let run = [];
    let next = null;
    const emit = () => {
      if (!run.length) return;
      this.append('audio', mediaSegment(this.sequence++, 2, run));
      run = [];
    };
    for (const chunk of this.transcoder.take()) {
      if (next != null && chunk.dts !== next) emit();
      run.push({ data: chunk.data, dts: chunk.dts, cts: 0, duration: chunk.duration, keyframe: true });
      next = chunk.dts + chunk.duration;
    }
    emit();
  }

  finish(generation) {
    if (generation !== this.generation || this.destroyed) return;
    try {
      if (this.ms && this.ms.readyState === 'open') this.ms.endOfStream();
    } catch { /* selain ehti sulkea */ }
  }

  /* ---------------------------------------------------------------- kelaus */

  /** Cues-taulu tiedoston lopusta. Haetaan kerran ja vain jos kelataan. */
  async loadCues() {
    if (this.cues || this.cuesTried) return this.cues;
    this.cuesTried = true;
    if (this.header.cuesPosition == null) return null;
    const from = this.header.segmentStart + this.header.cuesPosition;
    try {
      const bytes = await this.readRange(from, from + CUES_BYTES - 1);
      this.cues = parseCues(bytes, this.header.timestampScale, this.videoTrack.number);
    } catch (err) {
      console.warn('[iptv] kelaustaulun luku epäonnistui', err);
      this.cues = null;
    }
    return this.cues;
  }

  /**
   * Jatkaa mykkää toistoa jonka selain pysäytti omasta aloitteestaan.
   * Katsojan tauko tulee aina eleestä, joten userActivation erottaa ne;
   * mediakäppäimeltä tuleva tauko menee tässä väärään pinoon, mutta se on
   * harvinaisempi kuin itsestään seisahtuva kuva.
   */
  resumeSilent() {
    if (this.destroyed || this.video.ended || this.video.seeking) return;
    if (this.silentResumes >= MAX_SILENT_RESUMES) return;
    if (navigator.userActivation && navigator.userActivation.isActive) return;
    this.silentResumes++;
    const started = this.video.play();
    if (started && started.catch) started.catch(() => { /* katsoja ehti painaa taukoa */ });
  }

  /** Tiedoston kohta josta annettu hetki alkaa, tai null. */
  async clusterFor(seconds) {
    const cues = await this.loadCues();
    if (!cues || !cues.length) return null;
    let best = cues[0];
    for (const cue of cues) {
      if (cue.time <= seconds + 0.001) best = cue; else break;
    }
    return this.header.segmentStart + best.position;
  }

  async handleSeek() {
    if (this.destroyed || !this.header) return;
    const target = this.video.currentTime;
    if (this.isBuffered(target)) return;

    // Sukupolvi kasvaa ennen ensimmäistä awaitia. Kelaustaulun haku vie
    // ainoan yhteyden, jolloin käynnissä oleva pumppu näkee virran
    // loppuvan — vanhentuneena se ei enää päätä tiedostoa endOfStreamilla,
    // joka typistäisi keston puskurin loppuun ja romuttaisi juuri tämän
    // kelauksen.
    const generation = ++this.generation;
    this.closeConnection();

    const offset = await this.clusterFor(target);
    if (offset == null || this.destroyed || generation !== this.generation) return;
    // Vanhat palat pois kelauskohdan ympäriltä, muuten puskuri pirstaloituu.
    await this.clear();
    if (this.destroyed || generation !== this.generation) return;
    this.sequence++;
    this.audioDts = null;
    this.resumes = 0;
    this.pump(offset, generation).catch((err) => this.fail(err));
  }

  isBuffered(time) {
    const ranges = timeRanges(this.buffers.video);
    if (!ranges) return false;
    for (let i = 0; i < ranges.length; i++) {
      if (time >= ranges.start(i) && time < ranges.end(i) - 0.5) return true;
    }
    return false;
  }

  async clear() {
    for (const kind of ['video', 'audio']) {
      const sb = this.buffers[kind];
      if (!timeRanges(sb)) continue;
      await new Promise((resolve) => {
        const done = () => { sb.removeEventListener('updateend', done); resolve(); };
        sb.addEventListener('updateend', done);
        try { sb.remove(0, this.ms.duration || Infinity); } catch { done(); }
      });
    }
    this.queues.video = Promise.resolve();
    this.queues.audio = Promise.resolve();
  }
}

/* ------------------------------------------------------------- apurit */

const formatClock = (seconds) => {
  const total = Math.max(0, Math.round(seconds));
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}:${ss}`;
};

/**
 * SourceBufferin alueet, tai null jos puskuria ei voi lukea. Kun MediaSource
 * sulkeutuu, buffered heittää poikkeuksen — sitä tapahtuu normaalisti kun
 * toisto lopetetaan kesken latauksen.
 */
function timeRanges(sb) {
  if (!sb) return null;
  try {
    const ranges = sb.buffered;
    return ranges.length ? ranges : null;
  } catch {
    return null;
  }
}

const supportedAudio = (track) => {
  const mime = AUDIO_MIME[track.codecId];
  if (!mime) return false;
  try { return MediaSource.isTypeSupported(`audio/mp4; codecs="${mime}"`); } catch { return false; }
};

/**
 * AAC-kehyksen pituus näytteinä. Yksittäisten aikaleimojen erotus olisi
 * millisekuntipyöristyksen takia epäluotettava, joten se lasketaan pitkältä
 * väliltä ja pyöristetään lähimpään vakioarvoon.
 */
function nominalFrame(list, rate) {
  if (list.length < 8) return 1024;
  const span = list[list.length - 1].pts - list[0].pts;
  const average = (span * rate) / 1e9 / (list.length - 1);
  let best = 1024;
  let distance = Infinity;
  for (const candidate of AAC_FRAME_LENGTHS) {
    const d = Math.abs(candidate - average);
    if (d < distance) { distance = d; best = candidate; }
  }
  return best;
}

/** CuePoint → { time (s), position (segmentin alusta) } videoraidalle. */
function parseCues(bytes, timestampScale, trackNumber) {
  const out = [];
  const r = new Reader(bytes);
  const first = r.vint(true);
  if (!first || first.value !== ID.Cues) return null;
  const size = r.vint(false);
  if (!size) return null;
  const end = size.unknown ? bytes.length : Math.min(bytes.length, r.p + size.value);

  while (r.p < end) {
    const id = r.vint(true);
    if (!id) break;
    const length = r.vint(false);
    if (!length) break;
    const start = r.p;
    const stop = Math.min(end, start + length.value);
    if (id.value === ID.CuePoint) {
      let time = null;
      let position = null;
      const inner = new Reader(bytes, start, stop);
      while (inner.p < stop) {
        const innerId = inner.vint(true);
        if (!innerId) break;
        const innerSize = inner.vint(false);
        if (!innerSize) break;
        const innerStart = inner.p;
        const innerStop = Math.min(stop, innerStart + innerSize.value);
        if (innerId.value === ID.CueTime) time = inner.uint(innerSize.value);
        else if (innerId.value === ID.CueTrackPositions) {
          let track = null;
          let cluster = null;
          const deep = new Reader(bytes, innerStart, innerStop);
          while (deep.p < innerStop) {
            const deepId = deep.vint(true);
            if (!deepId) break;
            const deepSize = deep.vint(false);
            if (!deepSize) break;
            if (deepId.value === ID.CueTrack) track = deep.uint(deepSize.value);
            else if (deepId.value === ID.CueClusterPosition) cluster = deep.uint(deepSize.value);
            deep.p += deepSize.value;
          }
          if (cluster != null && (track == null || track === trackNumber)) position = cluster;
        }
        inner.p = innerStop;
      }
      if (time != null && position != null) {
        out.push({ time: (time * timestampScale) / 1e9, position });
      }
    }
    r.p = stop;
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}

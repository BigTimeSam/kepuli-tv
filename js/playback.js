// Toistomoottorin valinta, elinkaari ja itsekorjaus.
//
// Xtream tarjoilee live-kanavat MPEG-TS-virtana, jota <video> ei osaa
// natiivisti — mpegts.js purkaa sen fMP4:ksi MediaSourcelle. Jos TS ei lähde
// käyntiin, kokeillaan saman kanavan HLS-muunnosta hls.js:llä. VOD toistetaan
// natiivisti; Chrome ei tue Matroskaa (.mkv) eikä .avi:ta.
//
// Kun pääte ei lupaa toistoa — tai kun kaikki moottorit ovat epäonnistuneet —
// luetaan tiedoston otsikko (probe.js) ja kerrotaan tarkka syy. Otsikko myös
// paljastaa, jos kontti on todellisuudessa eri kuin pääte väittää: silloin
// toisto onnistuu, vaikka pääte olisi torjuttu. Otsikkoa ei lueta etukäteen,
// koska tili sallii vain yhden yhtäaikaisen yhteyden.

import { isPlayableExtension } from './xtream.js';
import { t } from './i18n.js';
import { probe, verdict } from './probe.js';
import { Remuxer } from './remux.js';

const MPEGTS_CONFIG = {
  enableWorker: false,        // laajennussivun CSP estää blob:-workerit
  enableWorkerForMSE: false,

  // Pieni syötepuskuri tasaa verkon nykimistä. Vastineeksi tulee sen
  // verran viivettä kuin puskuri kestää — sekunnin murto-osia HD-virralla.
  enableStashBuffer: true,
  stashInitialSize: 256 * 1024,

  // Ilman tätä MSE:n puskuri kasvaa rajatta ja Chromen kiintiö täyttyy:
  // pitkä katselu päättyy QuotaExceededed-virheeseen tunnin parin jälkeen.
  autoCleanupSourceBuffer: true,
  autoCleanupMaxBackwardDuration: 60,
  autoCleanupMinBackwardDuration: 30,

  // Viiveen jahtaaminen hyppää eteenpäin heti kun puskuria kertyy — ja
  // juuri se puskuri kantaisi katkoksen yli. Sallitaan reilummin.
  liveBufferLatencyChasing: true,
  liveBufferLatencyMaxLatency: 15,
  liveBufferLatencyMinRemain: 3,
  lazyLoad: false,
};

const HLS_CONFIG = {
  enableWorker: false,        // sama syy kuin yllä
  lowLatencyMode: false,
  backBufferLength: 30,
  manifestLoadingMaxRetry: 2,
  levelLoadingMaxRetry: 2,
  fragLoadingMaxRetry: 3,
};

// Palvelin voi hyväksyä yhteyden ja jäädä hiljaiseksi — esimerkiksi kun tilin
// yhtäaikaisten yhteyksien raja on täynnä — jolloin virhetapahtumaa ei tule.
const TIMEOUT_MS = { mpegts: 20000, hls: 20000, native: 30000, remux: 30000 };
const ENGINE_LABEL = { mpegts: 'mpegts.js', hls: 'hls.js', native: 'natiivi', remux: 'MKV-purku' };

const STALL_CHECK_MS = 4000;
const STALL_LIMIT_MS = 14000;
const MAX_RECONNECTS = 4;
const RECONNECT_STEP_MS = 1000;
const RECONNECT_MAX_MS = 8000;

// Kuinka kauan toiston on kuljettava ennen kuin yritykset nollataan.
// Ilman tätä 48 sekunnin välein kuoleva virta yrittäisi ikuisesti eikä
// katsoja saisi koskaan tietää, että vika on lähteessä.
const STABLE_MS = 30000;

export class Playback {
  /**
   * @param {HTMLVideoElement} video
   * @param {(state: object) => void} onState
   */
  constructor(video, onState) {
    this.video = video;
    this.onState = onState || (() => {});
    this.engine = null;
    this.engineName = null;
    this.token = 0;
    this.cleanup = null;
    this.spec = null;
    this.reconnects = 0;
    this.watchdog = null;
    this.lastProgressAt = 0;
    this.lastTime = -1;
    this.wantPlaying = false;   // katsojan tahto, ei elementin tila
    this.guards = null;
    this.recovering = false;
    this.stableTimer = null;
  }

  stop() {
    this.token++;
    this.stopWatchdog();
    this.detachGuards();
    clearTimeout(this.stableTimer);
    this.wantPlaying = false;
    this.recovering = false;
    if (this.cleanup) { this.cleanup(); this.cleanup = null; }
    const engine = this.engine;
    this.engine = null;
    this.engineName = null;
    this.spec = null;
    this.reconnects = 0;
    if (engine) {
      try {
        if (engine.destroy) engine.destroy();
        if (engine.detachMediaElement) engine.detachMediaElement();
      } catch { /* moottori oli jo purettu */ }
    }
    this.video.removeAttribute('src');
    this.video.load();
  }

  /**
   * @param {{url:string, hlsUrl?:string, live:boolean, ext?:string,
   *          startAt?:number, mode?:'auto'|'ts'|'hls'}} spec
   */
  play(spec) {
    this.stop();          // kasvattaa tokenin ja mitätöi edellisen yrityksen
    this.spec = spec;
    this.begin(spec, this.token);
  }

  /** Sama lähde uudelleen ilman että laskurit nollautuvat. */
  restart() {
    if (!this.spec) return;
    const spec = this.spec;
    this.stopWatchdog();
    // Vartijat irti ennen kuin videoelementtiin kosketaan: load() laukaisee
    // pause-tapahtuman, joka näyttäisi katsojan tauolta.
    this.detachGuards();
    clearTimeout(this.stableTimer);
    if (this.cleanup) { this.cleanup(); this.cleanup = null; }
    const engine = this.engine;
    this.engine = null;
    if (engine) { try { engine.destroy(); } catch { /* purettu */ } }
    this.video.removeAttribute('src');
    this.video.load();
    this.token++;
    this.spec = spec;
    this.begin(spec, this.token);
  }

  /** start() ilman että kutsujan tarvitsee huolehtia paluulupauksesta. */
  begin(spec, token) {
    this.start(spec, token).catch((err) => {
      if (token !== this.token) return;
      console.error('[iptv] toiston aloitus epäonnistui', err);
      this.onState({ status: 'error', message: t('playback.startfailed') });
    });
  }

  async start(spec, token) {
    let chain = buildChain(spec);
    // Pääte ei ole todiste kontista. Kirjaston .ts-tiedostot ovat mittauksen
    // mukaan poikkeuksetta Matroskaa (10/10 otoksessa), jolloin mpegts.js
    // jäisi odottamaan 20 sekunnin aikakatkaisua ennen kuin syy selviäisi —
    // otsikko luetaan siksi jo ennen ensimmäistä yritystä. Päätteet .mp4 ja
    // .mkv taas pitivät otoksessa aina paikkansa, eikä niitä hidasteta.
    if (chain.length === 0 || (!spec.live && chain[0] === 'mpegts')) {
      const known = await this.inspect(spec, token);
      if (!known) return;
      if (known.path === 'native') chain = ['native'];
      else if (known.path === 'mpegts') chain = ['mpegts'];
      else if (known.path === 'remux') chain = ['remux'];
      // Ääniraita on AC3:a tai DTS:ää: kuva kelpaisi, mutta mykkä toisto on
      // katsojan valinta eikä oletus.
      else if (known.path === 'silent') {
        if (!spec.allowSilent) return this.refuse(known, { canSilent: true });
        chain = ['remux'];
      }
      else if (known.path !== 'unknown') return this.refuse(known);
      else if (!chain.length) return this.refuse(known);
      // Tuntematon tulos ei estä yrittämästä: otsikon luku on voinut kaatua
      // varattuun yhteyteen, mikä ei kerro tiedostosta mitään.
    }
    const attempt = (i) => {
      if (token !== this.token) return;
      if (i >= chain.length) return void this.explain(spec, token);
      const name = chain[i];
      this.onState({ status: 'loading', engine: ENGINE_LABEL[name], attempt: i });
      this.runAttempt(name, spec, token, () => attempt(i + 1));
    };
    attempt(0);
  }

  /**
   * Lukee tiedoston otsikon ja tallettaa tuloksen spekkiin. Palauttaa
   * päätelmän, tai null jos yritys ehti vanhentua.
   */
  async inspect(spec, token) {
    this.onState({ status: 'probing' });
    const info = await probe(spec.url);
    if (token !== this.token) return null;
    const known = verdict(info);
    spec.probe = info;
    spec.verdict = known;
    return known;
  }

  refuse(known, extra = {}) {
    this.onState({
      status: 'error',
      message: t('playback.hint.copy', { reason: known.reason }),
      canExternal: true,
      verdict: known,
      ...extra,
    });
  }

  /**
   * Kaikki moottorit epäonnistuivat. Otsikosta selviää, oliko syy muodossa
   * vai lähteessä — pelkkä "ei onnistunut" jättäisi käyttäjän arvailemaan.
   * Live-virtaa ei tutkita: sen lukeminen veisi ainoan sallitun yhteyden
   * eikä kertoisi mitään päätteestä poikkeavaa.
   */
  async explain(spec, token) {
    const generic = t('playback.nosource');
    if (spec.live || spec.probe) { this.onState({ status: 'error', message: generic, verdict: spec.verdict }); return; }
    const known = await this.inspect(spec, token);
    if (!known) return;
    if (known.path === 'silent') return this.refuse(known, { canSilent: true });
    if (known.path === 'remux' || known.path === 'none') return this.refuse(known);
    this.onState({ status: 'error', message: generic, verdict: known });
  }

  runAttempt(name, spec, token, onFail) {
    const video = this.video;
    let settled = false;

    const finish = (ok, why) => {
      if (settled || token !== this.token) return;
      settled = true;
      drop();
      if (ok) {
        this.engineName = ENGINE_LABEL[name];
        this.wantPlaying = true;
        // Yrityslaskuri nollautuu vasta kun toisto on oikeasti kantanut:
        // heti nollattuna katkeileva lähde ei koskaan saavuttaisi rajaa.
        clearTimeout(this.stableTimer);
        this.stableTimer = setTimeout(() => { this.reconnects = 0; }, STABLE_MS);
        this.onState({ status: 'playing', engine: this.engineName });
        this.bindGuards(token);
        this.startWatchdog(token);
        return;
      }
      console.warn('[iptv] moottori %s ei käynnistynyt: %s', name, why);
      const engine = this.engine;
      this.engine = null;
      if (engine) { try { engine.destroy(); } catch { /* purettu */ } }
      onFail();
    };

    const onPlaying = () => finish(true);
    const onError = () => finish(false, t('playback.reason.media', { code: video.error ? video.error.code : '?' }));
    // Elementti voi jäädä tauolle kesken käynnistyksen: mpegts kiinnittää
    // MediaSourcen vasta load():ssa, ja elementin latausalgoritmi lähettää
    // pause-tapahtuman vielä loadedmetadatan jälkeen — sitä ennen kutsuttu
    // play() peruuntuu hiljaa. Mihinkään yksittäiseen tapahtumaan ei siis
    // voi luottaa, joten yritetään uudelleen kunnes toisto lähtee tai
    // aikakatkaisu täyttyy.
    // Ehto currentTime === 0 rajaa tämän käynnistykseen: sen jälkeen tauko
    // on katsojan oma eikä sitä sovi ohittaa.
    const nudge = setInterval(() => {
      if (video.paused && video.currentTime === 0) this.tryPlay();
    }, 500);
    const timer = setTimeout(() => finish(false, 'aikakatkaisu'), TIMEOUT_MS[name]);

    video.addEventListener('playing', onPlaying);
    video.addEventListener('error', onError);
    const drop = () => {
      clearTimeout(timer);
      clearInterval(nudge);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('error', onError);
    };
    this.cleanup = drop;

    try {
      if (name === 'mpegts') this.startMpegts(spec.url, spec.live, finish);
      else if (name === 'hls') this.startHls(spec.hlsUrl || spec.url, finish);
      else if (name === 'remux') this.startRemux(spec, finish);
      else this.startNative(spec);
    } catch (err) {
      finish(false, String(err && err.message));
    }
  }

  startMpegts(url, isLive, finish) {
    if (typeof mpegts === 'undefined' || !mpegts.isSupported()) return finish(false, 'mpegts.js ei tuettu');
    const player = mpegts.createPlayer({ type: 'mpegts', isLive, url }, MPEGTS_CONFIG);
    this.engine = player;
    player.on(mpegts.Events.ERROR, (type, detail) => finish(false, `${type}/${detail}`));
    // Live-lähde ei lopu itsestään: tämä tarkoittaa että palvelin katkaisi
    // yhteyden. Puskuri soitetaan vielä loppuun, ja ended-vartija hoitaa
    // uudelleenyhdistämisen — näin katsoja näkee kaiken saapuneen kuvan.
    player.on(mpegts.Events.LOADING_COMPLETE, () => {
      if (isLive) console.info('[iptv] lähde päättyi kesken live-virran');
    });
    player.attachMediaElement(this.video);
    player.load();
    this.tryPlay();
  }

  startHls(url, finish) {
    if (typeof Hls === 'undefined' || !Hls.isSupported()) return finish(false, 'hls.js ei tuettu');
    const hls = new Hls(HLS_CONFIG);
    this.engine = hls;
    let recovered = 0;
    hls.on(Hls.Events.ERROR, (_e, data) => {
      if (!data.fatal) return;
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR && recovered < 2) { recovered++; hls.recoverMediaError(); return; }
      finish(false, `${data.type}/${data.details}`);
    });
    hls.on(Hls.Events.MANIFEST_PARSED, () => this.tryPlay());
    hls.attachMedia(this.video);
    hls.loadSource(url);
  }

  /**
   * Matroska MediaSourcen kautta. Remuxer hoitaa lataamisen, purun ja
   * palojen syötön; tänne riittää elinkaari ja virheiden välitys.
   */
  startRemux(spec, finish) {
    const remuxer = new Remuxer(this.video, spec.url, {
      startAt: spec.startAt || 0,
      subtitleLang: spec.subtitleLang || null,
      onFirstAppend: () => this.tryPlay(),
      onNotice: (message) => this.onState({ status: 'notice', message }),
      onSubtitles: (info) => this.onState({ status: 'subtitles', ...info }),
      onError: (err) => finish(false, err && err.message ? err.message : t('playback.reason.demux')),
    });
    this.engine = remuxer;
    remuxer.start().catch((err) => finish(false, err && err.message ? err.message : String(err)));
  }

  startNative(spec) {
    const video = this.video;
    if (spec.startAt > 0) {
      const seek = () => {
        video.removeEventListener('loadedmetadata', seek);
        if (Number.isFinite(video.duration) && spec.startAt < video.duration - 5) {
          try { video.currentTime = spec.startAt; } catch { /* selain kieltäytyi */ }
        }
      };
      video.addEventListener('loadedmetadata', seek);
    }
    video.src = spec.url;
    this.tryPlay();
  }

  /**
   * Tekstitysraidan vaihto. Vain MKV-purku tuntee tekstitykset: muissa
   * moottoreissa raitoja ei ole, joten kutsu ei tee mitään.
   */
  selectSubtitle(number) {
    const engine = this.engine;
    if (!engine || !engine.selectSubtitle) return null;
    return engine.selectSubtitle(number);
  }

  tryPlay() {
    const started = this.video.play();
    if (started && started.catch) started.catch((err) => {
      if (err.name === 'NotAllowedError') {
        this.onState({ status: 'blocked', message: t('playback.autoplay') });
      }
    });
  }

  /* --------------------------------------------------------- itsekorjaus */

  /**
   * Live-lähteen kuolema näkyy kolmena eri tilana, ja kaikki on
   * tunnistettava erikseen:
   *
   *   1. palvelin katkaisee     mpegts: LOADING_COMPLETE
   *   2. puskuri soitetaan loppuun   <video>: ended (ja samalla paused)
   *   3. yhteys jää auki, data loppuu   currentTime ei etene
   *
   * Kohta 2 näyttää elementin tasolla täsmälleen samalta kuin katsojan
   * painama tauko. Ero on tahdossa, ei tilassa — siksi wantPlaying.
   */
  bindGuards(token) {
    this.detachGuards();
    if (!this.spec || !this.spec.live) return;
    const video = this.video;
    const onEnded = () => { if (token === this.token) this.recover(t('playback.reason.ended')); };
    const onPause = () => { if (token === this.token && !video.ended) this.wantPlaying = false; };
    const onPlay = () => { if (token === this.token) this.wantPlaying = true; };
    video.addEventListener('ended', onEnded);
    video.addEventListener('pause', onPause);
    video.addEventListener('play', onPlay);
    this.guards = () => {
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('play', onPlay);
    };
  }

  detachGuards() {
    if (this.guards) { this.guards(); this.guards = null; }
  }

  /** Yksi ovi uudelleenyhdistämiseen, tuli syy mistä tahansa. */
  recover(reason) {
    if (!this.spec || !this.spec.live || this.recovering) return;
    this.recovering = true;
    this.stopWatchdog();
    this.detachGuards();

    if (this.reconnects >= MAX_RECONNECTS) {
      this.recovering = false;
      this.onState({
        status: 'error',
        message: t('playback.gaveup', { reason, max: MAX_RECONNECTS }) + t('playback.gaveup.hint'),
      });
      return;
    }
    this.reconnects++;
    this.onState({ status: 'reconnecting', attempt: this.reconnects, max: MAX_RECONNECTS, reason });
    // Porrastus antaa palvelimen vapauttaa edellisen yhteyden: tili sallii
    // vain muutaman yhtäaikaisen, ja heti uusittu pyyntö torjutaan.
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_STEP_MS * this.reconnects);
    setTimeout(() => {
      this.recovering = false;
      if (this.spec) this.restart();
    }, delay);
  }

  /** Kuvan jähmettyminen — kohta 3 yllä. */
  startWatchdog(token) {
    this.stopWatchdog();
    if (!this.spec || !this.spec.live) return;
    this.lastTime = this.video.currentTime;
    this.lastProgressAt = Date.now();
    this.watchdog = setInterval(() => {
      if (token !== this.token) return this.stopWatchdog();
      const video = this.video;

      if (video.ended) return this.recover(t('playback.reason.buffer'));

      if (video.paused) {
        // Katsojan oma tauko on ainoa tauko jota ei korjata.
        if (!this.wantPlaying) { this.lastProgressAt = Date.now(); return; }
        this.tryPlay();
        return;
      }

      if (video.currentTime > this.lastTime + 0.05) {
        this.lastTime = video.currentTime;
        this.lastProgressAt = Date.now();
        return;
      }
      if (Date.now() - this.lastProgressAt < STALL_LIMIT_MS) return;
      this.recover(t('playback.reason.frozen'));
    }, STALL_CHECK_MS);
  }

  stopWatchdog() {
    if (this.watchdog) { clearInterval(this.watchdog); this.watchdog = null; }
  }

  /** Tekniset tiedot näytettäväksi: resoluutio, moottori, bittinopeus. */
  stats() {
    const video = this.video;
    if (!video.videoWidth) return null;
    const out = { width: video.videoWidth, height: video.videoHeight, engine: this.engineName };
    const engine = this.engine;
    if (engine && typeof Hls !== 'undefined' && engine instanceof Hls) {
      const level = engine.levels && engine.levels[engine.currentLevel];
      if (level && level.bitrate) out.kbps = Math.round(level.bitrate / 1000);
    } else if (engine && engine.statisticsInfo && engine.statisticsInfo.speed) {
      out.kbps = Math.round(engine.statisticsInfo.speed * 8);
    }
    return out;
  }
}

function buildChain(spec) {
  if (/\.m3u8($|\?)/i.test(spec.url)) return ['hls'];
  if (spec.live) {
    if (spec.mode === 'ts') return ['mpegts'];
    if (spec.mode === 'hls') return spec.hlsUrl ? ['hls', 'mpegts'] : ['mpegts'];
    return spec.hlsUrl ? ['mpegts', 'hls'] : ['mpegts'];
  }
  if (/\.(ts|flv)($|\?)/i.test(spec.url)) return ['mpegts'];
  if (isPlayableExtension(spec.ext) || /\.(mp4|m4v|mov|webm|ogv)($|\?)/i.test(spec.url)) return ['native'];
  return [];
}

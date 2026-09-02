// Luovutus ulkoiselle soittimelle.
//
// Wasm-purku kattaa AC-3:n, E-AC-3:n ja DTS:n, mutta kaikkea ei selaimeen
// saa: AVI-kontti, VC-1, 10-bittinen H.264 ja bittikarttatekstitykset (PGS,
// VOBSUB) jäävät ulottumattomiin. Työpöytäsoitin osaa ne natiivisti, ja
// Xtreamin stream-osoite kelpaa sille sellaisenaan — mitään ei tarvitse
// välittää eteenpäin osoitetta enempää.
//
// Reittejä oli kaksi, jäljellä on yksi. Soittolistatiedosto: yhden kohteen
// .m3u ladataan blobista, ja käyttöjärjestelmä avaa sen sillä soittimella
// joka on rekisteröity .m3u:lle — VLC:llä se on `public.m3u-playlist` sen
// Info.plistissä. `#EXTVLCOPT` vie katselukohdan mukana. Kaksi klikkausta,
// mutta toimii ilman että mitään on asennettu laajennusta varten eikä vaadi
// uusia manifest-oikeuksia.
//
// Soittimen omat URL-skeemat (iina://, mpv://) jäivät pois: ne vaativat
// käyttäjältä valinnan ja tiedon siitä mitä hänelle on asennettu, ja mitattu
// hyöty oli yksi klikkaus. VLC ei rekisteröi `vlc://`-skeemaa lainkaan, eli
// yleisimmälle soittimelle tiedostoreitti on joka tapauksessa ainoa.
//
// Osoitteessa ovat Xtreamin tunnukset, joten ladattu soittolista on yhtä
// arkaluontoinen kuin itse tili.

import { t } from './i18n.js';

/** Napin selitteeseen: mihin luovutus veisi. */
export function externalLabel() { return t('ext.label'); }

/**
 * Luovuttaa virran ulkoiselle soittimelle.
 *
 * Kutsuttava suoraan käyttäjän eleestä ilman välissä olevaa awaitia: lataus
 * on selaimessa eleen vaativa toiminto samalla tavalla kuin
 * permissions.request.
 *
 * @param {{url: string, startAt?: number}} spec
 * @param {string} name kohteen nimi soittolistariville ja tiedostonimeksi
 */
export function handOff(spec, name) {
  downloadPlaylist(spec, name);
}

/** Yhden kohteen soittolista. */
export function playlist(spec, name) {
  const lines = ['#EXTM3U', `#EXTINF:-1,${title(name)}`];
  // VLC:n oma laajennos: aloituskohta sekunteina. Muut soittimet ohittavat
  // tuntemattoman risuaitarivin, joten se ei riko mitään.
  if (spec.startAt > 0) lines.push(`#EXTVLCOPT:start-time=${Math.floor(spec.startAt)}`);
  lines.push(spec.url, '');
  return lines.join('\n');
}

// Rivinvaihto katkaisisi soittolistan ja pilkku #EXTINF:n kentät.
const title = (name) => String(name || 'Stream').replace(/[\r\n]+/g, ' ').trim();

// Tiedostonimestä pois se mitä tiedostojärjestelmät eivät ota vastaan.
// Nimet ovat kirjastossa pitkiä, joten myös katkaisu on tarpeen.
function filename(name) {
  const clean = title(name).replace(/[/\\:*?"<>|]+/g, '-').replace(/\s+/g, ' ').slice(0, 80).trim();
  return clean || 'stream';
}

function downloadPlaylist(spec, name) {
  const blob = new Blob([playlist(spec, name)], { type: 'audio/x-mpegurl' });
  const href = URL.createObjectURL(blob);
  click(href, `${filename(name)}.m3u`);
  // Blobia ei saa vapauttaa samalla tikillä: lataus lukee sen vasta kun
  // tapahtumasilmukka on pyörähtänyt.
  setTimeout(() => URL.revokeObjectURL(href), 60000);
}

/** Ankkurin klikkaus: lataus tarvitsee download-attribuutin. */
function click(href, download) {
  const a = document.createElement('a');
  a.href = href;
  a.download = download;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

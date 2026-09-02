// Muotoilijat. Yksi Intl-instanssi per muoto: uuden luominen jokaiselle
// riville olisi virtualisoidussa listassa mitattavaa kuormaa.
//
// Instanssit ovat let-sidoksia eivätkä vakioita, koska kieli voi vaihtua
// kesken istunnon. ES-moduulin tuonti on elävä sidos, joten setLocale
// riittää: kaikki tuojat näkevät uuden muotoilijan ilman omaa toimenpidettä.

import { t, localeTag } from './i18n.js';

export let nf, timeFmt, dateTimeFmt, dateFmt, dayFmt, weekdayFmt, stampFmt;

export function setLocale(tag = localeTag()) {
  nf = new Intl.NumberFormat(tag);
  timeFmt = new Intl.DateTimeFormat(tag, { hour: '2-digit', minute: '2-digit' });
  dateTimeFmt = new Intl.DateTimeFormat(tag, { dateStyle: 'short', timeStyle: 'short' });
  dateFmt = new Intl.DateTimeFormat(tag, { dateStyle: 'medium' });
  dayFmt = new Intl.DateTimeFormat(tag, { weekday: 'short', day: 'numeric', month: 'numeric' });
  weekdayFmt = new Intl.DateTimeFormat(tag, { weekday: 'long' });
  stampFmt = new Intl.DateTimeFormat(tag, {
    weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

setLocale();

export function clock(ms) { return ms ? timeFmt.format(new Date(ms)) : ''; }

export function megabytes(bytes) {
  if (bytes < 1024 * 1024) return t('size.kb', { n: Math.round(bytes / 1024) });
  return t('size.mb', { n: (bytes / 1048576).toFixed(1) });
}

export function duration(totalSeconds) {
  if (!totalSeconds) return '';
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.round((totalSeconds % 3600) / 60);
  if (h > 0) return m > 0 ? t('duration.hm', { h, m }) : t('duration.h', { h });
  return t('duration.m', { m });
}

export function clockDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const s = Math.floor(seconds % 60);
  const m = Math.floor(seconds / 60) % 60;
  const h = Math.floor(seconds / 3600);
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? h + ':' : ''}${mm}:${String(s).padStart(2, '0')}`;
}

/** Ohjelman eteneminen 0–1, tai null jos ei käynnissä. */
export function progressOf(programme, now = Date.now()) {
  if (!programme || !programme.start || !programme.stop) return null;
  if (now < programme.start || now >= programme.stop) return null;
  return (now - programme.start) / (programme.stop - programme.start);
}

/** "tänään", "eilen", "pe 5.9." — lyhyt muoto mahtuu oppaan aikajanalle. */
export function shortDay(ms) {
  const diff = dayOffset(ms);
  if (diff === 0) return t('day.short.today');
  if (diff === 1) return t('day.short.tomorrow');
  if (diff === -1) return t('day.short.yesterday');
  return dayFmt.format(new Date(ms));
}

/**
 * Historian väliotsikko: "Tänään", "Eilen", "Maanantai", "12.8.2025".
 * Viikonpäivä riittää nimeksi vain kuluvan viikon ajan — sen jälkeen
 * "maanantai" olisi kahdeksan päivän päässä yhtä hyvin kuin eilen.
 */
export function dayLabel(ms) {
  if (!ms) return t('day.earlier');
  const diff = dayOffset(ms);
  if (diff === 0) return t('day.today');
  if (diff === -1) return t('day.yesterday');
  const date = new Date(ms);
  if (diff > -7) {
    const name = weekdayFmt.format(date);
    return name.charAt(0).toUpperCase() + name.slice(1);
  }
  return dateFmt.format(date);
}

/** Vuorokausia tästä päivästä. Kesäaika tekee päivistä 23 ja 25 tunnin
 *  mittaisia, joten ero lasketaan kalenteripäivinä eikä jakolaskuna. */
function dayOffset(ms) {
  const a = new Date(ms); a.setHours(0, 0, 0, 0);
  const b = new Date(); b.setHours(0, 0, 0, 0);
  return Math.round((a - b) / 86400e3);
}

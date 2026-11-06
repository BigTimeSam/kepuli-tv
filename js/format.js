// @ts-check
// Formatters. One Intl instance per format: creating a new one for every
// row would be measurable load in a virtualised list.
//
// The instances are let bindings rather than constants, because the
// language can change mid-session. An ES module import is a live binding,
// so setLocale is enough: every importer sees the new formatter without
// doing anything itself.

import { t, localeTag } from './i18n.js';

export let nf, timeFmt, dateTimeFmt, dateFmt, dayFmt, weekdayFmt, stampFmt;
let oneDecimal, twoDecimals, percentFmt, wholePercentFmt, calendarFmt;

/**
 * @param {string} [tag]
 * @param {{hourCycle?: 'h12'|'h23'}} [options]
 */
export function setLocale(tag = localeTag(), { hourCycle = 'h23' } = {}) {
  nf = new Intl.NumberFormat(tag);
  oneDecimal = new Intl.NumberFormat(tag, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  twoDecimals = new Intl.NumberFormat(tag, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  percentFmt = new Intl.NumberFormat(tag, { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });
  wholePercentFmt = new Intl.NumberFormat(tag, { style: 'percent' });
  // The clock is the setting's (see hourCycle() in js/config.js), never the
  // language's own default: Greek and Albanian would otherwise read 03:00
  // μ.μ. and 03:00 e pasdites to a viewer who asked for neither.
  const h12 = hourCycle === 'h12';
  timeFmt = new Intl.DateTimeFormat(tag, { hour: h12 ? 'numeric' : '2-digit', minute: '2-digit', hourCycle });
  dateTimeFmt = new Intl.DateTimeFormat(tag, { dateStyle: 'short', timeStyle: 'short', hourCycle });
  dateFmt = new Intl.DateTimeFormat(tag, { dateStyle: 'medium' });
  // A calendar date read as UTC, so that no time zone moves it a day.
  calendarFmt = new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'UTC' });
  dayFmt = new Intl.DateTimeFormat(tag, { weekday: 'short', day: 'numeric', month: 'numeric' });
  weekdayFmt = new Intl.DateTimeFormat(tag, { weekday: 'long' });
  stampFmt = new Intl.DateTimeFormat(tag, {
    weekday: 'short', day: 'numeric', month: 'numeric', hour: h12 ? 'numeric' : '2-digit', minute: '2-digit', hourCycle,
  });
}

setLocale();

export function clock(ms) { return ms ? timeFmt.format(new Date(ms)) : ''; }

/**
 * An ISO calendar date in the language's own short form ("3.11.2026",
 * "03/11/2026", "11/3/2026"), without letting the viewer's time zone shift
 * the day.
 */
export function calendarDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
  if (!match) return '';
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
  return calendarFmt.format(date);
}

/** A stored size: the same figures as a download's, in the language's decimals. */
export function megabytes(bytes) {
  return amount(bytes);
}

/**
 * An amount of a download, in the language's own decimals: kilobytes below
 * a megabyte, megabytes with one decimal above — "17,3 Mt" moves visibly as
 * a slow download goes on, where whole megabytes would stand still.
 */
export function amount(bytes) {
  if (bytes < 1024 * 1024) return t('size.kb', { n: nf.format(Math.round(bytes / 1024)) });
  return t('size.mb', { n: oneDecimal.format(bytes / 1048576) });
}

/** A download speed, bytes a second. */
export function speed(bytesPerSecond) {
  return t('size.rate', { amount: amount(bytesPerSecond) });
}

/** A bit rate as megabits a second, the figure a connection is sold by. */
export function mbits(bitsPerSecond) {
  const value = bitsPerSecond / 1e6;
  // Below a megabit one decimal would round a film's rate and a slower
  // connection's to the same figure.
  return value < 1 ? twoDecimals.format(value) : oneDecimal.format(value);
}

/** A share, 0 to 1, as a percentage with one decimal: "12,3 %". */
export function percent(share) {
  return percentFmt.format(share);
}

/** A share as a whole percentage: "120 %", for the subtitles' size. */
export function wholePercent(share) {
  return wholePercentFmt.format(share);
}

/** A number with one decimal in the language's own form: "7,5" in Finnish. */
export function oneDecimalNumber(value) {
  return oneDecimal.format(value);
}

/**
 * An episode's place in its series as the language's television writes
 * it: "S1 E2", "K1 J2" in Finnish, "T1 E2" in Spanish.
 */
export function episodeCode(season, episode) {
  return t('episode.code', { season: season ?? '', episode: episode ?? '' });
}

/** Seconds with one decimal, for the picture buffered ahead. */
export function seconds(value) {
  return oneDecimal.format(value);
}

export function duration(totalSeconds, { compact = false } = {}) {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '';
  const minutes = Math.round(totalSeconds / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const prefix = compact ? 'duration.compact' : 'duration';
  if (h > 0) return m > 0 ? t(`${prefix}.hm`, { h, m }) : t(`${prefix}.h`, { h });
  return t('duration.m', { m });
}

/** Programme progress 0–1, or null when it is not on air. */
export function progressOf(programme, now = Date.now()) {
  if (!programme || !programme.start || !programme.stop) return null;
  if (now < programme.start || now >= programme.stop) return null;
  return (now - programme.start) / (programme.stop - programme.start);
}

/** "today", "yesterday", "Fri 5/9" — the short form fits the guide timeline. */
export function shortDay(ms) {
  const diff = dayOffset(ms);
  if (diff === 0) return t('day.short.today');
  if (diff === 1) return t('day.short.tomorrow');
  if (diff === -1) return t('day.short.yesterday');
  return dayFmt.format(new Date(ms));
}

/**
 * History section heading: "Today", "Yesterday", "Monday", "12 Aug 2025".
 * A weekday name identifies a day only within the current week — after
 * that "Monday" could be eight days ago just as well as yesterday.
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

/** Days from today. Daylight saving makes days 23 and 25 hours long, so
 *  the difference is counted in calendar days rather than by division. */
function dayOffset(ms) {
  const a = new Date(ms); a.setHours(0, 0, 0, 0);
  const b = new Date(); b.setHours(0, 0, 0, 0);
  return Math.round((a.getTime() - b.getTime()) / 86400e3);
}

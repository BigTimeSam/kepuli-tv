// Which channels in a country's list are the world's channels rather than
// the country's own.
//
// A provider files every channel it carries in a country under that
// country: "FI: Stingray Djazz" is in "Finland - Musiikki" beside the same
// channel in Sweden, Norway and Denmark, and "FI: CNN" beside thirty other
// countries' CNN. That is true — the channel is sold there — but a viewer
// browsing Finland is looking for Yle, MTV and Nelonen, and the hundred
// global brands bury them. Nothing in the list says which is which, so it
// is read from the list as a whole: a channel whose name turns up in the
// lists of many countries is international.
//
// Three things keep the rule from overreaching. A country's national topic
// ("Finland - Kansalliset", "Sweden - Nationella") is its own channels by
// the provider's word, and so a name that collides with a foreign one —
// "FI: TV5" with TV5 Monde, "FI: Alpha" with the Greek Alpha — stays. So is
// the country's category with no topic at all, "United Kingdom" or "USA",
// where a provider puts the main channels: ITV, Channel 5 and Fox News are
// found in five countries each, but at home they are home. Event slots are
// left alone (EVENT below). And only a country's lists are thinned: under
// "Music" or "24-7 Channels" the global names are the point.
//
// What is still misread, and why the setting defaults to showing them: a
// Finnish feed of a global brand ("FI: Eurosport 1", with Finnish
// commentary) looks exactly like the brand. Hiding is the viewer's choice.

import { labelCodes, searchKey } from './name.js';

/** In this many groups (the country's own included), a name is international. */
export const INTERNATIONAL_MIN = 4;

// A country's first topic, in the provider's language: "Kansalliset",
// "Nationella", "Nasjonale", "Nationale", "Nacionais", "Generalistas",
// "Algemeen", "Öffentlich", "Publiczne".
const NATIONAL = /^(?:nation|nacion|nasjon|nazional|kansalli|valtakunn|general|algemeen|offentlich|public|riksdekk)/;

// "FI: ", "|SE| ", "EX-YU | ": the country tag a name starts with.
const TAG = /^\s*\|?\s*[\p{L}\p{N}]{2,6}(?:[-/][\p{L}\p{N}]{2,6})?\s*[:|]\s*/u;
// The picture's description, not the channel's name.
const QUALITY = /\b(?:uhd|fhd|hd|sd|4k|8k|hevc|h\.?26[45]|50fps|60fps|raw)\b/g;
// A slot for one broadcast: "[DisneyFI] (31/10) 18:45 Chelsea vs. ...",
// "FI: Viaplay Event 81". The same match is shown in many countries, each
// with its own commentary, so a shared title says nothing about the feed.
const EVENT = /\(\d{1,2}\/\d{1,2}\)\s*\d{1,2}[:.]\d{2}|\bevent\b/i;

/**
 * The channel a name stands for, whichever country's list it is in:
 * "FI: Stingray Djazz", "SE: Stingray Djazz" and "DK: Stingray Djazz HD"
 * are one key; "[Multi-Sub]" and "(F)" are the provider's notes.
 */
export function channelKey(name) {
  return searchKey(String(name || '').replace(TAG, ''))
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(QUALITY, ' ')
    .replace(/[^\p{L}\p{N}+]+/gu, ' ')
    .trim();
}

/** A topic that holds the country's own channels. */
export const isNationalTopic = (sub) => NATIONAL.test(searchKey(sub || ''));

/**
 * The ids of the channels that are international, out of a whole live
 * list and the groups its categories make (js/library.js buildGroups).
 */
export function internationalChannels(items, groups) {
  const groupOf = new Map();
  const country = new Set();
  const national = new Set();
  for (const group of groups) {
    const isCountry = labelCodes(group.name).length > 0;
    for (const cat of group.cats) {
      groupOf.set(cat.id, group.name);
      if (isCountry) country.add(cat.id);
      if (isCountry && (!cat.sub || isNationalTopic(cat.sub))) national.add(cat.id);
    }
  }

  const keys = new Map();
  const reach = new Map();   // key → the groups it is found in
  for (const item of items) {
    const key = EVENT.test(item.n || '') ? '' : channelKey(item.n);
    if (!key) continue;
    keys.set(item, key);
    let seen = reach.get(key);
    if (!seen) reach.set(key, seen = new Set());
    for (const id of item.cats || []) {
      const group = groupOf.get(id);
      if (group) seen.add(group);
    }
  }

  const out = new Set();
  for (const item of items) {
    const key = keys.get(item);
    if (!key || reach.get(key).size < INTERNATIONAL_MIN) continue;
    const cats = item.cats || [];
    if (!cats.some((id) => country.has(id)) || cats.some((id) => national.has(id))) continue;
    out.add(String(item.id));
  }
  return out;
}

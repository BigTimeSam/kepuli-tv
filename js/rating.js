// Ratings in the application use ten points. Zero means no rating.
const valid = (value, scale) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number <= scale ? number : 0;
};

/** Xtream's rating is out of ten; rating_5based is the fallback out of five. */
export function providerRating(info) {
  return valid(info?.rating, 10) || valid(info?.rating_5based, 5) * 2;
}

/** Read both current metadata and list entries cached before scale unification. */
export function ratingValue(info) {
  if (!info) return 0;
  // Old movie/series list entries stored rating_5based as `rating` without
  // a scale marker. Detail responses already used ten points. Never infer
  // the scale from the score: a genuine 4/10 must remain 4/10.
  const legacyList = info.ratingScale == null && (info.k === 1 || info.k === 2);
  const scale = info.ratingScale === 5 || legacyList ? 5 : 10;
  return valid(info.rating, scale) * (10 / scale);
}

export function ratingText(info) {
  const value = ratingValue(info);
  return value ? `★ ${value.toFixed(1)}` : '';
}

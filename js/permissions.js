// Valinnaiset host-oikeudet.
//
// Manifest ei pyydä asennuksessa pääsyä kaikkiin osoitteisiin, koska
// "lue ja muuta kaikkea dataa kaikilla sivustoilla" on Chrome Web Storen
// tarkistuksen suurin yksittäinen hylkäyssyy. Oikeus kysytään vasta kun
// käyttäjä itse osoittaa palvelimensa — silloin perustelu on ilmeinen.
//
// Oikeutta tarvitaan vain sinne, mihin laajennus tekee fetch/XHR-pyynnön:
// player_api.php, get.php sekä hls.js:n ja mpegts.js:n segmenttihaut.
// Natiivi <video src> ja <img> logot toimivat ilman.
//
// HUOM: chrome.permissions.request() vaatii käyttäjän eleen ja ele kuluu
// ensimmäiseen awaitiin. Kutsu requestAccess() suoraan click-käsittelijän
// alusta ennen mitään muuta awaitia. Jo myönnetylle originille kutsu
// palaa heti true:na näyttämättä dialogia, joten erillistä hasAccess()-
// tarkistusta ei saa tehdä ennen sitä.

/**
 * https://host:port/polku → "https://host/*", tai null jos ei verkko-osoite.
 *
 * Portti jätetään pois tarkoituksella: Chromen match pattern -syntaksissa
 * isäntänimi ei saa sisältää porttia, ja portillinen kuvio hylätään
 * virheellisenä. Portiton kuvio kattaa isännän kaikki portit.
 */
export function originPattern(url) {
  let u;
  try {
    u = new URL(String(url));
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  return `${u.protocol}//${u.hostname}/*`;
}

/**
 * Onko originiin jo myönnetty oikeus? Ei-verkko-osoitteille true, koska
 * niihin ei tarvita mitään. Käytä vain tilan näyttämiseen — älä ennen
 * requestAccessia (kuluttaa käyttäjän eleen).
 */
export async function hasAccess(url) {
  const pattern = originPattern(url);
  if (!pattern) return true;
  try {
    return await chrome.permissions.contains({ origins: [pattern] });
  } catch (err) {
    console.warn('[iptv] oikeuden tarkistus epäonnistui', pattern, err);
    return false;
  }
}

/** Pyytää oikeuden originiin. Kutsuttava suoraan käyttäjän eleestä. */
export async function requestAccess(url) {
  const pattern = originPattern(url);
  if (!pattern) return true;
  try {
    return await chrome.permissions.request({ origins: [pattern] });
  } catch (err) {
    console.warn('[iptv] oikeuspyyntö epäonnistui', pattern, err);
    return false;
  }
}

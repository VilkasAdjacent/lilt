// Published formant norms (copied from analysis/norms.json), shown only as context.

// Elvin, Williams & Escudero (2016) JASA 140(1):576-581, Table I: AusE monophthongs, [F1, F2, F3] Hz.
const ELVIN_2016 = {
  female: { heed: [454, 2580, 3022], hid: [469, 2529, 3008], head: [744, 2048, 2813], had: [972, 1768, 2581], hard: [916, 1422, 2829], hud: [879, 1522, 2877], hod: [742, 1272, 2980], hoard: [608, 1033, 3073], hood: [520, 1192, 2930], "who'd": [445, 2130, 2636], heard: [715, 1844, 2879] },
  male: { heed: [358, 2202, 2869], hid: [378, 2079, 2732], head: [575, 1820, 2642], had: [776, 1609, 2519], hard: [711, 1173, 2627], hud: [688, 1226, 2552], hod: [601, 994, 2564], hoard: [484, 798, 2635], hood: [413, 991, 2478], "who'd": [342, 1736, 2214], heard: [537, 1475, 2467] },
};

const geomean = (xs) => Math.exp(xs.reduce((s, x) => s + Math.log(x), 0) / xs.length);

/** Women's over men's formants, one factor per formant across all vowels (as analysis/targets.py). */
export const ELVIN_F_OVER_M = [0, 1, 2].map((i) =>
  geomean(Object.keys(ELVIN_2016.male).map((v) => ELVIN_2016.female[v][i] / ELVIN_2016.male[v][i])));

/** Hillenbrand & Clark (2009): the same ratio for American English. */
export const HILLENBRAND_F_OVER_M = [1.18, 1.17, 1.14];

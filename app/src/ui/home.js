// Home: one big "tiny session" button, warm copy, a rotating low-effort idea.

const $ = (id) => document.getElementById(id);

const LEDES = [
  'No pressure today. Even two minutes counts, and so does zero.',
  "Hi hi. Your voice doesn't have to be anywhere in particular today.",
  'Tiny and gentle is the whole plan. You are doing great by being here.',
  'Low-energy day? A two-minute hum counts as practice.',
];

const TIPS = [
  'Hum a little "mm-hmm?" like you\'re agreeing with a friend. Watch the line wiggle up.',
  'Say "hey!" across an imaginary room. Can the weight meter stay on the light side while loudness goes up?',
  'Try a sigh that starts high and floats down. Lighter and breathier is allowed!',
  'Count to five, getting a bit louder each number. Keep it "forward", like it\'s coming out of your smile, not your chest.',
  'Read one line of a menu out loud as if ordering. That\'s it. That\'s the whole exercise.',
  'Lip trills (brrrr) up and down are a lovely low-effort warm-up.',
  'Do a cartoon "ooh!" with a little pout, then a big "eee!" with a smile. Peek at F2 in the details.',
  'Call a pretend cat: "kitty kitty!" It\'s naturally light and bright. Very scientific.',
  'Want to stop? Stopping is a legit choice. Your voice will still be here tomorrow.',
];

let tipIdx = Math.floor(Math.random() * TIPS.length);

export function init({ startTiny }) {
  $('homeLede').textContent = LEDES[Math.floor(Math.random() * LEDES.length)];
  $('tipText').textContent = TIPS[tipIdx];
  $('tipNext').addEventListener('click', () => {
    tipIdx = (tipIdx + 1) % TIPS.length;
    $('tipText').textContent = TIPS[tipIdx];
  });
  $('tinyBtn').addEventListener('click', () => startTiny());
}

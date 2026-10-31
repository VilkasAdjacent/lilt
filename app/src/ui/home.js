// Home: one big "tiny session" button and warm copy. The exercise teaser card is filled by practice.js.

const $ = (id) => document.getElementById(id);

const LEDES = [
  'No pressure today. Even two minutes counts, and so does zero.',
  "Hi hi. Your voice doesn't have to be anywhere in particular today.",
  'Tiny and gentle is the whole plan. You are doing great by being here.',
  'Low-energy day? A two-minute hum counts as practice.',
];

export function init({ startTiny }) {
  $('homeLede').textContent = LEDES[Math.floor(Math.random() * LEDES.length)];
  $('tinyBtn').addEventListener('click', () => startTiny());
}

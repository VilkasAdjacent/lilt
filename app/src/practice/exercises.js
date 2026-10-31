// The exercise pool and the shuffle. Pure data, no order: any exercise can be
// done on its own on any day.
//
// watch: which readout the exercise is about ('pitch' | 'resonance' | 'loudlight' | null).
// score: per-attempt feedback (see practice/feedback.js), or absent for none.

export const KINDS = {
  warmup: 'Warm-up',
  resonance: 'Resonance',
  pitch: 'Pitch',
  loudlight: 'Loud & light',
  together: 'All together',
  cooldown: 'Cool-down',
};

const LOUD_CARE = 'Loud should feel roomy, not pushed. If it gets scratchy or tight, back off a notch or stop there.';

export const EXERCISES = [
  // ---------------------------------------------------------------- warm-up
  {
    id: 'straw-sirens', kind: 'warmup', title: 'Straw sirens', watch: 'pitch',
    blurb: 'Hum through a straw and slide up and down. The easiest warm-up there is.',
    steps: [
      'Hum through a straw. Any straw works, even a coffee stirrer.',
      'Slide slowly from low to high and back down, like a lazy siren.',
      'Keep it easy at the top. If it gets squeezy, turn around sooner.',
      'About 30 to 60 seconds is plenty.',
    ],
  },
  {
    id: 'lip-trills', kind: 'warmup', title: 'Lip trills', watch: 'pitch',
    blurb: 'A loose little motorboat "brrrr", gliding up and down.',
    steps: [
      'Loose lips, then blow a "brrrr" like a little motorboat.',
      'Glide it up and down a few times.',
      'Lips won\'t buzz? Press your cheeks in gently with your fingertips, or just hum instead.',
    ],
  },
  {
    id: 'buzzy-hum', kind: 'warmup', title: 'Buzzy hum', watch: null,
    blurb: 'Find the forward buzz that makes a voice easy and efficient.',
    steps: [
      'Hum "mmm" gently, lips together and teeth apart.',
      'Look for a little buzz on your lips and around your nose. That\'s forward, easy sound.',
      'Turn it into "mm-hmm?" a few times, keeping the buzz.',
    ],
  },
  {
    id: 'yawn-sigh', kind: 'warmup', title: 'Yawn-sigh', watch: null,
    blurb: 'Let a yawn turn into a sigh that floats down.',
    steps: [
      'Start a yawn and let it turn into a sigh that floats from high to low.',
      'Notice how open and unbothered your throat feels.',
      'Three or four of these, no rush.',
    ],
  },

  // -------------------------------------------------------------- resonance
  {
    id: 'two-sizes', kind: 'resonance', title: 'Same note, two sizes', watch: 'resonance', score: { kind: 'contrast' },
    blurb: 'Pitch and resonance are separate dials. This one helps you feel that.',
    steps: [
      'Pick a comfy pitch and say "yeah" in a big, dark, roomy way.',
      'Now the same "yeah" on the same pitch, but small and bright, coming from the front of your mouth.',
      'Swap back and forth. Pitch should barely move; F2 should.',
      'Finish on the small one.',
    ],
  },
  {
    id: 'bright-ee', kind: 'resonance', title: 'Bright "heed"', watch: 'resonance', score: { kind: 'contrast' },
    blurb: 'Nudge "heed" a little brighter without changing pitch.',
    steps: [
      'Say "heed" at your everyday pitch.',
      'Smile a little, let your tongue sit a touch further forward, and say it again.',
      'F2 creeping up a few percent is the goal. Pitch stays put.',
      'Alternate a few times so you can feel the difference.',
    ],
  },
  {
    id: 'less-pout', kind: 'resonance', title: 'Less pout on "oo"', watch: 'resonance', score: { kind: 'contrast' },
    blurb: 'Rounded lips make the space bigger. Round them a little less.',
    steps: [
      'Say "who\'d" the way you usually do.',
      'Say it again with your lips a bit less rounded, like a soft smile, tongue still forward.',
      'It should still sound like your "who\'d", just a little brighter.',
    ],
  },
  {
    id: 'puppy', kind: 'resonance', title: 'Puppy voice', watch: 'resonance',
    blurb: 'The "awww" you make at a puppy lifts your larynx a bit. Borrow it.',
    steps: [
      'Make a soft "awww" like you just saw a tiny puppy. Feel your throat lift a little.',
      'Keep that lifted, small feeling and say "hi" and "hello" at a normal pitch.',
      'Small, not squeezed. If it feels tight, let it settle a bit.',
    ],
  },

  // ------------------------------------------------------------------ pitch
  {
    id: 'ladder', kind: 'pitch', title: 'Semitone ladder', watch: 'pitch', score: { kind: 'step', st: [0.5, 1.75] },
    blurb: 'Climb in small steps, singing first and then speaking.',
    steps: [
      'Sing "one" at your usual speaking pitch.',
      'Sing "two" one small step higher, "three" another step, and so on, up to the bottom of your band.',
      'Now speak the same numbers on the same steps.',
      'Walk back down. Small steps are the whole trick.',
    ],
  },
  {
    id: 'bit-higher', kind: 'pitch', title: 'Just a bit higher', watch: 'pitch', score: { kind: 'step', st: [1.5, 3.5] },
    blurb: 'Finds out what "a bit higher" means to your voice today. Not a test.',
    steps: [
      'Say "how are you going?" at your normal pitch.',
      'Say it again "a bit higher", about two piano keys up.',
      'See how big the step was. Bigger or smaller than you meant is useful to know.',
      'Try again and adjust. Then try stepping down.',
    ],
  },
  {
    id: 'sing-then-say', kind: 'pitch', title: 'Sing it, then say it', watch: 'pitch', score: { kind: 'band' },
    blurb: 'Hum a note in your band, then talk on it.',
    steps: [
      'Hum a comfortable note inside your band.',
      'Without stopping, turn the hum into "mm-hmm, yeah, okay".',
      'Then a short phrase on the same note: "sounds good to me".',
      'Speech wobbles around the note. That\'s intonation, not a miss.',
    ],
  },
  {
    id: 'steer-average', kind: 'pitch', title: 'Steer the average', watch: 'pitch', score: { kind: 'shape' },
    blurb: 'Talk freely and nudge the dashed line into your band. Dips are allowed.',
    steps: [
      'Talk about anything for 30 seconds: lunch, the weather, a show.',
      'Watch the dashed 10 s average, not the wiggly line.',
      'Nudge the average into the band. Dipping below it mid-sentence is just intonation.',
    ],
  },
  {
    id: 'keep-ends-up', kind: 'pitch', title: 'Carry the last word', watch: 'pitch', score: { kind: 'ending' },
    blurb: 'Keep your voice going through the last syllable instead of letting it crackle down.',
    steps: [
      'Say "that sounds really good".',
      'Keep the air going through "good" so it stays smooth and level, or lifts a little.',
      'A few more: "see you later", "thanks so much", "no worries".',
    ],
  },

  // ----------------------------------------------------------- loud & light
  {
    id: 'straw-louder', kind: 'loudlight', title: 'Straw, getting louder', watch: 'loudlight', score: { kind: 'loudlight' },
    blurb: 'Build loudness from breath, then take the straw away and keep the feeling.',
    steps: [
      'Hum through a straw and let it slowly get louder, from breath rather than throat.',
      'Take the straw away and say "mm-hmm!" with the same easy feeling.',
      'Then "hey!", a little louder. Weight staying on the light side is the win.',
    ],
    care: LOUD_CARE,
  },
  {
    id: 'nyeh', kind: 'loudlight', title: 'Bratty "nyeh"', watch: 'loudlight', score: { kind: 'loudlight' },
    blurb: 'Twang makes a voice carry without pushing. Be a cheeky little sibling.',
    steps: [
      'Say "nyeh nyeh nyeh" like a cheeky kid: small, bright, a bit nasal.',
      'Notice it gets loud without much effort.',
      'Keep a little of that brightness and say "hey!" and "excuse me!"',
    ],
    care: 'Twang should feel easy. If it tightens or tickles, let it go.',
  },
  {
    id: 'across-room', kind: 'loudlight', title: 'Across the room', watch: 'loudlight', score: { kind: 'loudlight' },
    blurb: 'Call "hey!" to someone close, then further away, staying light.',
    steps: [
      'Say "hey!" to someone right next to you.',
      'Then to someone across the room, then across a big hall.',
      'Get louder with breath and space, as if the sound comes out of your smile.',
    ],
    care: LOUD_CARE,
  },

  // ----------------------------------------------------------- all together
  {
    id: 'bright-and-up', kind: 'together', title: 'Bright and up', watch: 'pitch', score: { kind: 'band' },
    blurb: 'Pitch and brightness together, on little everyday phrases.',
    steps: [
      'Hum a note in your band and find the small, bright "heed" feeling.',
      'Say "mm-hmm", "yeah, totally", "oh, thank you!"',
      'Short phrases only. Wobbly is fine.',
    ],
  },
  {
    id: 'cafe-order', kind: 'together', title: 'The café order', watch: 'pitch', score: { kind: 'band' },
    blurb: 'Your usual order: bright, a bit up, a bit louder than feels necessary.',
    steps: [
      'Pick your usual order. "Hi, can I get a flat white, please?" works.',
      'Say it bright, a bit up, and a touch louder than feels necessary.',
      'Add a name for the cup, and spell it.',
    ],
  },
  {
    id: 'over-noise', kind: 'together', title: 'Order over the noise', watch: 'loudlight', score: { kind: 'loudlight' },
    blurb: 'Café noise on another device, and your order over the top of it.',
    steps: [
      'Play café or crowd noise on another device or speaker, not too loud to start.',
      'Order your coffee over it: bright, up, loud but light.',
      'Turn the noise up a little and try again.',
    ],
    care: 'Noise makes everyone push. Noticing that is the exercise. Stop before anything feels strained.',
  },
  {
    id: 'kitty', kind: 'together', title: 'Call the cat', watch: 'pitch', score: { kind: 'band' },
    blurb: 'Calling a cat is naturally light, bright and up. Very scientific.',
    steps: [
      'Call a pretend cat: "kitty kitty! Here, puss puss!"',
      'Notice how that feels: light, bright, a bit up.',
      'Keep the feeling and say "hi, how are you?"',
    ],
  },
  {
    id: 'read-nearby', kind: 'together', title: 'Read whatever\'s nearby', watch: null,
    blurb: 'A menu, a cereal box, a text. A few lines in your practice voice.',
    steps: [
      'Grab anything with words on it.',
      'Read a few lines in your practice voice.',
      'No checking the screen. Just reading.',
    ],
  },
  {
    id: 'tell-a-friend', kind: 'together', title: 'Tell a friend about your day', watch: null, score: { kind: 'shape' },
    blurb: 'Thirty seconds of chat to an imaginary friend, eyes off the screen.',
    steps: [
      'Pretend a friend just asked how your day was. Tell them, for about 30 seconds.',
      'Eyes off the screen while you talk.',
      'Afterwards, peek at the 10 s average if you like. Whatever it says is fine.',
    ],
  },

  // -------------------------------------------------------------- cool-down
  {
    id: 'hum-down', kind: 'cooldown', title: 'Hum yourself down', watch: null,
    blurb: 'A gentle slide down, a sigh, some water.',
    steps: [
      'Hum gently, sliding from your band down to your comfy low.',
      'A couple of soft sighs.',
      'Sip some water. Done is done.',
    ],
  },
  {
    id: 'glide-check', kind: 'cooldown', title: 'Soft glide check', watch: 'pitch',
    blurb: 'A quiet "ooo" from low to high, to see how your voice is doing.',
    steps: [
      'Glide softly from low to high on a quiet "ooo".',
      'If the top comes easily, lovely.',
      'If the top is missing, crackly or scratchy, your voice is asking for rest. Rest counts too.',
    ],
  },
];

export const parseKind = (kind) => (kind in KINDS ? kind : 'any');

/**
 * A random exercise of the given kind ('any' for all), avoiding the ones in
 * `recent` (oldest first) where the pool allows, and never the latest one twice in a row.
 */
export function pickExercise({ kind = 'any', recent = [], random = Math.random } = {}) {
  const pool = EXERCISES.filter((e) => kind === 'any' || e.kind === kind);
  const latest = recent[recent.length - 1];
  const from = [pool.filter((e) => !recent.includes(e.id)), pool.filter((e) => e.id !== latest), pool].find((p) => p.length);
  return from[Math.floor(random() * from.length)];
}

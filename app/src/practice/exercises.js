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

  {
    id: 'straw-tune', kind: 'warmup', title: 'Straw tune', watch: 'pitch',
    blurb: 'Hum a little tune through a straw. Warm-up and pitch practice in one.',
    steps: [
      'Hum any simple tune through a straw: "Happy Birthday" or a nursery rhyme.',
      'Keep it soft and easy, with your cheeks relaxed.',
      'Once through is enough. Twice if it was fun.',
    ],
  },
  {
    id: 'vvv-slide', kind: 'warmup', title: '"Vvv" slides', watch: 'pitch',
    blurb: 'No straw handy? A buzzy "vvv" does a similar job.',
    steps: [
      'Rest your top teeth lightly on your bottom lip and make a buzzy "vvv".',
      'Slide it up and down like a siren, keeping the buzz going.',
      'Feel the tickle on your lip. That buzz means your voice is working easily.',
    ],
  },
  {
    id: 'loosen-up', kind: 'warmup', title: 'Shoulders, jaw, tongue', watch: null,
    blurb: 'Thirty seconds of letting go before you make a sound.',
    steps: [
      'Roll your shoulders back a few times and let them drop.',
      'Let your jaw hang loose and gently wobble it side to side.',
      'Stick your tongue out, then let it rest behind your bottom teeth.',
      'A slow breath in through your nose, and a sigh out.',
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

  {
    id: 'smile-or-small', kind: 'resonance', title: 'Smile-y or small mouth', watch: 'resonance', score: { kind: 'contrast' },
    blurb: 'Two ways to make the space smaller. See which one suits your voice.',
    steps: [
      'Say "hey" at your everyday pitch.',
      'Now a smile-y "hey": lips spread a little, as if you\'re pleased to see someone.',
      'Now a small-mouth "hey": as if the space inside your mouth shrank a bit.',
      'Go back and forth between your everyday one and whichever felt easier. Pitch stays put.',
    ],
  },
  {
    id: 'whisper-siren', kind: 'resonance', title: 'Whisper siren', watch: null,
    blurb: 'A whispered "ee" siren lets you hear your throat and tongue lift, with no pitch involved.',
    steps: [
      'Whisper "eee" and slide it up like a siren. The whisper sounds higher as your throat lifts.',
      'Stop near the top and notice the small, lifted feeling.',
      'Keep that feeling and say "eat" out loud at your normal pitch.',
      'Only a few seconds of whispering at a time. It\'s for noticing, not for long stretches.',
    ],
  },
  {
    id: 'bright-hum', kind: 'resonance', title: 'Bright hum', watch: 'resonance',
    blurb: 'Hum "ng" with a small, bright feeling, then open it into words.',
    steps: [
      'Hum "ng", like the end of "sing", with the back of your tongue up.',
      'Make it feel small and bright, as if the sound sits just behind your nose.',
      'Open it into "ngee", then "ngyeah", keeping the same bright place.',
      'Then plain "yeah" and "easy", still bright.',
    ],
  },
  {
    id: 'vowel-word-phrase', kind: 'resonance', title: 'Vowel, word, phrase', watch: 'resonance',
    blurb: 'Carry a bright vowel into a word, then into a sentence.',
    steps: [
      'Say a bright, slightly smiley "ee".',
      'Keep the same brightness and say "eat", then "easy".',
      'Then the whole thing: "it\'s easy".',
      'If the brightness drops off in the sentence, go back one step and try again.',
    ],
  },
  {
    id: 'oo-in-words', kind: 'resonance', title: 'Less pout, in words', watch: 'resonance',
    blurb: 'Take the softer "oo" into everyday words.',
    steps: [
      'Say "who\'d" with your lips only a little rounded, tongue forward.',
      'Keep that and say "soon", "too", "do you?"',
      'Then a phrase: "who\'s coming too?"',
      'It should still sound like your own "oo", just a touch brighter.',
    ],
  },
  {
    id: 'bright-pairs', kind: 'resonance', title: 'Bright pairs', watch: 'resonance', score: { kind: 'contrast' },
    blurb: 'Everyday words twice each: as usual, then a bit brighter.',
    steps: [
      'Say "day" your usual way, then a bit smaller and brighter on the same pitch.',
      'Do the same with "no", then "hi", then "see".',
      'Two of each, same note. F2 should move, pitch shouldn\'t.',
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

  {
    id: 'tiny-steps', kind: 'pitch', title: 'Yes, yes, yes', watch: 'pitch', score: { kind: 'step', st: [0.5, 1.75] },
    blurb: 'A spoken ladder: each "yes" one tiny step higher than the last.',
    steps: [
      'Say "yes" at your normal pitch.',
      'Say it again, just a tiny step higher. Then another tiny step.',
      'Five or so steps up, then walk back down the same way.',
      'Tiny is the point. If one jumps, make the next one smaller.',
    ],
  },
  {
    id: 'halfway-hi', kind: 'pitch', title: 'Halfway "hi"', watch: 'pitch', score: { kind: 'step', st: [3.5, 7.5] },
    blurb: 'Between your everyday "hi" and a squeaky one there\'s a middle. Let\'s find it.',
    steps: [
      'Say "hi" at your everyday pitch.',
      'Now a very high, cheery "hi!", just to hear where the top is.',
      'Now a "hi" about halfway between the two.',
      'Alternate your everyday "hi" and the halfway one. The step should feel like a comfy middle size.',
    ],
  },
  {
    id: 'glide-into-words', kind: 'pitch', title: 'Glide into words', watch: 'pitch', score: { kind: 'band' },
    blurb: 'Slide up into your band on an "mmm", land there, and start talking.',
    steps: [
      'Hum "mmm" low and slide up until you reach a comfy note in your band.',
      'Land on it and say "hi, how\'s it going?" right there.',
      'Do it again, with a shorter slide each time.',
      'Last time, skip the slide and just start on the note.',
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

  {
    id: 'straw-to-ah', kind: 'loudlight', title: 'Straw to "ah"', watch: 'loudlight', score: { kind: 'loudlight' },
    blurb: 'Keep the easy straw feeling as your mouth opens up.',
    steps: [
      'Hum through a straw for a few seconds.',
      'Take it away and say "woo", lips still nearly as small as the straw.',
      'Open up gradually: "woo", "wah", "ah", a little louder each time.',
      'Back to the straw if "ah" starts to feel pushed.',
    ],
    care: LOUD_CARE,
  },
  {
    id: 'forward-mm-hmm', kind: 'loudlight', title: 'Forward "mm-hmm"', watch: 'loudlight', score: { kind: 'loudlight' },
    blurb: 'An agreeable "mm-hmm" that gets louder while the buzz stays on your lips.',
    steps: [
      'Say "mm-hmm" as if you\'re agreeing with a friend. Feel the buzz on your lips.',
      'Say it a little louder, keeping the buzz up front.',
      'Then louder again, as if they\'re across the table in a busy café.',
      'Then "mm-hmm, yeah!" at that level.',
    ],
    care: LOUD_CARE,
  },
  {
    id: 'count-up', kind: 'loudlight', title: 'Count it up', watch: 'loudlight', score: { kind: 'loudlight' },
    blurb: 'Count to five, a little louder on each number, and stop at the first push.',
    steps: [
      'Say "one" at a chatty level.',
      'Each number a bit louder, from breath and a bright, open mouth.',
      'The first number that feels pushy is today\'s ceiling. Go back one and repeat it.',
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

  {
    id: 'hellos-goodbyes', kind: 'together', title: 'Hellos and goodbyes', watch: 'pitch', score: { kind: 'band' },
    blurb: 'The little phrases you say most days, bright and a bit up.',
    steps: [
      'Hum a note in your band.',
      'Then: "hi!", "morning!", "how are you?"',
      'Then: "thanks, see you!", "bye, have a good one!"',
      'Short and friendly. Whatever comes out is fine.',
    ],
  },
  {
    id: 'phone-call', kind: 'together', title: 'Pretend phone call', watch: 'pitch', score: { kind: 'band' },
    blurb: 'On the phone your voice does all the work. Practise the opening lines.',
    steps: [
      'Hold your phone up like you\'re on a call.',
      'Say an opener: "Hi, I\'m calling to make a booking, please."',
      'Then a couple of replies: "Yes, that works", "Great, thanks so much".',
      'Bright, a bit up, and unhurried.',
    ],
  },
  {
    id: 'three-phrases', kind: 'together', title: 'Three phrases for today', watch: 'pitch', score: { kind: 'band' },
    blurb: 'Pick three things you\'ll actually say today and give them a run-through.',
    steps: [
      'Think of three things you might say today, like "can I tap my card?" or "thanks, you too".',
      'Say each one twice in your practice voice.',
      'If one comes up for real later, try it. If not, that\'s fine too.',
    ],
  },
  {
    id: 'counter-chat', kind: 'together', title: 'At the counter', watch: 'loudlight', score: { kind: 'loudlight' },
    blurb: 'Little shop phrases, a bit louder, as if there\'s music playing.',
    steps: [
      'Imagine a shop with music on.',
      'Say "Hi! Just these, thanks", "No bag, thanks", "Have a good one!"',
      'Bright and up, louder from breath, not from your throat.',
    ],
    care: LOUD_CARE,
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
  {
    id: 'falling-sighs', kind: 'cooldown', title: 'Falling sighs', watch: null,
    blurb: 'Soft "haa" sighs that float down, each one quieter than the last.',
    steps: [
      'Breathe in through your nose.',
      'Sigh out a soft "haa" from a comfy middle note down to low.',
      'Each sigh a little quieter and slower. Four or five is plenty.',
    ],
  },
  {
    id: 'straw-wind-down', kind: 'cooldown', title: 'Straw wind-down', watch: 'pitch',
    blurb: 'Straw slides that get smaller and lower until they stop.',
    steps: [
      'Hum through a straw with a few slow slides.',
      'Make each slide a little smaller and a little lower.',
      'Finish on a quiet, low hum, then say "okay" in your comfy everyday voice.',
    ],
  },
  {
    id: 'trill-down', kind: 'cooldown', title: 'Trill back down', watch: null,
    blurb: 'Lip trills that drift from your band down to your comfy low.',
    steps: [
      'A loose "brrrr" lip trill, starting around your practice pitch.',
      'Let it drift down slowly, like a sigh.',
      'Three or four, then a sip of water. Nice work.',
    ],
  },
];

export const parseKind = (kind) => (kind in KINDS ? kind : 'any');

/**
 * A random item of `pool` (each with an `id`), avoiding the ids in `recent`
 * (oldest first) where the pool allows, and never the latest one twice in a row.
 */
export function pickAvoiding(pool, { recent = [], random = Math.random } = {}) {
  const latest = recent[recent.length - 1];
  const from = [pool.filter((e) => !recent.includes(e.id)), pool.filter((e) => e.id !== latest), pool].find((p) => p.length);
  return from[Math.floor(random() * from.length)];
}

/** A random exercise of the given kind ('any' for all), as pickAvoiding chooses. */
export const pickExercise = ({ kind = 'any', ...opts } = {}) =>
  pickAvoiding(EXERCISES.filter((e) => kind === 'any' || e.kind === kind), opts);

// Short, kind tips: voice care, noisy places, everyday use, going easy, support.
// Pure data plus a picker that avoids recent repeats.

import { pickAvoiding } from './exercises.js';

export const TIP_TOPICS = {
  care: 'Voice care',
  noise: 'Noisy places',
  everyday: 'Everyday voice',
  easy: 'Going easy',
  support: 'Support',
};

export const TIPS = [
  // ------------------------------------------------------------- voice care
  { id: 'stop-signs', topic: 'care', text: 'Stop for today if you notice pain, burning, scratchiness, needing more effort than usual, or losing your top notes. Those are signs your voice wants a rest, not a push.' },
  { id: 'water', topic: 'care', text: 'Sip water through the day. Talking a lot, dry air and breathing through your mouth all dry your voice out.' },
  { id: 'nose-breathing', topic: 'care', text: 'Breathe in through your nose between sentences when you can. It keeps your throat less dry than mouth breathing.' },
  { id: 'morning-after', topic: 'care', text: 'Hoarse the morning after a big day of talking? Have a quieter day. A soft high glide is a nice check: when the top comes back easily, you\'re recovered.' },
  { id: 'two-weeks', topic: 'care', text: 'Hoarse for more than about two weeks, or any pain that hangs around? See a GP and ask about an ENT check. It\'s quick, and it\'s good to know.' },
  { id: 'sick-days', topic: 'care', text: 'Skip practice when you\'re sick or your throat is sore. Rest is part of the plan.' },
  { id: 'throat-clearing', topic: 'care', text: 'Try not to clear your throat over and over. A sip of water, a swallow or a gentle hum usually does the job more kindly.' },
  { id: 'no-squeeze', topic: 'care', text: 'Higher pitch should feel easy. If it feels squeezed or tight, come down a little and let brightness do more of the work.' },
  { id: 'short-often', topic: 'care', text: 'Short and often is kinder to your voice than long and heroic. Two to ten minutes is a whole session.' },
  { id: 'warm-up-first', topic: 'care', text: 'A minute of straw humming or lip trills before you practise, or before a big night out, helps your voice get going with less effort.' },

  // ---------------------------------------------------------- noisy places
  { id: 'stand-closer', topic: 'noise', text: 'Move closer and face the person you\'re talking to. It helps them hear you more than turning your voice up does.' },
  { id: 'light-not-loud', topic: 'noise', text: 'In noise, aim for bright and clear rather than big and loud. A forward buzz and a bit of twang carry well for less effort.' },
  { id: 'everyone-gets-louder', topic: 'noise', text: 'Everyone gets louder in noise without noticing. Just catching yourself doing it is half the skill.' },
  { id: 'water-between', topic: 'noise', text: 'Alternate drinks with water. Alcohol and warm, crowded rooms both tend to dry your throat.' },
  { id: 'quiet-breaks', topic: 'noise', text: 'Take quiet breaks: step outside, or find a calmer corner for a few minutes. Your voice gets a breather too.' },
  { id: 'top-notes-signal', topic: 'noise', text: 'If your top notes start to disappear during a night out, your voice is tired. A good moment to talk less, or head home.' },
  { id: 'listening-counts', topic: 'noise', text: 'You don\'t have to do all the talking. Listening, nodding and laughing count as being part of it.' },

  // --------------------------------------------------------- everyday voice
  { id: 'low-stakes', topic: 'everyday', text: 'Try your practice voice on low-stakes phrases first: thanking a bus driver, a quick "hi" to a neighbour, talking to a pet.' },
  { id: 'phone-calls', topic: 'everyday', text: 'Phone calls are handy practice: short, fairly predictable, and nobody\'s looking at you. Have your first line ready before you dial.' },
  { id: 'one-phrase', topic: 'everyday', text: 'Pick one phrase a day to say in your practice voice. One is plenty.' },
  { id: 'brightness-and-pitch', topic: 'everyday', text: 'Pitch and brightness work best together. If you only have energy for one thought, think "small and bright", not just "higher".' },
  { id: 'slipping-back', topic: 'everyday', text: 'Your voice will slip back sometimes, especially when you\'re tired, excited or in a hurry. That\'s normal, and it isn\'t failing.' },
  { id: 'narrate', topic: 'everyday', text: 'Talking to yourself while you cook or tidy counts as practice, and nobody\'s listening.' },

  // -------------------------------------------------------------- going easy
  { id: 'two-minutes', topic: 'easy', text: 'Two minutes counts. So does a hum in the shower.' },
  { id: 'no-streaks', topic: 'easy', text: 'Lilt doesn\'t count streaks. A day or a week off is fine. Picking it back up is all it takes.' },
  { id: 'off-days', topic: 'easy', text: 'Some days your voice just won\'t cooperate. That\'s voices, not you.' },
  { id: 'visuals-only', topic: 'easy', text: 'You never have to listen back. Settings → Hearing myself → Visuals only hides every player, and the lines and numbers still work.' },
  { id: 'compare-yourself', topic: 'easy', text: 'Compare yourself with yourself a few weeks ago, not with anyone else.' },
  { id: 'gradual', topic: 'easy', text: 'Voice change is gradual, over weeks and months. Little bits of practice add up.' },
  { id: 'stop-when-heavy', topic: 'easy', text: 'If practice starts to feel heavy, it\'s fine to stop. Coming back another day beats pushing through today.' },

  // ----------------------------------------------------------------- support
  { id: 'speech-pathologist', topic: 'support', text: 'A speech pathologist who works with gender-affirming voice can tailor all of this to you, and keep an eye on your voice\'s health. Well worth it if you can get to one.' },
  { id: 'feelings', topic: 'support', text: 'Voice work can stir up feelings. That\'s common, and it\'s okay to step away, or to talk it through with someone who gets it.' },
];

export const pickTip = (opts) => pickAvoiding(TIPS, opts);

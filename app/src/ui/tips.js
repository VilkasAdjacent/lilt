// Tips: a rotating one on Home, and the full list by topic in About.

import { TIP_TOPICS, TIPS, pickTip } from '../practice/tips.js';

const $ = (id) => document.getElementById(id);
function el(tag, props, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

const RECENT_MAX = 12;
let recent = [];

function nextTip() {
  const tip = pickTip({ recent });
  recent = [...recent, tip.id].slice(-RECENT_MAX);
  $('homeTipTopic').textContent = TIP_TOPICS[tip.topic];
  $('homeTipText').textContent = tip.text;
}

function renderList() {
  $('tipList').replaceChildren(...Object.entries(TIP_TOPICS).map(([topic, label]) => el('details', { className: 'resonance' }, [
    el('summary', {}, [el('h3', { textContent: label })]),
    el('ul', {}, TIPS.filter((t) => t.topic === topic).map((t) => el('li', { textContent: t.text }))),
  ])));
}

export function init() {
  $('homeTipNext').addEventListener('click', nextTip);
  nextTip();
  renderList();
}

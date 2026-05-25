export interface ExampleRecipe {
  summary: string
  files: Array<{ path: string; content: string }>
}

export function getExampleRecipe(prompt: string): ExampleRecipe | null {
  const normalized = prompt.toLowerCase()
  if (normalized.includes('calculator')) return retroCalculatorRecipe()
  if (normalized.includes('coffee') && normalized.includes('landing')) return coffeeLandingRecipe()
  return null
}

function retroCalculatorRecipe(): ExampleRecipe {
  return {
    summary: 'Built a working retro calculator with keyboard input and a live preview.',
    files: [
      {
        path: 'index.html',
        content: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Retro Calculator</title>
  <link rel="stylesheet" href="style.css">
  <script src="app.js" defer></script>
</head>
<body>
  <main class="shell" aria-labelledby="title">
    <p class="eyebrow">Pocket model CX-81</p>
    <h1 id="title">Retro Calculator</h1>
    <section class="calculator" aria-label="Calculator">
      <output id="display" class="display" aria-live="polite">0</output>
      <div class="keys">
        <button data-action="clear" class="key control">C</button>
        <button data-action="backspace" class="key control">DEL</button>
        <button data-value="/" class="key operator">/</button>
        <button data-value="*" class="key operator">x</button>
        <button data-value="7" class="key">7</button>
        <button data-value="8" class="key">8</button>
        <button data-value="9" class="key">9</button>
        <button data-value="-" class="key operator">-</button>
        <button data-value="4" class="key">4</button>
        <button data-value="5" class="key">5</button>
        <button data-value="6" class="key">6</button>
        <button data-value="+" class="key operator">+</button>
        <button data-value="1" class="key">1</button>
        <button data-value="2" class="key">2</button>
        <button data-value="3" class="key">3</button>
        <button data-action="equals" class="key equals">=</button>
        <button data-value="0" class="key zero">0</button>
        <button data-value="." class="key">.</button>
      </div>
    </section>
  </main>
</body>
</html>
`
      },
      {
        path: 'style.css',
        content: `* {
  box-sizing: border-box;
}

body {
  min-height: 100vh;
  margin: 0;
  display: grid;
  place-items: center;
  background: #191510;
  color: #f8edc8;
  font-family: "Courier New", monospace;
}

.shell {
  width: min(92vw, 380px);
  padding: 24px;
  border: 3px solid #f0b35b;
  background: #2b2318;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.38);
}

.eyebrow {
  margin: 0 0 6px;
  color: #9ad0c2;
  text-transform: uppercase;
  letter-spacing: 0;
  font-size: 0.8rem;
}

h1 {
  margin: 0 0 18px;
  font-size: 1.6rem;
}

.display {
  display: block;
  min-height: 72px;
  padding: 16px;
  margin-bottom: 16px;
  overflow-x: auto;
  border: 2px inset #6d5a35;
  background: #b7c89a;
  color: #18200f;
  font-size: 2rem;
  text-align: right;
}

.keys {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}

.key {
  min-height: 58px;
  border: 0;
  background: #f8edc8;
  color: #2b2318;
  font: inherit;
  font-size: 1.15rem;
  cursor: pointer;
}

.key:active {
  transform: translateY(1px);
}

.operator {
  background: #f0b35b;
}

.control {
  background: #ef786c;
}

.equals {
  grid-row: span 2;
  background: #7fc8a9;
}

.zero {
  grid-column: span 2;
}
`
      },
      {
        path: 'app.js',
        content: `const display = document.querySelector('#display');
let expression = '';

function render() {
  display.textContent = expression || '0';
}

function append(value) {
  if (value === '.' && /(^|[+\\-*/])\\d*\\.$/.test(expression)) return;
  if (/^[+\\-*/]$/.test(value) && /^[+\\-*/]$/.test(expression.at(-1) || '')) {
    expression = expression.slice(0, -1) + value;
  } else {
    expression += value;
  }
  render();
}

function calculate() {
  if (!expression || /[+\\-*/.]$/.test(expression)) return;
  try {
    const safe = expression.replace(/[^0-9+\\-*/.()]/g, '');
    const result = Function('"use strict"; return (' + safe + ')')();
    expression = Number.isFinite(result) ? String(Number(result.toFixed(8))) : 'Error';
  } catch {
    expression = 'Error';
  }
  render();
}

document.querySelector('.keys').addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.value) append(button.dataset.value);
  if (button.dataset.action === 'clear') expression = '';
  if (button.dataset.action === 'backspace') expression = expression.slice(0, -1);
  if (button.dataset.action === 'equals') calculate();
  render();
});

window.addEventListener('keydown', (event) => {
  if (/^[0-9+\\-*/.]$/.test(event.key)) append(event.key);
  if (event.key === 'Enter') calculate();
  if (event.key === 'Backspace') expression = expression.slice(0, -1);
  if (event.key === 'Escape') expression = '';
  render();
});
`
      }
    ]
  }
}

function coffeeLandingRecipe(): ExampleRecipe {
  return {
    summary: 'Built a polished coffee shop landing page with a working newsletter button.',
    files: [
      {
        path: 'index.html',
        content: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Harbor Roast</title>
  <link rel="stylesheet" href="style.css">
  <script src="app.js" defer></script>
</head>
<body>
  <main class="hero">
    <p class="eyebrow">Small-batch coffee bar</p>
    <h1>Harbor Roast</h1>
    <p class="lede">Morning espresso, slow-filter brews, and warm pastries from a quiet corner near the water.</p>
    <div class="actions">
      <a class="button" href="#menu">View Menu</a>
      <button id="notify" class="button secondary">Opening Alerts</button>
    </div>
  </main>
  <section id="menu" class="menu" aria-label="Featured drinks">
    <article><span>01</span><h2>Cardamom Latte</h2><p>House espresso, steamed milk, and a soft spice finish.</p></article>
    <article><span>02</span><h2>Cold Brew Tonic</h2><p>Bright, crisp, and poured over citrus ice.</p></article>
    <article><span>03</span><h2>Honey Cortado</h2><p>Short, balanced, and lightly sweet.</p></article>
  </section>
</body>
</html>
`
      },
      {
        path: 'style.css',
        content: `body {
  margin: 0;
  color: #f9f1df;
  background: #201811;
  font-family: Inter, ui-sans-serif, system-ui, sans-serif;
}

.hero {
  min-height: 72vh;
  display: grid;
  align-content: center;
  gap: 18px;
  padding: 9vw;
  background:
    linear-gradient(rgba(32, 24, 17, 0.34), rgba(32, 24, 17, 0.82)),
    url("https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=1600&q=80") center/cover;
}

.eyebrow {
  margin: 0;
  color: #f3c86a;
  text-transform: uppercase;
  letter-spacing: 0;
  font-weight: 700;
}

h1 {
  margin: 0;
  max-width: 760px;
  font-size: clamp(3rem, 10vw, 7rem);
  line-height: 0.94;
}

.lede {
  max-width: 620px;
  margin: 0;
  color: #f5dfb9;
  font-size: 1.2rem;
  line-height: 1.6;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.button {
  border: 1px solid #f3c86a;
  padding: 13px 18px;
  color: #201811;
  background: #f3c86a;
  text-decoration: none;
  font: inherit;
  cursor: pointer;
}

.secondary {
  color: #f9f1df;
  background: transparent;
}

.menu {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 1px;
  background: #54402d;
}

.menu article {
  padding: 32px;
  background: #2b2118;
}

.menu span {
  color: #f3c86a;
  font-weight: 700;
}
`
      },
      {
        path: 'app.js',
        content: `const notify = document.querySelector('#notify');

notify.addEventListener('click', () => {
  notify.textContent = 'Alerts On';
  notify.disabled = true;
});
`
      }
    ]
  }
}

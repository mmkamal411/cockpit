/* =========================================================================
   CRYSTAL — Personality Engine
   Self-contained <script>-ready module (IIFE, no imports). Inline this into
   crystal.html replacing the current <script> block.

   Expects in the DOM:
     #crystal        — the character root (absolutely positioned)
     #crystal-stage  — the toolbar stage she walks on
     #status         — status line element
     .expr layers    — stacked <img class="expr" id="expr-<name>"> inside
                       #crystal .bot ; one must carry .active initially
   Keeps: .eyelid blink overlays + #crystal.blinking mechanism,
          `transition: left ...` on #crystal (patrol walks set style.left),
          transform+opacity-only animations (all CSS).
   ========================================================================= */
(function () {
  'use strict';

  var crystal  = document.getElementById('crystal');
  var stage    = document.getElementById('crystal-stage');
  var statusEl = document.getElementById('status');

  /* ---- Every animation class the engine may ever toggle.
         clearAnims() removes ALL of these — including 'dancing' and
         'blinking', which the old version forgot (stuck-animation bug). */
  var ANIMS = [
    'walking', 'jumping', 'waving', 'tripping', 'spinning',
    'celebrating', 'peeking', 'sleeping', 'wiggling', 'tilting',
    'blushing', 'earwiggle', 'shying', 'thinking', 'bowing',
    'dizzying', 'excited', 'yawning', 'dancing', 'blinking',
    'rolling', 'hopping', 'twirling', 'bouncing', 'nuzzling',
    'sneezing', 'giggling', 'stretching', 'pouncing', 'cuddling',
    'zoomies', 'peeking-side', 'flopping', 'tiptoeing', 'boinging',
    'waddlerun', 'greeting'
  ];

  /* ---- Expression layers the coordinator wires as crossfading PNGs. */
  var EXPRESSIONS = ['happy', 'joyful', 'sleepy', 'curious', 'surprised', 'giggly', 'content'];

  function setStatus(t) { if (statusEl) statusEl.textContent = t; }

  function clearAnims() {
    for (var i = 0; i < ANIMS.length; i++) crystal.classList.remove(ANIMS[i]);
  }

  /* 'blinking' is a 0.4s cosmetic overlay — it should never block anyone. */
  function isBusy() {
    for (var i = 0; i < ANIMS.length; i++) {
      if (ANIMS[i] === 'blinking') continue;
      if (crystal.classList.contains(ANIMS[i])) return true;
    }
    return false;
  }

  /* Crossfade expression layers. Safe if a layer is missing (falls back to happy). */
  function setExpression(name) {
    if (EXPRESSIONS.indexOf(name) === -1) name = 'happy';
    var layers = crystal.querySelectorAll('.expr');
    for (var i = 0; i < layers.length; i++) layers[i].classList.remove('active');
    var target = crystal.querySelector('#expr-' + name) || crystal.querySelector('#expr-happy');
    if (target) target.classList.add('active');
    else if (typeof console !== 'undefined' && console.warn) console.warn('Crystal: no expression layer for "' + name + '" (or happy fallback)');
    crystal.dataset.expression = name;
  }

  /* Legacy alias — the old data-mood API did nothing visible on the PNG. */
  var LEGACY_MOOD_MAP = {
    happy: 'happy', joy: 'joyful', joyful: 'joyful', curious: 'curious',
    surprised: 'surprised', sleepy: 'sleepy', dizzy: 'surprised',
    giggly: 'giggly', content: 'content'
  };
  function setMood(m) { setExpression(LEGACY_MOOD_MAP[m] || 'happy'); }

  function busy(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* ==================== 19 motion functions (public, same signatures) ==================== */

  async function doWalk() {
    clearAnims();
    var maxX = Math.max(0, stage.offsetWidth - 70);
    var x = 20 + Math.random() * Math.max(0, maxX - 40);
    crystal.style.left = x + 'px';
    crystal.classList.add('walking');
    setExpression('happy'); setStatus('Crystal is wandering...');
    await busy(1300);
    crystal.classList.remove('walking');
  }
  async function doJump() {
    clearAnims(); crystal.classList.add('jumping');
    setExpression('joyful'); setStatus('Boing!');
    await busy(750); crystal.classList.remove('jumping'); setExpression('happy');
  }
  async function doWave() {
    clearAnims(); crystal.classList.add('waving');
    setExpression('happy'); setStatus('Crystal waves hello! 👋');
    await busy(1500); crystal.classList.remove('waving');
  }
  async function doTrip() {
    clearAnims(); crystal.classList.add('tripping');
    setExpression('surprised'); setStatus('Whoa—! *thud* ...she\'s okay!');
    await busy(1700); crystal.classList.remove('tripping');
    setExpression('happy'); setStatus('Shook it off. All good!');
  }
  async function doSpin() {
    clearAnims(); crystal.classList.add('spinning');
    setExpression('joyful'); setStatus('Wheee!');
    await busy(850); crystal.classList.remove('spinning'); setExpression('happy');
  }
  async function doCelebrate() {
    clearAnims(); crystal.classList.add('celebrating');
    setExpression('joyful'); setStatus('🎉 Task complete! Crystal celebrates!');
    await busy(2300); crystal.classList.remove('celebrating'); setExpression('happy');
  }
  async function doPeek() {
    clearAnims(); crystal.classList.add('peeking');
    setExpression('surprised'); setStatus('Peek-a-boo! 👀');
    await busy(2500); crystal.classList.remove('peeking'); setExpression('happy');
  }
  async function doSleep() {
    clearAnims(); crystal.classList.add('sleeping');
    setExpression('sleepy'); setStatus('Shhh... Crystal is napping 😴');
    await busy(8000); crystal.classList.remove('sleeping'); setExpression('happy'); setStatus('Crystal is exploring...');
  }
  async function doWiggle() {
    clearAnims(); crystal.classList.add('wiggling');
    setExpression('joyful'); setStatus('Happy wiggle dance! 💃');
    await busy(1000); crystal.classList.remove('wiggling'); setExpression('happy');
  }
  async function doTilt() {
    clearAnims(); crystal.classList.add('tilting');
    setExpression('curious'); setStatus('Hmm? What\'s that? 🤔');
    await busy(1900); crystal.classList.remove('tilting'); setExpression('happy');
  }
  async function doBlush() {
    clearAnims(); crystal.classList.add('blushing');
    setExpression('joyful'); setStatus('Aw, you\'re making her blush! ☺️');
    await busy(2500); crystal.classList.remove('blushing');
  }
  async function doEarWiggle() {
    clearAnims(); crystal.classList.add('earwiggle');
    setExpression('happy'); setStatus('Wiggle wiggle! 🐻');
    await busy(1100); crystal.classList.remove('earwiggle');
  }
  async function doShy() {
    clearAnims(); crystal.classList.add('shying');
    setExpression('curious'); setStatus('Oh... um... hi 🙈');
    await busy(2500); crystal.classList.remove('shying'); setExpression('happy');
  }
  async function doThink() {
    clearAnims(); crystal.classList.add('thinking');
    setExpression('curious'); setStatus('Let me think about that... 💭');
    await busy(2500); crystal.classList.remove('thinking'); setExpression('happy');
  }
  async function doBow() {
    clearAnims(); crystal.classList.add('bowing');
    setExpression('happy'); setStatus('Welcome aboard, pilot! 🙇');
    await busy(1700); crystal.classList.remove('bowing');
  }
  async function doDizzy() {
    clearAnims(); crystal.classList.add('dizzying');
    setExpression('surprised'); setStatus('Whoa... too many spins! 💫');
    await busy(1900); crystal.classList.remove('dizzying'); setExpression('happy');
  }
  async function doExcited() {
    clearAnims(); crystal.classList.add('excited');
    setExpression('joyful'); setStatus('Sync complete! She\'s thrilled! ⚡');
    await busy(1300); crystal.classList.remove('excited'); setExpression('happy');
  }
  async function doYawn() {
    clearAnims(); crystal.classList.add('yawning');
    setExpression('sleepy'); setStatus('Big streeetch... 🥱');
    await busy(3100); crystal.classList.remove('yawning'); setExpression('happy');
  }
  async function doDance() {
    clearAnims(); crystal.classList.add('dancing');
    setExpression('joyful'); setStatus('She\'s dancing with joy! 💃');
    await busy(2500); crystal.classList.remove('dancing'); setExpression('happy');
  }


  async function doRoll() {
    clearAnims(); crystal.classList.add('rolling');
    setExpression('joyful'); setStatus('Crystal does a happy barrel roll! 🌀');
    await busy(1500); crystal.classList.remove('rolling'); setExpression('happy');
  }
  async function doHop() {
    clearAnims(); crystal.classList.add('hopping');
    setExpression('happy'); setStatus('Crystal hops over like a little bunny! 🐰');
    await busy(1300); crystal.classList.remove('hopping'); setExpression('happy');
  }
  async function doTwirl() {
    clearAnims(); crystal.classList.add('twirling');
    setExpression('joyful'); setStatus('Crystal twirls gracefully around! ✨');
    await busy(2500); crystal.classList.remove('twirling'); setExpression('happy');
  }
  async function doBounce() {
    clearAnims(); crystal.classList.add('bouncing');
    setExpression('joyful'); setStatus('Crystal bounces like a pogo stick! ⬆️');
    await busy(1700); crystal.classList.remove('bouncing'); setExpression('happy');
  }
  async function doNuzzle() {
    clearAnims(); crystal.classList.add('nuzzling');
    setExpression('content'); setStatus('Crystal leans in for a sweet nuzzle! 💕');
    await busy(2100); crystal.classList.remove('nuzzling'); setExpression('happy');
  }
  async function doSneeze() {
    clearAnims(); crystal.classList.add('sneezing');
    setExpression('surprised'); setStatus('Achoo! Crystal sneezes and wiggles it off! 🤧');
    await busy(1900); crystal.classList.remove('sneezing'); setExpression('happy');
  }
  async function doGiggle() {
    clearAnims(); crystal.classList.add('giggling');
    setExpression('giggly'); setStatus('Hee hee! Crystal giggles! 😆');
    await busy(1300); crystal.classList.remove('giggling'); setExpression('happy');
  }
  async function doStretch() {
    clearAnims(); crystal.classList.add('stretching');
    setExpression('happy'); setStatus('Crystal stretches tall and proud! 🙆');
    await busy(2700); crystal.classList.remove('stretching'); setExpression('happy');
  }
  async function doPounce() {
    clearAnims(); crystal.classList.add('pouncing');
    setExpression('curious'); setStatus('Crystal crouches... and pounces! 🐾');
    await busy(1300); crystal.classList.remove('pouncing'); setExpression('happy');
  }
  async function doCuddle() {
    clearAnims(); crystal.classList.add('cuddling');
    setExpression('content'); setStatus('Crystal curls into a cozy little ball! 🧸');
    await busy(2900); crystal.classList.remove('cuddling'); setExpression('happy');
  }
  async function doZoomies() {
    clearAnims(); crystal.classList.add('zoomies');
    setExpression('joyful'); setStatus('Zoomies! Crystal can\'t contain herself! ⚡');
    await busy(1200); crystal.classList.remove('zoomies'); setExpression('happy');
  }
  async function doPeekSide() {
    clearAnims(); crystal.classList.add('peeking-side');
    setExpression('curious'); setStatus('Crystal peeks around the corner... 🔍');
    await busy(2100); crystal.classList.remove('peeking-side'); setExpression('happy');
  }
  async function doFlop() {
    clearAnims(); crystal.classList.add('flopping');
    setExpression('joyful'); setStatus('Crystal flops over — too happy to stand! 😄');
    await busy(2100); crystal.classList.remove('flopping'); setExpression('happy');
  }
  async function doTiptoe() {
    clearAnims(); crystal.classList.add('tiptoeing');
    setExpression('curious'); setStatus('Crystal tiptoes in, very sneaky... 🤫');
    await busy(2300); crystal.classList.remove('tiptoeing'); setExpression('happy');
  }
  async function doBoing() {
    clearAnims(); crystal.classList.add('boinging');
    setExpression('joyful'); setStatus('Boing! Springy Crystal! 🌀');
    await busy(1200); crystal.classList.remove('boinging'); setExpression('happy');
  }
  async function doWaddleRun() {
    clearAnims(); crystal.classList.add('waddlerun');
    setExpression('happy'); setStatus('Crystal waddle-runs as fast as she can! 🏃');
    await busy(1300); crystal.classList.remove('waddlerun'); setExpression('happy');
  }
  async function doGreet() {
    clearAnims(); crystal.classList.add('greeting');
    setExpression('joyful'); setStatus('Hello! Crystal is so happy to see you! 👋');
    await busy(1900); crystal.classList.remove('greeting'); setExpression('happy');
  }

  /* ==================== Contextual reactions (app calls these) ==================== */

  async function cheerUp(reason) {
    markActive();
    switch (reason) {
      case 'task-complete':
        await doCelebrate();
        setExpression('joyful'); setStatus('🎉 Task complete! Crystal celebrates!');
        break;
      case 'sync-complete':
        await doExcited();
        setExpression('giggly'); setStatus('⚡ Sync complete! Crystal is thrilled!');
        break;
      case 'morning':
        clearAnims(); setExpression('happy'); setStatus('Good morning! ☀️');
        crystal.classList.add('bowing'); await busy(1700); crystal.classList.remove('bowing');
        crystal.classList.add('waving'); await busy(1500); crystal.classList.remove('waving');
        break;
      case 'user-back':
        await doDance();
        setExpression('joyful'); setStatus('Welcome back! She missed you! 💃');
        break;
      case 'surprise':
        await doWiggle();
        setExpression('surprised'); setStatus('Oh! What a nice surprise! 🎁');
        break;
      default:
        await doWiggle();
        setExpression('happy'); setStatus('Crystal is cheering you on! 💛');
    }
  }

  function crystalMood(name) {
    markActive();
    setExpression(name);
    setStatus('Crystal is feeling ' + name + '...');
  }

  /* ==================== Toolbar patrol ==================== */

  var patrolOn = false;
  var patrolWalking = false;

  function startPatrol() {
    if (patrolOn) return;
    patrolOn = true;
    setStatus('Crystal is patrolling the toolbar!');
    patrolStep();
  }

  function stopPatrol() {
    patrolOn = false;
    patrolWalking = false;
    crystal.classList.remove('walking');
    setExpression('happy');
    setStatus('Patrol over — Crystal is exploring...');
  }

  /* One pause-reaction at a waypoint: tilt, giggle, wave, or look-around. */
  async function patrolReaction() {
    var pick = Math.floor(Math.random() * 4);
    if (pick === 0) {
      await doTilt();
    } else if (pick === 1) {
      clearAnims(); crystal.classList.add('wiggling');
      setExpression('giggly'); setStatus('Hee hee! That tickles!');
      await busy(1000); crystal.classList.remove('wiggling'); setExpression('happy');
    } else if (pick === 2) {
      await doWave();
    } else {
      clearAnims(); crystal.classList.add('tilting');
      setExpression('curious'); setStatus('She looks around curiously...');
      await busy(1900); crystal.classList.remove('tilting'); setExpression('happy');
    }
  }

  /* Walks the FULL toolbar width: random waypoints, pause 1.5–4s at each.
     Defers automatically while any doX() motion, user click, or idle-nap is active. */
  async function patrolStep() {
    if (!patrolOn) return;
    if (asleepIdle || (isBusy() && !patrolWalking)) {
      setTimeout(patrolStep, 1500);   // a motion or the user has the floor — try again soon
      return;
    }
    var maxX = Math.max(0, stage.offsetWidth - 88);
    var x = 4 + Math.random() * Math.max(0, maxX - 8);
    patrolWalking = true;
    crystal.classList.add('walking');
    setExpression('happy'); setStatus('Crystal is patrolling the toolbar...');
    crystal.style.left = x + 'px';
    await busy(1500);                  // matches the CSS left-transition
    patrolWalking = false;
    crystal.classList.remove('walking');
    if (!patrolOn) return;
    if (Math.random() < 0.3) await patrolReaction();
    else await busy(1500 + Math.random() * 2500);
    patrolStep();
  }

  /* ==================== Long-idle detection (60s) ==================== */

  var lastActivity = Date.now();
  var asleepIdle = false;
  var lastMoveLog = 0;

  function markActive() {
    lastActivity = Date.now();
    if (asleepIdle) wakeUp();
  }

  function wakeUp() {
    asleepIdle = false;
    clearAnims();
    setExpression('happy');
    setStatus('Stretch... oh, you\'re back! 👋');
    doYawn();                          // big morning-style stretch
  }

  window.addEventListener('pointerdown', markActive, { passive: true });
  window.addEventListener('mousemove', function () {
    var n = Date.now();
    if (n - lastMoveLog > 1000) { lastMoveLog = n; markActive(); }
  }, { passive: true });
  window.addEventListener('keydown', markActive);
  window.addEventListener('wheel', markActive, { passive: true });

  setInterval(function () {
    if (asleepIdle) return;
    if (Date.now() - lastActivity > 60000 && !isBusy()) {
      asleepIdle = true;
      clearAnims();
      crystal.classList.add('sleeping');   // slow breathing, zzz floats up
      setExpression('sleepy');
      setStatus('Shhh... Crystal is taking a little nap 😴');
    }
  }, 1000);

  /* ==================== Blink loop (soft periodic blink) ==================== */

  setInterval(function () {
    if (isBusy() || asleepIdle) return;
    crystal.classList.add('blinking');
    setTimeout(function () { crystal.classList.remove('blinking'); }, 400);
  }, 4200);

  /* ==================== Autonomous idle life (when patrol is off) ==================== */

  (function idleLoop() {
    setTimeout(function () {
      if (!isBusy() && !patrolOn && !asleepIdle) {
        var roll = Math.random();
        if (roll < 0.35) {
          doTilt();                     // curious look-around
        } else if (roll < 0.50) {
          doJump();                     // a little hop of joy
        } else if (roll < 0.60) {
          doWave();                     // friendly wave at no one in particular
        } else if (roll < 0.66) {
          doSleep();                    // rare nap (~6% of idle ticks)
        }
        // otherwise she just rests quietly with her idle bob
      }
      idleLoop();
    }, 6000 + Math.random() * 6000);
  })();

  /* ==================== Random delight (every 2–4 min, randomized) ==================== */

  function scheduleDelight() {
    var wait = 120000 + Math.random() * 120000;
    setTimeout(function () {
      if (!isBusy() && !patrolOn && !asleepIdle) {
        if (Math.random() < 0.5) {
          clearAnims(); crystal.classList.add('wiggling');
          setExpression('giggly'); setStatus('Hee hee! Crystal is feeling silly!');
          busy(1000).then(function () {
            crystal.classList.remove('wiggling'); setExpression('happy');
          });
        } else {
          doWiggle();
        }
      }
      scheduleDelight();
    }, wait);
  }
  scheduleDelight();

  /* ==================== Morning greeting ==================== */

  (function morningGreeting() {
    var hour = new Date().getHours();
    if (hour < 6 || hour >= 11) return;
    setTimeout(async function () {
      if (isBusy()) return;
      markActive();
      clearAnims(); setExpression('happy'); setStatus('Good morning! ☀️');
      crystal.classList.add('bowing'); await busy(1700); crystal.classList.remove('bowing');
      crystal.classList.add('waving'); await busy(1500); crystal.classList.remove('waving');
    }, 2000);
  })();

  /* ==================== Click + hover ==================== */

  crystal.addEventListener('click', function () { markActive(); doSpin(); });
  crystal.addEventListener('mouseenter', function () {
    markActive();
    if (isBusy()) return;
    setExpression('curious'); setStatus('Crystal notices you... 👀');
    setTimeout(function () { if (!isBusy()) setExpression('happy'); }, 1800);
  });

  /* ==================== Star field (demo page chrome) ==================== */

  (function () {
    var s = document.getElementById('stars');
    if (!s) return;
    for (var i = 0; i < 70; i++) {
      var d = document.createElement('div');
      d.className = 'star';
      var sz = Math.random() * 2 + 1;
      d.style.cssText = 'left:' + (Math.random() * 100) + '%;top:' + (Math.random() * 70) +
        '%;width:' + sz + 'px;height:' + sz + 'px;animation-delay:' + (Math.random() * 3) + 's';
      s.appendChild(d);
    }
  })();

  /* ==================== Public API ==================== */

  window.doWalk = doWalk;         window.doJump = doJump;
  window.doWave = doWave;         window.doTrip = doTrip;
  window.doSpin = doSpin;         window.doCelebrate = doCelebrate;
  window.doPeek = doPeek;         window.doSleep = doSleep;
  window.doWiggle = doWiggle;     window.doTilt = doTilt;
  window.doBlush = doBlush;       window.doEarWiggle = doEarWiggle;
  window.doShy = doShy;           window.doThink = doThink;
  window.doBow = doBow;           window.doDizzy = doDizzy;
  window.doExcited = doExcited;   window.doYawn = doYawn;
  window.doDance = doDance;
  window.doRoll = doRoll;         window.doHop = doHop;
  window.doTwirl = doTwirl;       window.doBounce = doBounce;
  window.doNuzzle = doNuzzle;     window.doSneeze = doSneeze;
  window.doGiggle = doGiggle;     window.doStretch = doStretch;
  window.doPounce = doPounce;     window.doCuddle = doCuddle;
  window.doZoomies = doZoomies;   window.doPeekSide = doPeekSide;
  window.doFlop = doFlop;         window.doTiptoe = doTiptoe;
  window.doBoing = doBoing;       window.doWaddleRun = doWaddleRun;
  window.doGreet = doGreet;

  window.cheerUp = cheerUp;       window.crystalMood = crystalMood;
  window.startPatrol = startPatrol; window.stopPatrol = stopPatrol;
  window.isBusy = isBusy;         window.clearAnims = clearAnims;
  window.setExpression = setExpression; window.setMood = setMood; // setMood: legacy alias

  /* A calm hello at boot. */
  setExpression('happy');
  setStatus('Crystal is exploring...');

})();

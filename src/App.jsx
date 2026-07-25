import { useState, useEffect, useRef, useReducer, useMemo, useCallback } from "react";
import {
  Plus, Minus, X, Undo2, History, Settings, Skull, Swords,
  Dices, Search, RotateCcw, Loader2, Crown, Star, Pause, Play,
  SkipForward, Hourglass, Image as ImageIcon, Timer as TimerIcon,
  ChevronLeft, BarChart3
} from "lucide-react";

/* =====================================================================
   COMMANDER LIFE — tabletop life counter, iPad-Mini-first
   ---------------------------------------------------------------------
   Single-file by design for now; sections are seamed for later extraction:
     1. Global CSS            -> index.css
     2. Palette + helpers     -> lib/palette.js, lib/util.js
     3. Storage adapter       -> lib/storage.js
     4. Scryfall client       -> lib/scryfall.ts
     5. Game reducer          -> lib/game.ts     (pure logic, no React)
     6. Hooks                 -> hooks/
     7. UI atoms              -> components/
     8. Setup screen          -> screens/Setup
     9. Table screen          -> screens/Table
    10. App shell             -> App
   ===================================================================== */

/* ------------------------------ 1. CSS ------------------------------ */

const CSS = `
.mtg-root{
  -webkit-touch-callout:none;-webkit-user-select:none;user-select:none;
  /* Full inset up top and on the sides: the camera island / notch really
     occludes content there. The bottom inset (34px on Face ID iPhones) is
     mostly free space native apps draw under — keep only a 12px cushion
     above the home indicator instead of reserving the whole strip. */
  padding-top:env(safe-area-inset-top);
  padding-right:env(safe-area-inset-right);
  padding-bottom:min(env(safe-area-inset-bottom), 12px);
  padding-left:env(safe-area-inset-left);
  font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;
}
.mtg-root img{-webkit-user-drag:none;pointer-events:none}
.mtg-serif{font-family:'Iowan Old Style','Palatino Linotype',Palatino,Georgia,serif}
.mtg-pop{animation:mtgpop .16s ease-out}
@keyframes mtgpop{0%{transform:scale(1.12)}100%{transform:scale(1)}}
.mtg-fade{animation:mtgfade .35s ease-out}
@keyframes mtgfade{from{opacity:0}to{opacity:1}}
.mtg-rise{animation:mtgrise .22s ease-out}
@keyframes mtgrise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
.mtg-spot{box-shadow:0 0 0 4px rgb(252 211 77),0 0 28px 6px rgb(252 211 77 / .45)}
.mtg-crowned{box-shadow:0 0 0 3px rgb(251 191 36 / .95),0 0 22px 4px rgb(251 191 36 / .4)}
.mtg-stamp{animation:mtgstamp .5s cubic-bezier(.2,1.4,.4,1)}
@keyframes mtgstamp{
  0%{transform:scale(2.6) rotate(-12deg);opacity:0}
  55%{transform:scale(.92) rotate(2deg);opacity:1}
  100%{transform:scale(1) rotate(0)}
}
.mtg-elim-pulse{animation:mtgelimpulse 3.2s ease-in-out infinite}
@keyframes mtgelimpulse{0%,100%{opacity:.25}50%{opacity:.6}}
@media (prefers-reduced-motion: reduce){
  .mtg-pop,.mtg-fade,.mtg-rise,.mtg-stamp,.mtg-elim-pulse{animation:none}
}
`;

/* ----------------------- 2. Palette + helpers ----------------------- */

const PAL = [
  { k: "ruby",   label: "Ruby",   dot: "bg-rose-500",    ring: "ring-rose-400/80",    text: "text-rose-300",    grad: "from-rose-800 to-slate-900" },
  { k: "ember",  label: "Ember",  dot: "bg-orange-500",  ring: "ring-orange-400/80",  text: "text-orange-300",  grad: "from-orange-800 to-slate-900" },
  { k: "gold",   label: "Gold",   dot: "bg-amber-400",   ring: "ring-amber-300/80",   text: "text-amber-300",   grad: "from-amber-700 to-slate-900" },
  { k: "jade",   label: "Jade",   dot: "bg-emerald-500", ring: "ring-emerald-400/80", text: "text-emerald-300", grad: "from-emerald-800 to-slate-900" },
  { k: "azure",  label: "Azure",  dot: "bg-sky-500",     ring: "ring-sky-400/80",     text: "text-sky-300",     grad: "from-sky-800 to-slate-900" },
  { k: "violet", label: "Violet", dot: "bg-violet-500",  ring: "ring-violet-400/80",  text: "text-violet-300",  grad: "from-violet-800 to-slate-900" },
  { k: "orchid", label: "Orchid", dot: "bg-fuchsia-500", ring: "ring-fuchsia-400/80", text: "text-fuchsia-300", grad: "from-fuchsia-800 to-slate-900" },
  { k: "steel",  label: "Steel",  dot: "bg-slate-400",   ring: "ring-slate-300/80",   text: "text-slate-300",   grad: "from-slate-600 to-slate-900" },
];
const palOf = (k) => PAL.find((p) => p.k === k) || PAL[0];

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const clone = (o) => JSON.parse(JSON.stringify(o));

// Display label for a commander; placeholders read as "<owner>'s commander".
const cmdLabel = (cmd, owner) =>
  cmd && !cmd.placeholder ? cmd.name : `${owner ? owner.name : "Their"}'s commander`;

// Optional per-player counters. Kept off the main screen until nonzero.
const COUNTERS = [
  { k: "poison", label: "Poison",        abbr: "☠",   step: 1, lethalAt: 10 },
  { k: "energy", label: "Energy",        abbr: "⚡",   step: 1 },
  { k: "exp",    label: "Experience",    abbr: "XP",  step: 1 },
  { k: "rad",    label: "Rad",           abbr: "☢",   step: 1 },
  { k: "tax",    label: "Commander tax", abbr: "TAX", step: 2 },
];
const counterOf = (k) => COUNTERS.find((c) => c.k === k);

const fmtMs = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const mm = String(m).padStart(2, "0"), rr = String(r).padStart(2, "0");
  return h ? `${h}:${mm}:${rr}` : `${m}:${rr}`;
};
const elapsedOf = (t, now) =>
  t ? t.accum + (t.runningSince ? Math.max(0, now - t.runningSince) : 0) : 0;

/* ------------------------ 3. Storage adapter ------------------------ */
// localStorage behind an async facade; falls back to in-memory when
// storage is unavailable (e.g. Safari private mode quota errors).

const memFallback = {};
const store = {
  async get(key) {
    try { return localStorage.getItem(key); }
    catch (e) { return memFallback[key] ?? null; }
  },
  async set(key, value) {
    try { localStorage.setItem(key, value); }
    catch (e) { memFallback[key] = value; }
  },
};
const SAVE_KEY = "mtg-life:v1";

/* ------------------------ 4. Scryfall client ------------------------ */
// Scryfall: keyless, CORS-enabled, autocomplete + art_crop images.
// Every call is wrapped so a blocked/offline network degrades to manual entry.

async function scryAutocomplete(q, signal) {
  const r = await fetch(
    "https://api.scryfall.com/cards/autocomplete?q=" + encodeURIComponent(q),
    { signal }
  );
  if (!r.ok) throw new Error("autocomplete failed");
  const j = await r.json();
  return (j.data || []).slice(0, 8);
}

// Double-faced cards keep image_uris on card_faces[0].
const cardFaceImages = (c) => {
  const face = c.image_uris ? c : (c.card_faces && c.card_faces[0]) || {};
  const iu = face.image_uris || {};
  return { art: iu.art_crop || iu.normal || null, thumb: iu.small || null };
};

async function scryResolve(name, signal) {
  const r = await fetch(
    "https://api.scryfall.com/cards/named?fuzzy=" + encodeURIComponent(name),
    { signal }
  );
  if (!r.ok) throw new Error("card not found");
  const c = await r.json();
  return {
    id: c.id,                       // stable Scryfall printing id
    name: c.name,
    ...cardFaceImages(c),
  };
}

// All printings of an exact card name, for choosing a specific artwork.
async function scryPrints(name, signal) {
  const r = await fetch(
    "https://api.scryfall.com/cards/search?unique=prints&order=released&q=" +
      encodeURIComponent(`!"${name}"`),
    { signal }
  );
  if (!r.ok) throw new Error("prints lookup failed");
  const j = await r.json();
  return (j.data || [])
    .map((c) => ({ id: c.id, name: c.name, set: c.set_name, ...cardFaceImages(c) }))
    .filter((p) => p.art)
    .slice(0, 24);
}

/* ------------------------- 5. Game reducer -------------------------- */
// Pure game logic. State shape (see spec "Data model expectations"):
// {
//   id, startedAt, startingLife, rollSkipped,
//   players: [{ id, name, color, life, eliminated,
//               commanders: [{ id, name, art, thumb, placeholder?, manual? }],
//               cmdDamage: { [opposingCommanderId]: number },
//               counters: { poison, energy, exp, rad, tax },
//               statsDealt: { total, byCmd: {}, byDefender: {} } }],
//   monarchId, firstPlayerId,
//   timer: { accum, runningSince },            // total game clock, pausable
//   turns: { enabled, activeId, startedTs, totals: {}, counts: {} },
//   history: [entry], undo: [snapshot]
// }
// Timer and turn clocks are wall-clock based and deliberately excluded from
// undo snapshots; everything gameplay-visible (life, cmd damage, counters,
// monarch, stats) is undoable.
// Commander damage is keyed by opposing COMMANDER id, never seat index,
// so partners / renames / reseating stay correct and the 21 threshold is
// tracked per commander.

const COALESCE_MS = 1200;
const HISTORY_CAP = 200;
const UNDO_CAP = 50;

const snap = (s) => clone({
  players: s.players,
  monarchId: s.monarchId,
  firstPlayerId: s.firstPlayerId,
  history: s.history,
});
const pushUndo = (s) => [...s.undo, snap(s)].slice(-UNDO_CAP);
const capHist = (h) => h.slice(-HISTORY_CAP);

function buildGame(cfg) {
  const players = cfg.players.map((p, i) => {
    // A stable placeholder commander guarantees commander-damage tracking
    // even when selection was skipped. Array form supports partners.
    const cmds = [p.commander, p.partner].filter(Boolean);
    return {
      id: uid(),
      name: (p.name || "").trim() || `Player ${i + 1}`,
      color: p.color || PAL[i % PAL.length].k,
      life: cfg.life,
      eliminated: false,
      commanders: cmds.length ? cmds : [{ id: uid(), name: "", placeholder: true }],
      cmdDamage: {},
      counters: {},
      statsDealt: { total: 0, byCmd: {}, byDefender: {} },
      stats: { gained: 0, lost: 0, biggestHit: 0, cmdTaken: 0 },
    };
  });
  return {
    id: uid(),
    startedAt: Date.now(),
    startingLife: cfg.life,
    players,
    monarchId: null,
    firstPlayerId: null,
    timer: { accum: 0, runningSince: Date.now() },
    turns: { enabled: false, activeId: null, startedTs: null, totals: {}, counts: {} },
    history: [],
    undo: [],
  };
}

function gameReducer(state, a) {
  switch (a.type) {
    case "LOAD": {
      // Backfill fields for saves from older versions.
      const s = a.state;
      return {
        ...s,
        timer: s.timer || { accum: 0, runningSince: s.startedAt || Date.now() },
        turns: s.turns || { enabled: false, activeId: null, startedTs: null, totals: {}, counts: {} },
        players: (s.players || []).map((p) => ({
          counters: {},
          statsDealt: { total: 0, byCmd: {}, byDefender: {} },
          stats: { gained: 0, lost: 0, biggestHit: 0, cmdTaken: 0 },
          ...p,
        })),
        undo: s.undo || [],
      };
    }
    case "INIT":
      return a.game;

    case "LIFE": {
      const p = state.players.find((x) => x.id === a.playerId);
      if (!p) return state;
      const from = p.life;
      const to = from + a.delta;
      const hist = [...state.history];
      const last = hist[hist.length - 1];
      let undo = state.undo;
      if (last && last.kind === "life" && last.playerId === a.playerId &&
          a.ts - last.ts < COALESCE_MS) {
        hist[hist.length - 1] = { ...last, delta: last.delta + a.delta, to, ts: a.ts };
      } else {
        undo = pushUndo(state);
        hist.push({ id: uid(), kind: "life", playerId: a.playerId,
                    delta: a.delta, from, to, ts: a.ts });
      }
      // The coalesced entry's running delta measures the whole swing, so
      // "biggest hit" reflects e.g. -7 from one burst rather than 7 × -1.
      const entry = hist[hist.length - 1];
      return {
        ...state,
        undo,
        history: capHist(hist),
        players: state.players.map((x) => {
          if (x.id !== a.playerId) return x;
          const s = x.stats || { gained: 0, lost: 0, biggestHit: 0, cmdTaken: 0 };
          return {
            ...x,
            life: to,
            stats: {
              ...s,
              gained: s.gained + (a.delta > 0 ? a.delta : 0),
              lost: s.lost + (a.delta < 0 ? -a.delta : 0),
              biggestHit: entry.delta < 0
                ? Math.max(s.biggestHit, -entry.delta)
                : s.biggestHit,
            },
          };
        }),
      };
    }

    case "CMD": {
      const p = state.players.find((x) => x.id === a.defenderId);
      if (!p) return state;
      const cur = p.cmdDamage[a.cmdId] || 0;
      const toCmd = Math.max(0, cur + a.delta);
      const d = toCmd - cur;               // actual applied delta after floor
      if (d === 0) return state;
      const lifeTo = a.applyToLife ? p.life - d : p.life;
      const hist = [...state.history];
      const last = hist[hist.length - 1];
      let undo = state.undo;
      if (last && last.kind === "cmd" && last.playerId === a.defenderId &&
          last.cmdId === a.cmdId && last.applyToLife === a.applyToLife &&
          a.ts - last.ts < COALESCE_MS) {
        hist[hist.length - 1] = { ...last, delta: last.delta + d, to: toCmd,
                                  lifeTo, ts: a.ts };
      } else {
        undo = pushUndo(state);
        hist.push({ id: uid(), kind: "cmd", playerId: a.defenderId, cmdId: a.cmdId,
                    delta: d, from: cur, to: toCmd, lifeTo,
                    applyToLife: a.applyToLife, ts: a.ts });
      }
      // Attribute dealt damage to the commander's owner for the stats view.
      const owner = state.players.find((pl) =>
        pl.commanders.some((c) => c.id === a.cmdId));
      const entry = hist[hist.length - 1];
      return {
        ...state,
        undo,
        history: capHist(hist),
        players: state.players.map((x) => {
          let y = x;
          if (x.id === a.defenderId) {
            const s = y.stats || { gained: 0, lost: 0, biggestHit: 0, cmdTaken: 0 };
            y = {
              ...y,
              life: lifeTo,
              cmdDamage: { ...y.cmdDamage, [a.cmdId]: toCmd },
              stats: {
                ...s,
                // Negative deltas here are corrections, so they back the
                // tallies out instead of counting as healing.
                cmdTaken: Math.max(0, s.cmdTaken + d),
                lost: a.applyToLife ? Math.max(0, s.lost + d) : s.lost,
                biggestHit: a.applyToLife && entry.delta > 0
                  ? Math.max(s.biggestHit, entry.delta)
                  : s.biggestHit,
              },
            };
          }
          if (owner && x.id === owner.id && owner.id !== a.defenderId) {
            const sd = y.statsDealt || { total: 0, byCmd: {}, byDefender: {} };
            y = {
              ...y,
              statsDealt: {
                total: Math.max(0, (sd.total || 0) + d),
                byCmd: { ...sd.byCmd, [a.cmdId]: Math.max(0, (sd.byCmd[a.cmdId] || 0) + d) },
                byDefender: { ...sd.byDefender,
                  [a.defenderId]: Math.max(0, (sd.byDefender[a.defenderId] || 0) + d) },
              },
            };
          }
          return y;
        }),
      };
    }

    case "MONARCH": {
      if (state.monarchId === a.playerId) return state;
      const undo = pushUndo(state);
      const hist = capHist([
        ...state.history,
        { id: uid(), kind: "monarch", playerId: a.playerId, ts: a.ts },
      ]);
      return { ...state, undo, history: hist, monarchId: a.playerId };
    }

    case "COUNTER": {
      const p = state.players.find((x) => x.id === a.playerId);
      if (!p) return state;
      const cur = (p.counters && p.counters[a.key]) || 0;
      const to = Math.max(0, cur + a.delta);
      const d = to - cur;
      if (d === 0) return state;
      const hist = [...state.history];
      const last = hist[hist.length - 1];
      let undo = state.undo;
      if (last && last.kind === "counter" && last.playerId === a.playerId &&
          last.key === a.key && a.ts - last.ts < COALESCE_MS) {
        hist[hist.length - 1] = { ...last, delta: last.delta + d, to, ts: a.ts };
      } else {
        undo = pushUndo(state);
        hist.push({ id: uid(), kind: "counter", playerId: a.playerId, key: a.key,
                    delta: d, from: cur, to, ts: a.ts });
      }
      return {
        ...state,
        undo,
        history: capHist(hist),
        players: state.players.map((x) =>
          x.id === a.playerId ? { ...x, counters: { ...x.counters, [a.key]: to } } : x
        ),
      };
    }

    case "TIMER_PAUSE": {
      const t = state.timer;
      if (!t || !t.runningSince) return state;
      return { ...state,
        timer: { accum: t.accum + Math.max(0, a.ts - t.runningSince), runningSince: null } };
    }
    case "TIMER_RESUME": {
      const t = state.timer || { accum: 0, runningSince: null };
      if (t.runningSince) return state;
      return { ...state, timer: { ...t, runningSince: a.ts } };
    }
    case "TIMER_RESET":
      return { ...state, timer: { accum: 0, runningSince: a.ts } };

    case "TURNS_TOGGLE": {
      const tr = state.turns || { totals: {}, counts: {} };
      if (a.on) {
        const first =
          state.players.find((p) => p.id === state.firstPlayerId && !p.eliminated) ||
          state.players.find((p) => !p.eliminated);
        return {
          ...state,
          turns: {
            ...tr, enabled: true,
            activeId: first ? first.id : null,
            startedTs: first ? a.ts : null,
            counts: { ...tr.counts,
              ...(first ? { [first.id]: (tr.counts[first.id] || 0) + 1 } : {}) },
          },
        };
      }
      // Turning off commits the outstanding turn segment.
      let totals = tr.totals || {};
      if (tr.activeId && tr.startedTs)
        totals = { ...totals,
          [tr.activeId]: (totals[tr.activeId] || 0) + Math.max(0, a.ts - tr.startedTs) };
      return { ...state,
        turns: { ...tr, enabled: false, activeId: null, startedTs: null, totals } };
    }

    case "TURN_NEXT": {
      const tr = state.turns;
      if (!tr || !tr.enabled) return state;
      if (!state.players.some((p) => !p.eliminated)) return state;
      let totals = tr.totals || {};
      if (tr.activeId && tr.startedTs)
        totals = { ...totals,
          [tr.activeId]: (totals[tr.activeId] || 0) + Math.max(0, a.ts - tr.startedTs) };
      const idx = state.players.findIndex((p) => p.id === tr.activeId);
      let next = null;
      for (let k = 1; k <= state.players.length; k++) {
        const cand = state.players[(idx + k) % state.players.length];
        if (!cand.eliminated) { next = cand; break; }
      }
      if (!next) return state;
      return {
        ...state,
        turns: { ...tr, activeId: next.id, startedTs: a.ts, totals,
          counts: { ...tr.counts, [next.id]: (tr.counts[next.id] || 0) + 1 } },
      };
    }

    case "ELIM": {
      const p = state.players.find((x) => x.id === a.playerId);
      if (!p) return state;
      const undo = pushUndo(state);
      const hist = capHist([
        ...state.history,
        { id: uid(), kind: "elim", playerId: a.playerId, value: !p.eliminated, ts: a.ts },
      ]);
      return {
        ...state,
        undo,
        history: hist,
        players: state.players.map((x) =>
          x.id === a.playerId ? { ...x, eliminated: !x.eliminated } : x
        ),
      };
    }

    case "FIRST": {
      const hist = [...state.history];
      const last = hist[hist.length - 1];
      let undo = state.undo;
      if (last && last.kind === "first") {
        hist[hist.length - 1] = { ...last, playerId: a.playerId, ts: a.ts };
      } else {
        undo = pushUndo(state);
        hist.push({ id: uid(), kind: "first", playerId: a.playerId, ts: a.ts });
      }
      return { ...state, undo, history: capHist(hist), firstPlayerId: a.playerId };
    }

    case "RESET":
      return {
        ...state,
        startedAt: Date.now(),
        monarchId: null,
        firstPlayerId: null,
        timer: { accum: 0, runningSince: a.ts },
        turns: { enabled: state.turns ? state.turns.enabled : false,
                 activeId: null, startedTs: null, totals: {}, counts: {} },
        undo: [],
        history: [{ id: uid(), kind: "reset", ts: a.ts }],
        players: state.players.map((p) => ({
          ...p, life: state.startingLife, eliminated: false, cmdDamage: {}, counters: {},
          statsDealt: { total: 0, byCmd: {}, byDefender: {} },
          stats: { gained: 0, lost: 0, biggestHit: 0, cmdTaken: 0 },
        })),
      };

    case "UNDO": {
      if (!state.undo.length) return state;
      const last = state.undo[state.undo.length - 1];
      return {
        ...state,
        players: last.players,
        monarchId: last.monarchId,
        firstPlayerId: last.firstPlayerId,
        history: last.history,
        undo: state.undo.slice(0, -1),
      };
    }

    default:
      return state;
  }
}

/* ----------------------------- 6. Hooks ------------------------------ */

// Press-and-hold: fires step(1) immediately, repeats after 450ms at ~9/s,
// escalates to step(5) after ~14 repeats. Pointer events only (no click),
// which also protects against iOS double-input.
function usePressRepeat(step) {
  const stepRef = useRef(step);
  stepRef.current = step;
  const [pressed, setPressed] = useState(false);
  const T = useRef({ t: null, iv: null, n: 0 });

  const stop = useCallback(() => {
    if (T.current.t) clearTimeout(T.current.t);
    if (T.current.iv) clearInterval(T.current.iv);
    T.current.t = T.current.iv = null;
    T.current.n = 0;
    setPressed(false);
  }, []);
  useEffect(() => stop, [stop]);

  const onPointerDown = useCallback((e) => {
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {}
    setPressed(true);
    stepRef.current(1);
    T.current.n = 1;
    T.current.t = setTimeout(() => {
      T.current.iv = setInterval(() => {
        T.current.n += 1;
        stepRef.current(T.current.n > 14 ? 5 : 1);
      }, 110);
    }, 450);
  }, []);

  return {
    pressed,
    handlers: {
      onPointerDown,
      onPointerUp: stop,
      onPointerCancel: stop,
      onPointerLeave: stop,
      onContextMenu: (e) => e.preventDefault(),
    },
  };
}

function useViewport() {
  // iOS can report stale or zeroed window dimensions during app launch and
  // fires orientationchange before the new size is readable. Take the widest
  // credible source and re-measure until values settle, so a bad first read
  // can't lock in the wrong layout.
  const read = () => ({
    w: Math.max(window.innerWidth || 0, document.documentElement.clientWidth || 0),
    h: Math.max(window.innerHeight || 0, document.documentElement.clientHeight || 0),
  });
  const [v, setV] = useState(read);
  useEffect(() => {
    let timers = [];
    const update = () =>
      setV((prev) => {
        const next = read();
        return prev.w === next.w && prev.h === next.h ? prev : next;
      });
    const settle = () => {
      timers.forEach(clearTimeout);
      update();
      timers = [setTimeout(update, 120), setTimeout(update, 500)];
    };
    window.addEventListener("resize", settle);
    window.addEventListener("orientationchange", settle);
    window.visualViewport?.addEventListener("resize", settle);
    settle(); // initial mount may also have read too early
    return () => {
      timers.forEach(clearTimeout);
      window.removeEventListener("resize", settle);
      window.removeEventListener("orientationchange", settle);
      window.visualViewport?.removeEventListener("resize", settle);
    };
  }, []);
  return v;
}

// A once-per-second clock for timer displays; idle when inactive.
function useNow(active, everyMs = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const iv = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(iv);
  }, [active, everyMs]);
  return now;
}

// Keep the screen awake during an active game; no-ops where unsupported.
function useWakeLock(active) {
  useEffect(() => {
    if (!active) return;
    let lock = null;
    const req = async () => {
      try { lock = await navigator.wakeLock?.request("screen"); } catch (e) {}
    };
    req();
    const vis = () => { if (document.visibilityState === "visible") req(); };
    document.addEventListener("visibilitychange", vis);
    return () => {
      document.removeEventListener("visibilitychange", vis);
      try { lock && lock.release(); } catch (e) {}
    };
  }, [active]);
}

/* ---------------------------- 7. UI atoms ---------------------------- */

function Modal({ children, onClose, flip, wide }) {
  return (
    <div
      className="fixed inset-0 z-40 bg-black/60 flex items-center justify-center p-4 mtg-fade"
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={flip ? "rotate-180 w-full flex justify-center" : "w-full flex justify-center"}>
        <div
          className={`w-full ${wide ? "max-w-lg" : "max-w-md"} bg-slate-900 ring-1 ring-white/10 rounded-2xl shadow-2xl overflow-y-auto mtg-rise`}
          style={{ maxHeight: "85vh" }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

function SheetHeader({ title, onClose }) {
  return (
    <div className="flex items-center justify-between px-4 pt-4 pb-2">
      <div className="text-lg font-semibold">{title}</div>
      <button
        onClick={onClose}
        className="h-11 w-11 rounded-full bg-white/5 ring-1 ring-white/10 flex items-center justify-center"
        aria-label="Close"
      >
        <X size={20} />
      </button>
    </div>
  );
}

function Toggle({ on, onChange, label }) {
  return (
    <button onClick={() => onChange(!on)} className="flex items-center gap-3 py-2">
      <span className={`w-12 h-7 rounded-full p-1 transition-colors ${on ? "bg-amber-400" : "bg-white/15"}`}>
        <span className={`block h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-5" : ""}`} />
      </span>
      <span className="text-sm text-slate-200">{label}</span>
    </button>
  );
}

function Chip({ selected, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`h-11 px-4 rounded-full text-sm font-semibold ring-1 transition-colors ${
        selected
          ? "bg-amber-300 text-slate-950 ring-amber-300"
          : "bg-white/5 text-slate-200 ring-white/15"
      }`}
    >
      {children}
    </button>
  );
}

function ConfirmDialog({ cfg, onClose }) {
  if (!cfg) return null;
  return (
    <Modal onClose={onClose}>
      <div className="p-5">
        <div className="text-lg font-semibold mb-1">{cfg.title}</div>
        <div className="text-sm text-slate-300 mb-5">{cfg.body}</div>
        <div className="flex gap-3">
          <button onClick={onClose}
            className="flex-1 h-12 rounded-xl bg-white/5 ring-1 ring-white/15 font-semibold">
            Cancel
          </button>
          <button
            onClick={() => { cfg.onYes(); onClose(); }}
            className="flex-1 h-12 rounded-xl bg-rose-600 font-semibold"
          >
            {cfg.label}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* --------------------- 8. Setup: commander picker --------------------- */

function CommanderPicker({ title, current, recents, favorites, onToggleFav, onAssign, onClose }) {
  const [q, setQ] = useState("");
  const [sugg, setSugg] = useState([]);
  const [busy, setBusy] = useState(false);
  const [netErr, setNetErr] = useState(false);
  const [prints, setPrints] = useState(null); // null | "loading" | array

  const favs = favorites || [];
  const isFav = (card) => favs.some((f) => f.id === card.id);
  // Favorites first, then recents that aren't already favorites.
  const saved = [
    ...favs,
    ...(recents || []).filter((r) => !favs.some((f) => f.id === r.id)),
  ];

  const showPrints = async () => {
    setPrints("loading");
    try {
      setPrints(await scryPrints(current.name));
    } catch (e) {
      setPrints(null);
      setNetErr(true);
    }
  };

  useEffect(() => {
    if (q.trim().length < 2) { setSugg([]); return; }
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const names = await scryAutocomplete(q.trim(), ctl.signal);
        setSugg(names);
        setNetErr(false);
      } catch (e) {
        if (e.name !== "AbortError") { setNetErr(true); setSugg([]); }
      } finally {
        setBusy(false);
      }
    }, 250);
    return () => { ctl.abort(); clearTimeout(t); };
  }, [q]);

  const pick = async (name) => {
    setBusy(true);
    try {
      const card = await scryResolve(name);
      onAssign(card);
    } catch (e) {
      // Card data unavailable — keep the name, skip the artwork.
      onAssign({ id: uid(), name, manual: true });
    }
    onClose();
  };

  return (
    <Modal onClose={onClose}>
      <SheetHeader
        title={prints !== null ? "Choose artwork" : (title || "Choose commander")}
        onClose={onClose}
      />
      <div className="px-4 pb-4">
        {prints !== null ? (
          <div>
            <button
              onClick={() => setPrints(null)}
              className="mb-3 h-11 px-3 rounded-xl bg-white/5 ring-1 ring-white/15 text-sm text-slate-300 flex items-center gap-1"
            >
              <ChevronLeft size={16} /> Back
            </button>
            {prints === "loading" ? (
              <div className="py-10 flex justify-center">
                <Loader2 size={24} className="animate-spin text-slate-400" />
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {prints.map((pr) => (
                  <button
                    key={pr.id}
                    onClick={() => {
                      onAssign({ id: pr.id, name: pr.name, art: pr.art, thumb: pr.thumb });
                      onClose();
                    }}
                    className={`rounded-xl p-1 ring-1 text-left ${
                      current && current.id === pr.id
                        ? "ring-amber-300 bg-amber-300/10"
                        : "ring-white/10 bg-white/5"
                    }`}
                  >
                    <img src={pr.art} alt={pr.set}
                      className="w-full h-20 object-cover rounded-lg" />
                    <div className="text-[10px] text-slate-400 truncate mt-1 px-0.5">{pr.set}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (<>
        <div className="flex items-center gap-2 bg-white/5 ring-1 ring-white/15 rounded-xl px-3">
          <Search size={18} className="text-slate-400 shrink-0" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search card name"
            className="flex-1 bg-transparent h-12 text-base outline-none placeholder-slate-500"
          />
          {busy && <Loader2 size={18} className="animate-spin text-slate-400" />}
        </div>

        {netErr && (
          <div className="mt-3 text-sm text-amber-300 bg-amber-400/10 ring-1 ring-amber-400/30 rounded-lg px-3 py-2">
            Card search is unavailable right now — you can still add the name below and artwork stays off.
          </div>
        )}

        {sugg.length > 0 && (
          <div className="mt-3 rounded-xl overflow-hidden ring-1 ring-white/10 divide-y divide-white/5">
            {sugg.map((name) => (
              <button key={name} onClick={() => pick(name)}
                className="w-full text-left px-4 py-3 text-base bg-white/5 hover:bg-white/10">
                {name}
              </button>
            ))}
          </div>
        )}

        {q.trim().length >= 2 && (
          <button
            onClick={() => { onAssign({ id: uid(), name: q.trim(), manual: true }); onClose(); }}
            className="mt-3 w-full h-11 rounded-xl bg-white/5 ring-1 ring-white/15 text-sm text-slate-200"
          >
            Use “{q.trim()}” as name only
          </button>
        )}

        {q.trim().length < 2 && saved.length > 0 && (
          <div className="mt-4">
            <div className="text-xs uppercase tracking-widest text-slate-400 mb-2">
              Favorites &amp; recent
            </div>
            <div className="flex flex-wrap gap-2">
              {saved.map((r) => (
                <div key={r.id}
                  className="flex items-center h-11 pl-1 pr-1 rounded-full bg-white/5 ring-1 ring-white/15">
                  <button onClick={() => { onAssign({ ...r }); onClose(); }}
                    className="flex items-center gap-2 pr-1">
                    {r.art || r.thumb
                      ? <img src={r.art || r.thumb} alt="" className="h-9 w-9 rounded-full object-cover" />
                      : <span className="h-9 w-9 rounded-full bg-white/10 flex items-center justify-center text-xs">?</span>}
                    <span className="text-sm">{r.name}</span>
                  </button>
                  <button
                    onClick={() => onToggleFav && onToggleFav(r)}
                    aria-label={isFav(r) ? "Remove favorite" : "Add favorite"}
                    className="h-9 w-9 flex items-center justify-center"
                  >
                    <Star size={16}
                      className={isFav(r) ? "text-amber-300 fill-amber-300" : "text-slate-500"} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {current && !current.manual && !current.placeholder && (
          <button
            onClick={showPrints}
            className="mt-4 w-full h-11 rounded-xl bg-white/5 ring-1 ring-white/15 text-sm text-slate-200 flex items-center justify-center gap-2"
          >
            <ImageIcon size={16} /> Change artwork for {current.name}
          </button>
        )}

        <div className="mt-4 flex gap-3">
          {current && (
            <button
              onClick={() => { onAssign(null); onClose(); }}
              className="flex-1 h-11 rounded-xl bg-white/5 ring-1 ring-white/15 text-sm text-rose-300"
            >
              Remove commander
            </button>
          )}
          <button onClick={onClose}
            className="flex-1 h-11 rounded-xl bg-white/5 ring-1 ring-white/15 text-sm text-slate-300">
            Skip for now
          </button>
        </div>
        </>)}
      </div>
    </Modal>
  );
}

/* ------------------------- 8b. Setup screen -------------------------- */

function LifeStepper({ value, onChange }) {
  const minus = usePressRepeat((m) => onChange(Math.max(1, value - m)));
  const plus  = usePressRepeat((m) => onChange(Math.min(999, value + m)));
  return (
    <div className="flex items-center gap-2">
      <button {...minus.handlers}
        className={`h-11 w-11 rounded-full ring-1 ring-white/15 flex items-center justify-center ${minus.pressed ? "bg-white/20" : "bg-white/5"}`}>
        <Minus size={18} />
      </button>
      <div className="w-14 text-center text-xl font-bold tabular-nums">{value}</div>
      <button {...plus.handlers}
        className={`h-11 w-11 rounded-full ring-1 ring-white/15 flex items-center justify-center ${plus.pressed ? "bg-white/20" : "bg-white/5"}`}>
        <Plus size={18} />
      </button>
    </div>
  );
}

function SetupScreen({ prefs, setPrefs, onStart }) {
  const saved = prefs.lastSetup || {};
  const [count, setCount] = useState(saved.count || 4);
  const [life, setLife] = useState(saved.life || 40);
  const [rows, setRows] = useState(() => {
    const base = Array.from({ length: 6 }, (_, i) => ({
      name: "", color: PAL[i % PAL.length].k, commander: null, partner: null,
    }));
    if (saved.players) {
      saved.players.slice(0, 6).forEach((p, i) => { base[i] = { ...base[i], ...p }; });
    }
    return base;
  });
  const [pickerFor, setPickerFor] = useState(null); // { i, slot: "commander"|"partner" }

  const setRow = (i, patch) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const cycleColor = (i) => {
    const cur = PAL.findIndex((p) => p.k === rows[i].color);
    setRow(i, { color: PAL[(cur + 1) % PAL.length].k });
  };

  const toggleFav = (card) =>
    setPrefs((p) => {
      const favs = p.favorites || [];
      return {
        ...p,
        favorites: favs.some((f) => f.id === card.id)
          ? favs.filter((f) => f.id !== card.id)
          : [...favs, card].slice(-12),
      };
    });

  const cmdChip = (i, slot, card) => (
    <button
      onClick={() => setPickerFor({ i, slot })}
      className="flex items-center gap-1.5 h-11 pl-1 pr-2 rounded-full bg-white/5 ring-1 ring-white/15 max-w-36"
    >
      {card.art || card.thumb
        ? <img src={card.art || card.thumb} alt="" className="h-9 w-9 rounded-full object-cover shrink-0" />
        : <span className="h-9 w-9 rounded-full bg-white/10 shrink-0" />}
      <span className="text-xs truncate">{card.name}</span>
    </button>
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-xl mx-auto px-5 py-8">
        <div className="mb-8">
          <div className="mtg-serif italic text-3xl text-amber-200">Commander Life</div>
          <div className="text-xs uppercase tracking-widest text-slate-400 mt-1">
            Tabletop life counter
          </div>
        </div>

        <div className="text-xs uppercase tracking-widest text-slate-400 mb-2">Players</div>
        <div className="flex flex-wrap gap-2 mb-6">
          {[2, 3, 4, 5, 6].map((n) => (
            <Chip key={n} selected={count === n} onClick={() => setCount(n)}>{n} players</Chip>
          ))}
        </div>

        <div className="text-xs uppercase tracking-widest text-slate-400 mb-2">Starting life</div>
        <div className="flex flex-wrap items-center gap-2 mb-6">
          {[20, 30, 40].map((n) => (
            <Chip key={n} selected={life === n} onClick={() => setLife(n)}>{n}</Chip>
          ))}
          <LifeStepper value={life} onChange={setLife} />
        </div>

        <div className="text-xs uppercase tracking-widest text-slate-400 mb-2">
          Names, colors &amp; commanders <span className="normal-case tracking-normal">(optional)</span>
        </div>
        <div className="space-y-2 mb-6">
          {rows.slice(0, count).map((r, i) => {
            const pal = palOf(r.color);
            return (
              <div key={i} className="flex items-center gap-3 rounded-xl bg-white/5 ring-1 ring-white/10 p-2 pl-3">
                <button
                  onClick={() => cycleColor(i)}
                  aria-label="Change color"
                  className={`h-9 w-9 shrink-0 rounded-full ${pal.dot} ring-2 ring-white/30`}
                />
                <input
                  value={r.name}
                  onChange={(e) => setRow(i, { name: e.target.value })}
                  placeholder={`Player ${i + 1}`}
                  className="flex-1 min-w-0 bg-transparent h-11 text-base outline-none placeholder-slate-500"
                />
                <div className="flex items-center gap-1.5 flex-wrap justify-end shrink-0 max-w-[55%]">
                  {r.commander ? (
                    cmdChip(i, "commander", r.commander)
                  ) : (
                    <button
                      onClick={() => setPickerFor({ i, slot: "commander" })}
                      className="h-11 px-3 rounded-full bg-white/5 ring-1 ring-white/15 text-xs text-slate-300"
                    >
                      + Commander
                    </button>
                  )}
                  {r.commander && (r.partner ? (
                    cmdChip(i, "partner", r.partner)
                  ) : (
                    <button
                      onClick={() => setPickerFor({ i, slot: "partner" })}
                      className="h-11 px-2.5 rounded-full bg-white/5 ring-1 ring-white/15 text-xs text-slate-400"
                    >
                      + Partner
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <button
          onClick={() => onStart({ life, count, players: rows.slice(0, count) })}
          className="w-full h-14 rounded-2xl bg-amber-300 text-slate-950 text-lg font-bold"
        >
          Start game
        </button>
        <div className="text-center text-xs text-slate-500 mt-3">
          Games save automatically on this device.
        </div>
      </div>

      {pickerFor && (
        <CommanderPicker
          title={pickerFor.slot === "partner" ? "Choose partner" : "Choose commander"}
          current={rows[pickerFor.i][pickerFor.slot]}
          recents={prefs.recents || []}
          favorites={prefs.favorites || []}
          onToggleFav={toggleFav}
          onAssign={(cmd) => {
            // Removing the primary promotes the partner to the first slot.
            if (pickerFor.slot === "commander" && !cmd && rows[pickerFor.i].partner) {
              setRow(pickerFor.i, { commander: rows[pickerFor.i].partner, partner: null });
            } else {
              setRow(pickerFor.i, { [pickerFor.slot]: cmd });
            }
          }}
          onClose={() => setPickerFor(null)}
        />
      )}
    </div>
  );
}

/* --------------------------- 9. Table screen -------------------------- */

function TapZone({ side, onStep, pressedClass }) {
  const rep = usePressRepeat(onStep);
  const Icon = side === "minus" ? Minus : Plus;
  return (
    <div
      {...rep.handlers}
      className={`flex-1 h-full flex items-center ${
        side === "minus" ? "justify-start pl-4" : "justify-end pr-4"
      } transition-colors ${rep.pressed ? pressedClass : ""}`}
      role="button"
      aria-label={side === "minus" ? "Decrease life" : "Increase life"}
    >
      <Icon size={26} className="text-white/35" />
    </div>
  );
}

function ArtBackground({ cmd, pal, eliminated }) {
  const [loaded, setLoaded] = useState(false);
  const [broken, setBroken] = useState(false);
  const art = cmd && cmd.art && !broken ? cmd.art : null;
  return (
    <div className={`absolute inset-0 bg-gradient-to-br ${pal.grad}`}>
      {art && (
        <img
          src={art}
          alt=""
          onLoad={() => setLoaded(true)}
          onError={() => setBroken(true)}
          className={`absolute inset-0 w-full h-full object-cover blur-sm scale-110 transition-opacity duration-500 ${
            loaded ? "opacity-100" : "opacity-0"
          } ${eliminated ? "grayscale" : ""}`}
        />
      )}
      {/* Readability scrim over art or gradient alike */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/40 to-black/60" />
    </div>
  );
}

// One cell of the seating mini-map: an opponent's commander damage shown at
// the same table position as their tile, so position alone identifies them.
// The map is rendered in screen order in every tile; the tile's own 180°
// rotation turns it into each player's personal perspective automatically.
function MiniCell({ o, viewer, size = "md", onOpenCmd, onOpenOptions }) {
  const opal = palOf(o.color);
  const seg = size === "lg" ? "h-14 w-18" : size === "sm" ? "h-9 w-12" : "h-11 w-14";
  const num = size === "lg" ? "text-2xl" : size === "sm" ? "text-base" : "text-lg";
  if (o.id === viewer.id) {
    return (
      <button
        onClick={onOpenOptions}
        aria-label="You"
        className={`${seg} rounded-lg ring-2 ring-white/30 bg-white/10 flex flex-col items-center justify-center gap-0.5`}
      >
        <span className={`h-3.5 w-3.5 rounded-full ${opal.dot}`} />
        <span className="text-[9px] font-bold uppercase tracking-widest text-white/70">You</span>
      </button>
    );
  }
  const lethalAny = o.commanders.some((c) => (viewer.cmdDamage[c.id] || 0) >= 21);
  const totalDmg = o.commanders.reduce((s, c) => s + (viewer.cmdDamage[c.id] || 0), 0);
  return (
    <button
      onClick={onOpenCmd}
      aria-label={`Commander damage from ${o.name}: ${totalDmg}`}
      className={`flex rounded-lg overflow-hidden ring-2 ${
        lethalAny ? "ring-rose-400" : opal.ring
      } ${totalDmg === 0 ? "opacity-60" : ""} ${o.eliminated ? "opacity-35 grayscale" : ""}`}
    >
      {o.commanders.map((c) => {
        const dmg = viewer.cmdDamage[c.id] || 0;
        const deadly = dmg >= 21;
        return (
          <span key={c.id} className={`relative ${seg} flex items-center justify-center`}>
            {c.art || c.thumb ? (
              <img src={c.art || c.thumb} alt=""
                className="absolute inset-0 w-full h-full object-cover" />
            ) : (
              <span className={`absolute inset-0 ${opal.dot} opacity-50`} />
            )}
            <span className={`absolute inset-0 ${deadly ? "bg-rose-600/60" : "bg-black/45"}`} />
            <span
              className={`relative ${num} font-black tabular-nums text-white flex items-center gap-0.5`}
              style={{ textShadow: "0 1px 6px rgba(0,0,0,.95)" }}
            >
              {dmg}
              {deadly && <Skull size={size === "sm" ? 12 : 15} />}
            </span>
          </span>
        );
      })}
    </button>
  );
}

// The phone tile: same clockwise grid as the tablet, radically simpler
// content. Art + name + big life + monarch; commander damage and counters
// live one tap away (swords button / chips) in the existing sheets. This is
// deliberately separate from PlayerPanel so the two designs never share
// layout compromises.
function PhonePanel({
  p, flipped, cols, spotlight, isFirst, isMonarch, isTurn, turnMs, freshDelta,
  counterChips, anyLethal,
  onLife, onOpenCmd, onOpenOptions, onMonarch, onRestore,
}) {
  const pal = palOf(p.color);
  const realCmds = p.commanders.filter((c) => !c.placeholder);
  const artCmd = realCmds.find((c) => c.art) || realCmds[0];
  const shadow = { textShadow: "0 1px 6px rgba(0,0,0,.9)" };
  // A lone tile owns the full width of its row (2-player games, and the odd
  // seat in 3/5-player ones), so the number can grow to fill it. The vw term
  // keeps three digits inside the tap zones; the vh term keeps the readout
  // from crowding the name and chips — and it's what governs in landscape,
  // where the rows are short and wide.
  const solo = cols === 1;
  const lifeSize = solo
    ? "clamp(2.25rem, min(19vh, 34vw), 8.5rem)"
    : "clamp(2.25rem, 14vh, 4rem)";
  return (
    <div
      className={`relative flex-1 min-w-0 overflow-hidden rounded-xl ring-1 ring-white/10 ${
        flipped ? "rotate-180" : ""
      } ${spotlight ? "mtg-spot" : isMonarch ? "mtg-crowned" : ""}`}
    >
      <ArtBackground cmd={artCmd} pal={pal} eliminated={p.eliminated} />

      {!p.eliminated && (
        <div className="absolute inset-0 flex">
          <TapZone side="minus" pressedClass="bg-black/25" onStep={(m) => onLife(-m)} />
          <TapZone side="plus" pressedClass="bg-white/10" onStep={(m) => onLife(m)} />
        </div>
      )}

      {/* Readout */}
      <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center gap-0.5 px-11">
        <div className="flex items-center gap-1.5 max-w-full">
          <span className={`h-2 w-2 rounded-full ${pal.dot} shrink-0`} />
          <span className={`${solo ? "text-sm" : "text-[11px]"} uppercase tracking-widest text-white/85 truncate`} style={shadow}>
            {p.name}
          </span>
          {isFirst && (
            <span className="text-[10px] font-bold text-amber-300 bg-amber-400/15 ring-1 ring-amber-300/40 rounded-full px-1.5 py-0.5 shrink-0">
              1st
            </span>
          )}
          {isTurn && (
            <span className="flex items-center gap-1 text-[10px] font-bold text-sky-200 bg-sky-400/15 ring-1 ring-sky-300/40 rounded-full px-1.5 py-0.5 tabular-nums shrink-0">
              <Hourglass size={10} /> {fmtMs(turnMs)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {freshDelta !== 0 && (
            <span
              className={`${solo ? "text-2xl" : "text-base"} font-bold ${freshDelta > 0 ? "text-emerald-300" : "text-rose-300"}`}
              style={shadow}
            >
              {freshDelta > 0 ? `+${freshDelta}` : freshDelta}
            </span>
          )}
          <div
            key={p.life}
            className="mtg-pop font-black tabular-nums leading-none tracking-tight"
            style={{ fontSize: lifeSize, textShadow: "0 3px 16px rgba(0,0,0,.9)" }}
          >
            {p.life}
          </div>
        </div>
        {(anyLethal || counterChips.length > 0) && (
          <div className="flex flex-wrap justify-center gap-1 pointer-events-auto">
            {anyLethal && (
              <button
                onClick={onOpenCmd}
                className="flex items-center gap-1 h-7 px-2 rounded-lg ring-1 text-[10px] font-bold bg-rose-600/90 ring-rose-300/70"
              >
                <Skull size={11} /> 21+
              </button>
            )}
            {counterChips.map((c) => (
              <button
                key={c.k}
                onClick={onOpenOptions}
                className={`flex items-center gap-1 h-7 px-1.5 rounded-lg ring-1 text-[10px] font-bold ${
                  c.lethal ? "bg-rose-600/90 ring-rose-300/70" : "bg-black/55 ring-white/20"
                }`}
              >
                <span>{c.abbr}</span>
                <span className="tabular-nums">{c.v}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Compact corners: crown, options, commander damage */}
      <button
        onClick={onMonarch}
        aria-label={isMonarch ? "Remove Monarch" : "Make Monarch"}
        className={`absolute top-1.5 left-1.5 z-20 h-10 w-10 rounded-full ring-1 backdrop-blur flex items-center justify-center ${
          isMonarch ? "bg-amber-400/90 ring-amber-200 text-slate-950" : "bg-black/45 ring-white/20"
        }`}
      >
        <Crown size={17} className={isMonarch ? "" : "text-white/50"} />
      </button>
      <button
        onClick={onOpenOptions}
        aria-label="Player options"
        className="absolute top-1.5 right-1.5 z-20 h-10 w-10 rounded-full bg-black/45 ring-1 ring-white/20 backdrop-blur flex items-center justify-center"
      >
        <Settings size={17} className="text-white/85" />
      </button>
      <button
        onClick={onOpenCmd}
        aria-label="Commander damage"
        className="absolute bottom-1.5 right-1.5 z-20 h-10 w-10 rounded-full bg-black/45 ring-1 ring-white/20 backdrop-blur flex items-center justify-center"
      >
        <Swords size={17} className={anyLethal ? "text-rose-400" : "text-white/70"} />
      </button>

      {/* Eliminated overlay (compact) */}
      {p.eliminated && (
        <div
          className="absolute inset-0 z-30 flex flex-col items-center justify-center mtg-fade"
          style={{
            background:
              "radial-gradient(ellipse at center, rgba(56,0,8,.55) 0%, rgba(0,0,0,.9) 78%)",
          }}
        >
          <div className="mtg-stamp flex flex-col items-center gap-1">
            <Skull
              size={30}
              className="text-rose-500"
              style={{ filter: "drop-shadow(0 0 12px rgba(244,63,94,.6))" }}
            />
            <div
              className="font-black uppercase text-rose-400 tracking-[0.25em] pl-[0.25em] text-center"
              style={{ fontSize: "12px", textShadow: "0 0 16px rgba(244,63,94,.5)" }}
            >
              Eliminated
            </div>
          </div>
          <button
            onClick={onRestore}
            className="mt-1.5 h-9 px-4 rounded-full bg-white/10 ring-1 ring-white/20 text-xs text-white/75"
          >
            Restore
          </button>
        </div>
      )}
    </div>
  );
}

// The tabletop tile. iPad-only — phones render PhonePanel instead, so this
// component never needs phone-size compromises.
function PlayerPanel({
  p, flipped, cols, spotlight, isFirst, isMonarch, isTurn, turnMs,
  freshDelta, seatRows, counterChips,
  onLife, onOpenCmd, onOpenOptions, onMonarch, onRestore,
}) {
  const pal = palOf(p.color);
  const realCmds = p.commanders.filter((c) => !c.placeholder);
  const primaryCmd = realCmds.find((c) => c.art) || realCmds[0];
  const lifeSize =
    cols === 1 ? "min(21vh, 24vw, 10rem)"
    : cols === 2 ? "min(16vh, 15vw, 8.5rem)"
    : "min(14vh, 10.5vw, 7rem)";

  return (
    <div
      className={`relative flex-1 overflow-hidden rounded-2xl ring-1 ring-white/10 ${
        flipped ? "rotate-180" : ""
      } ${spotlight ? "mtg-spot" : isMonarch ? "mtg-crowned" : ""}`}
    >
      <ArtBackground cmd={primaryCmd} pal={pal} eliminated={p.eliminated} />

      {/* Life tap slabs (left = minus, right = plus) */}
      {!p.eliminated && (
        <div className="absolute inset-0 flex">
          <TapZone side="minus" pressedClass="bg-black/25" onStep={(m) => onLife(-m)} />
          <TapZone side="plus" pressedClass="bg-white/10" onStep={(m) => onLife(m)} />
        </div>
      )}

      {/* Readout — never intercepts touches (except mini-map & chips) */}
      <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-between py-2 px-14">
        <div className="flex items-center gap-2 max-w-full">
          <span className={`h-2.5 w-2.5 rounded-full ${pal.dot} shrink-0`} />
          <span className="text-xs md:text-sm uppercase tracking-widest text-white/85 truncate"
            style={{ textShadow: "0 1px 6px rgba(0,0,0,.9)" }}>
            {p.name}
          </span>
          {isFirst && (
            <span className="text-xs font-bold text-amber-300 bg-amber-400/15 ring-1 ring-amber-300/40 rounded-full px-2 py-0.5">
              1st
            </span>
          )}
          {isMonarch && (
            <span className="flex items-center gap-1 text-xs font-bold text-amber-300 bg-amber-400/20 ring-1 ring-amber-300/50 rounded-full px-2 py-0.5 shrink-0">
              <Crown size={12} /> Monarch
            </span>
          )}
          {isTurn && (
            <span className="flex items-center gap-1 text-xs font-bold text-sky-200 bg-sky-400/15 ring-1 ring-sky-300/40 rounded-full px-2 py-0.5 tabular-nums shrink-0">
              <Hourglass size={11} /> {fmtMs(turnMs)}
            </span>
          )}
        </div>

        <div className="flex flex-col items-center">
          <div className={`h-7 text-xl font-bold ${
            freshDelta > 0 ? "text-emerald-300" : "text-rose-300"
          }`} style={{ textShadow: "0 1px 6px rgba(0,0,0,.9)" }}>
            {freshDelta ? (freshDelta > 0 ? `+${freshDelta}` : freshDelta) : ""}
          </div>
          <div
            key={p.life}
            className="mtg-pop font-black tabular-nums leading-none tracking-tight"
            style={{ fontSize: lifeSize, textShadow: "0 3px 16px rgba(0,0,0,.9)" }}
          >
            {p.life}
          </div>
        </div>

        <div className="flex flex-col items-center gap-1 max-w-full">
          {realCmds.length > 0 && (
            <div className="mtg-serif italic text-xs md:text-sm text-white/80 truncate max-w-full"
              style={{ textShadow: "0 1px 6px rgba(0,0,0,.9)" }}>
              {realCmds.map((c) => c.name).join(" · ")}
            </div>
          )}
          {/* Seating mini-map: commander damage laid out like the table */}
          <div className="flex flex-col gap-1 pointer-events-auto">
            {seatRows.map((row, ri) => (
              <div key={ri} className="flex gap-1 justify-center">
                {row.map((o) => (
                  <MiniCell
                    key={o.id}
                    o={o}
                    viewer={p}
                    size={cols < 3 ? "lg" : "md"}
                    onOpenCmd={onOpenCmd}
                    onOpenOptions={onOpenOptions}
                  />
                ))}
              </div>
            ))}
          </div>
          {counterChips.length > 0 && (
            <div className="flex flex-wrap justify-center gap-1 pointer-events-auto">
              {counterChips.map((c) => (
                <button
                  key={c.k}
                  onClick={onOpenOptions}
                  className={`flex items-center gap-1 h-8 px-2 rounded-lg ring-1 text-xs font-bold ${
                    c.lethal
                      ? "bg-rose-600/90 ring-rose-300/70"
                      : "bg-black/55 ring-white/20"
                  }`}
                >
                  <span>{c.abbr}</span>
                  <span className="tabular-nums">{c.v}</span>
                  {c.lethal && <Skull size={12} />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Corner controls: crown top-left, options top-right. Commander
          damage opens from the mini-map cells. */}
      <button
        onClick={onMonarch}
        aria-label={isMonarch ? "Remove Monarch" : "Make Monarch"}
        className={`absolute top-2 left-2 z-20 h-12 w-12 rounded-full ring-1 backdrop-blur flex items-center justify-center ${
          isMonarch
            ? "bg-amber-400/90 ring-amber-200 text-slate-950"
            : "bg-black/45 ring-white/20"
        }`}
      >
        <Crown size={20} className={isMonarch ? "" : "text-white/50"} />
      </button>
      <button
        onClick={onOpenOptions}
        aria-label="Player options"
        className="absolute top-2 right-2 z-20 h-12 w-12 rounded-full bg-black/45 ring-1 ring-white/20 backdrop-blur flex items-center justify-center"
      >
        <Settings size={20} className="text-white/85" />
      </button>

      {/* Eliminated overlay */}
      {p.eliminated && (
        <div
          className="absolute inset-0 z-30 flex flex-col items-center justify-center mtg-fade"
          style={{
            background:
              "radial-gradient(ellipse at center, rgba(56,0,8,.55) 0%, rgba(0,0,0,.9) 78%)",
          }}
        >
          <div className="mtg-stamp flex flex-col items-center gap-1.5">
            <div className="relative flex items-center justify-center">
              <span className="absolute -inset-7 rounded-full bg-rose-600/35 blur-2xl mtg-elim-pulse" />
              <Skull
                size={cols < 3 ? 56 : 44}
                className="relative text-rose-500"
                style={{ filter: "drop-shadow(0 0 16px rgba(244,63,94,.6))" }}
              />
            </div>
            <div
              className="font-black uppercase text-rose-400 tracking-[0.3em] pl-[0.3em] text-center"
              style={{
                fontSize: cols < 3 ? "clamp(16px,2.4vw,24px)" : "clamp(13px,1.8vw,18px)",
                textShadow: "0 0 20px rgba(244,63,94,.5), 0 2px 10px rgba(0,0,0,.9)",
              }}
            >
              Eliminated
            </div>
            <div className="text-xs uppercase tracking-widest text-white/45">{p.name}</div>
          </div>
          <button
            onClick={onRestore}
            className="mt-4 h-10 px-5 rounded-full bg-white/10 ring-1 ring-white/20 text-sm text-white/75"
          >
            Restore
          </button>
        </div>
      )}
    </div>
  );
}

/* Commander-damage overlay: opponents laid out like the table, one art tile
   per opposing commander. Tap left/right halves to adjust, like life. */

function CmdTile({ cmd, owner, value, onDelta }) {
  const minus = usePressRepeat((m) => onDelta(-m));
  const plus  = usePressRepeat((m) => onDelta(m));
  const opal = palOf(owner.color);
  const lethal = value >= 21;
  return (
    <div className={`relative flex-1 min-w-0 h-28 rounded-xl overflow-hidden ring-2 ${
      lethal ? "ring-rose-400" : opal.ring
    }`}>
      {cmd.art || cmd.thumb ? (
        <img src={cmd.art || cmd.thumb} alt=""
          className="absolute inset-0 w-full h-full object-cover" />
      ) : (
        <div className={`absolute inset-0 bg-gradient-to-br ${opal.grad}`} />
      )}
      <div className={`absolute inset-0 ${lethal ? "bg-rose-950/70" : "bg-black/55"}`} />

      {/* Tap zones: left = minus, right = plus */}
      <div className="absolute inset-0 flex">
        <div {...minus.handlers} role="button" aria-label="Decrease commander damage"
          className={`flex-1 flex items-center justify-start pl-2 ${minus.pressed ? "bg-black/35" : ""}`}>
          <Minus size={18} className="text-white/50" />
        </div>
        <div {...plus.handlers} role="button" aria-label="Increase commander damage"
          className={`flex-1 flex items-center justify-end pr-2 ${plus.pressed ? "bg-white/15" : ""}`}>
          <Plus size={18} className="text-white/50" />
        </div>
      </div>

      {/* Readout */}
      <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center gap-0.5 px-7">
        <div className={`text-[10px] font-bold uppercase tracking-wider truncate max-w-full ${opal.text}`}
          style={{ textShadow: "0 1px 4px rgba(0,0,0,.9)" }}>
          {owner.name}{owner.eliminated ? " ☠" : ""}
        </div>
        <div className="text-3xl font-black tabular-nums text-white flex items-center gap-1"
          style={{ textShadow: "0 2px 8px rgba(0,0,0,.95)" }}>
          {value}
          {lethal && <Skull size={18} />}
        </div>
        <div className="mtg-serif italic text-[10px] text-white/75 truncate max-w-full"
          style={{ textShadow: "0 1px 4px rgba(0,0,0,.9)" }}>
          {cmdLabel(cmd, owner)}
        </div>
      </div>
    </div>
  );
}

function CmdDamageSheet({ game, defenderId, seatRows, flip, applyToLife, setApplyToLife, dispatch, onClose }) {
  const def = game.players.find((p) => p.id === defenderId);
  if (!def) return null;
  const anyLethal = game.players.some(
    (o) => o.id !== defenderId &&
      o.commanders.some((c) => (def.cmdDamage[c.id] || 0) >= 21)
  );

  return (
    <Modal onClose={onClose} flip={flip} wide>
      <SheetHeader title={`Commander damage → ${def.name}`} onClose={onClose} />
      <div className="px-4 pb-4">
        <div className="flex items-center justify-between mb-3">
          <Toggle on={applyToLife} onChange={setApplyToLife} label="Also adjust life total" />
        </div>
        {anyLethal && (
          <div className="mb-3 flex items-center gap-2 text-sm text-rose-300 bg-rose-500/10 ring-1 ring-rose-400/30 rounded-lg px-3 py-2">
            <Skull size={16} /> 21+ from a single commander is lethal.
          </div>
        )}
        {/* Same seating arrangement as the table */}
        <div className="space-y-2">
          {seatRows.map((row, ri) => (
            <div key={ri} className="flex gap-2">
              {row.map((o) =>
                o.id === defenderId ? (
                  <div
                    key={o.id}
                    className="flex-1 h-28 rounded-xl ring-2 ring-white/25 bg-white/5 flex flex-col items-center justify-center gap-1"
                  >
                    <span className={`h-3.5 w-3.5 rounded-full ${palOf(o.color).dot}`} />
                    <span className="text-xs font-bold uppercase tracking-widest text-white/60">You</span>
                  </div>
                ) : (
                  <div key={o.id} className="flex-1 flex gap-1.5 min-w-0">
                    {o.commanders.map((c) => (
                      <CmdTile
                        key={c.id}
                        cmd={c}
                        owner={o}
                        value={def.cmdDamage[c.id] || 0}
                        onDelta={(d) =>
                          dispatch({
                            type: "CMD", defenderId, cmdId: c.id, delta: d,
                            applyToLife, ts: Date.now(),
                          })
                        }
                      />
                    ))}
                  </div>
                )
              )}
            </div>
          ))}
        </div>
        <div className="text-xs text-slate-500 mt-3">
          Tap the left or right half of a commander to adjust damage. Turn the
          toggle off to correct commander damage without touching life.
        </div>
      </div>
    </Modal>
  );
}

/* History + menu + options overlays */

function HistorySheet({ game, onClose }) {
  const names = useMemo(() => {
    const m = {};
    game.players.forEach((p) => { m[p.id] = p; });
    return m;
  }, [game.players]);
  const cmds = useMemo(() => {
    const m = {};
    game.players.forEach((p) => p.commanders.forEach((c) => { m[c.id] = { c, owner: p }; }));
    return m;
  }, [game.players]);

  const line = (e) => {
    const who = names[e.playerId] ? names[e.playerId].name : "Player";
    if (e.kind === "life")
      return `${who} ${e.delta > 0 ? "+" : ""}${e.delta} life (${e.from} → ${e.to})`;
    if (e.kind === "cmd") {
      const src = cmds[e.cmdId];
      const label = src ? cmdLabel(src.c, src.owner) : "a commander";
      return `${who} ${e.delta > 0 ? "+" : ""}${e.delta} commander damage from ${label} (${e.from} → ${e.to})${e.applyToLife ? ", life adjusted" : ""}`;
    }
    if (e.kind === "elim") return `${who} ${e.value ? "eliminated" : "restored"}`;
    if (e.kind === "first") return `${who} goes first`;
    if (e.kind === "monarch")
      return e.playerId ? `${who} becomes the Monarch` : "Monarch removed";
    if (e.kind === "counter") {
      const def = counterOf(e.key);
      return `${who} ${e.delta > 0 ? "+" : ""}${e.delta} ${def ? def.label.toLowerCase() : e.key} (${e.from} → ${e.to})`;
    }
    if (e.kind === "reset") return "Game reset";
    return "";
  };

  const items = [...game.history].reverse();
  return (
    <Modal onClose={onClose}>
      <SheetHeader title="Game history" onClose={onClose} />
      <div className="px-4 pb-4">
        {items.length === 0 && (
          <div className="text-sm text-slate-400 py-6 text-center">Nothing yet — go get 'em.</div>
        )}
        <div className="divide-y divide-white/5">
          {items.map((e) => (
            <div key={e.id} className="py-2.5 flex items-baseline gap-3">
              <span className="text-xs text-slate-500 tabular-nums shrink-0">
                {new Date(e.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
              <span className="text-sm text-slate-200">{line(e)}</span>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function CounterRow({ def, value, onDelta }) {
  const minus = usePressRepeat((m) => onDelta(-m * (def.step || 1)));
  const plus  = usePressRepeat((m) => onDelta(m * (def.step || 1)));
  const lethal = def.lethalAt && value >= def.lethalAt;
  return (
    <div className={`flex items-center gap-3 rounded-xl p-2 ring-1 ${
      lethal ? "bg-rose-950/60 ring-rose-400/40" : "bg-white/5 ring-white/10"
    }`}>
      <span className="h-10 w-10 rounded-lg bg-white/10 flex items-center justify-center text-sm font-bold shrink-0">
        {def.abbr}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold truncate">{def.label}</div>
        {lethal
          ? <div className="text-xs text-rose-300">Lethal at {def.lethalAt}</div>
          : def.lethalAt
            ? <div className="text-xs text-slate-500">Lethal at {def.lethalAt}</div>
            : null}
      </div>
      <button {...minus.handlers}
        className={`h-12 w-12 rounded-xl ring-1 ring-white/15 flex items-center justify-center ${minus.pressed ? "bg-white/20" : "bg-white/10"}`}
        aria-label={`Decrease ${def.label}`}>
        <Minus size={20} />
      </button>
      <div className={`w-10 text-center text-2xl font-black tabular-nums ${lethal ? "text-rose-400" : ""}`}>
        {value}
      </div>
      <button {...plus.handlers}
        className={`h-12 w-12 rounded-xl ring-1 ring-white/15 flex items-center justify-center ${plus.pressed ? "bg-white/20" : "bg-white/10"}`}
        aria-label={`Increase ${def.label}`}>
        <Plus size={20} />
      </button>
    </div>
  );
}

function StatCell({ v, label, cls }) {
  return (
    <div className="rounded-lg bg-white/5 py-1.5">
      <div className={`text-lg font-black tabular-nums leading-tight ${cls || ""}`}>{v}</div>
      <div className="text-[10px] uppercase tracking-wider text-slate-400">{label}</div>
    </div>
  );
}

function StatsSheet({ game, onClose }) {
  return (
    <Modal onClose={onClose}>
      <SheetHeader title="Player stats" onClose={onClose} />
      <div className="px-4 pb-4 space-y-2">
        {game.players.map((p) => {
          const s = p.stats || { gained: 0, lost: 0, biggestHit: 0, cmdTaken: 0 };
          const dealt = (p.statsDealt && p.statsDealt.total) || 0;
          const net = p.life - game.startingLife;
          return (
            <div key={p.id} className="rounded-xl bg-white/5 ring-1 ring-white/10 p-3">
              <div className="flex items-center gap-2 mb-2">
                <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${palOf(p.color).dot}`} />
                <span className="font-semibold flex-1 truncate">
                  {p.name}
                  {p.eliminated && <span className="text-rose-400 text-xs ml-2">eliminated</span>}
                </span>
                <span className="text-xl font-black tabular-nums">{p.life}</span>
              </div>
              <div className="grid grid-cols-3 gap-1.5 text-center">
                <StatCell v={s.lost} label="Dmg taken" cls="text-rose-300" />
                <StatCell v={s.gained} label="Healed" cls="text-emerald-300" />
                <StatCell
                  v={net > 0 ? `+${net}` : net}
                  label="Net life"
                  cls={net > 0 ? "text-emerald-300" : net < 0 ? "text-rose-300" : ""}
                />
                <StatCell v={dealt} label="Cmd dealt" />
                <StatCell v={s.cmdTaken} label="Cmd taken" />
                <StatCell v={s.biggestHit ? `-${s.biggestHit}` : "—"} label="Biggest hit" />
              </div>
            </div>
          );
        })}
        <div className="text-xs text-slate-500">
          Tallies run for the current game and reset with it.
        </div>
      </div>
    </Modal>
  );
}

// Chunk buttons + direct entry for big life swings. Deltas go through the
// normal LIFE action so undo, history, and stats all see them.
function LifeSetRow({ life, onLife }) {
  const [val, setVal] = useState(String(life));
  useEffect(() => { setVal(String(life)); }, [life]);
  const commit = () => {
    const n = parseInt(val, 10);
    if (!Number.isNaN(n) && n !== life) onLife(n - life);
    else setVal(String(life));
  };
  const chunk = (d, label) => (
    <button
      key={label}
      onClick={() => onLife(d)}
      className="h-11 flex-1 rounded-xl bg-white/10 ring-1 ring-white/15 text-sm font-bold"
    >
      {label}
    </button>
  );
  return (
    <div className="rounded-xl bg-white/5 ring-1 ring-white/10 p-2">
      <div className="flex items-center gap-1.5">
        {chunk(-10, "−10")}
        {chunk(-5, "−5")}
        <input
          value={val}
          onChange={(e) => setVal(e.target.value.replace(/[^0-9-]/g, ""))}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
          inputMode="numeric"
          aria-label="Set life total"
          className="w-20 h-11 bg-black/30 ring-1 ring-white/20 rounded-xl text-center text-2xl font-black tabular-nums outline-none focus:ring-2 focus:ring-amber-300/60"
        />
        {chunk(5, "+5")}
        {chunk(10, "+10")}
      </div>
      <div className="text-xs text-slate-500 mt-1.5 px-1">
        Tap a chunk, or type an exact total and tap away.
      </div>
    </div>
  );
}

function OptionsSheet({ player, isMonarch, flip, onLife, onMonarch, onCounter, onEliminate, onClose }) {
  return (
    <Modal onClose={onClose} flip={flip}>
      <SheetHeader title={player.name} onClose={onClose} />
      <div className="px-4 pb-4 space-y-2">
        <LifeSetRow life={player.life} onLife={onLife} />
        <button
          onClick={onMonarch}
          className={`w-full h-12 rounded-xl ring-1 flex items-center justify-center gap-2 font-semibold ${
            isMonarch
              ? "bg-amber-400/20 ring-amber-300/50 text-amber-200"
              : "bg-white/5 ring-white/15"
          }`}
        >
          <Crown size={18} className="text-amber-300" />
          {isMonarch ? "Remove Monarch" : "Crown as Monarch"}
        </button>

        <div className="text-xs uppercase tracking-widest text-slate-400 pt-2">Counters</div>
        {COUNTERS.map((def) => (
          <CounterRow
            key={def.k}
            def={def}
            value={(player.counters && player.counters[def.k]) || 0}
            onDelta={(d) => onCounter(def.k, d)}
          />
        ))}

        <div className="pt-2">
          <button
            onClick={() => { onEliminate(); onClose(); }}
            className="w-full h-12 rounded-xl bg-white/5 ring-1 ring-white/15 flex items-center justify-center gap-2 font-semibold"
          >
            <Skull size={18} />
            {player.eliminated ? "Restore player" : "Mark eliminated"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function MenuSheet({ game, dispatch, onStats, onRoll, onReset, onNewGame, onClose }) {
  const now = useNow(true);
  const t = game.timer || { accum: 0, runningSince: null };
  const running = !!t.runningSince;
  const tr = game.turns || { enabled: false, totals: {}, counts: {} };
  const liveTotal = (pid) =>
    ((tr.totals && tr.totals[pid]) || 0) +
    (tr.enabled && tr.activeId === pid && tr.startedTs ? Math.max(0, now - tr.startedTs) : 0);

  return (
    <Modal onClose={onClose}>
      <SheetHeader title="Game" onClose={onClose} />
      <div className="px-4 pb-4 space-y-2">
        {/* Total game timer */}
        <div className="flex items-center gap-3 rounded-xl bg-white/5 ring-1 ring-white/10 p-2 pl-3">
          <TimerIcon size={18} className="text-slate-300 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-xl font-bold tabular-nums leading-none">{fmtMs(elapsedOf(t, now))}</div>
            <div className="text-xs text-slate-400 mt-0.5">Game time{running ? "" : " · paused"}</div>
          </div>
          <button
            onClick={() => dispatch({ type: running ? "TIMER_PAUSE" : "TIMER_RESUME", ts: Date.now() })}
            aria-label={running ? "Pause timer" : "Resume timer"}
            className="h-11 w-11 rounded-full bg-white/10 ring-1 ring-white/15 flex items-center justify-center"
          >
            {running ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <button
            onClick={() => dispatch({ type: "TIMER_RESET", ts: Date.now() })}
            aria-label="Reset timer"
            className="h-11 w-11 rounded-full bg-white/10 ring-1 ring-white/15 flex items-center justify-center"
          >
            <RotateCcw size={16} />
          </button>
        </div>

        {/* Per-player turn tracking */}
        <div className="rounded-xl bg-white/5 ring-1 ring-white/10 p-2 pl-3">
          <Toggle
            on={tr.enabled}
            onChange={(v) => dispatch({ type: "TURNS_TOGGLE", on: v, ts: Date.now() })}
            label="Track turns & per-player time"
          />
          {tr.enabled && (
            <div className="mt-1 space-y-1 pb-1">
              {game.players.map((p) => (
                <div key={p.id} className="flex items-center gap-2 text-sm">
                  <span className={`h-2 w-2 rounded-full shrink-0 ${palOf(p.color).dot}`} />
                  <span className={`flex-1 truncate ${tr.activeId === p.id ? "text-sky-200 font-semibold" : ""}`}>
                    {p.name}
                  </span>
                  <span className="tabular-nums text-slate-300">{fmtMs(liveTotal(p.id))}</span>
                  <span className="text-xs text-slate-500 w-14 text-right">
                    {((tr.counts && tr.counts[p.id]) || 0)} turns
                  </span>
                </div>
              ))}
              <div className="text-xs text-slate-500 pt-1">
                Pass the turn with the ▶ button at the table center.
              </div>
            </div>
          )}
        </div>

        <button onClick={onStats}
          className="w-full h-12 rounded-xl bg-white/5 ring-1 ring-white/15 flex items-center justify-center gap-2 font-semibold">
          <BarChart3 size={18} /> Player stats
        </button>
        <button onClick={() => { onClose(); onRoll(); }}
          className="w-full h-12 rounded-xl bg-white/5 ring-1 ring-white/15 flex items-center justify-center gap-2 font-semibold">
          <Dices size={18} /> Decide who goes first
        </button>
        <button onClick={onReset}
          className="w-full h-12 rounded-xl bg-white/5 ring-1 ring-white/15 flex items-center justify-center gap-2 font-semibold text-amber-300">
          <RotateCcw size={18} /> Reset this game
        </button>
        <button onClick={onNewGame}
          className="w-full h-12 rounded-xl bg-white/5 ring-1 ring-white/15 flex items-center justify-center gap-2 font-semibold text-rose-300">
          <X size={18} /> New game (back to setup)
        </button>
        <div className="text-xs text-slate-500 pt-1">
          Started {new Date(game.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.
          Progress saves automatically on this device.
        </div>
      </div>
    </Modal>
  );
}

/* The Table itself */

function Table({ game, dispatch, prefs, setPrefs, onNewGame }) {
  const vp = useViewport();
  const [ui, setUi] = useState(() => ({
    cmdFor: null,
    optionsFor: null,
    menu: false,
    history: false,
    stats: false,
    confirm: null,
    roll: null,
  }));
  const [spot, setSpot] = useState(null);
  const rollTimer = useRef(null);
  useEffect(() => () => clearTimeout(rollTimer.current), []);

  // Re-render shortly after the last action so the +N badge fades out.
  const [, setTick] = useState(0);
  useEffect(() => {
    const last = game.history[game.history.length - 1];
    if (!last) return;
    const age = Date.now() - last.ts;
    if (age < 1500) {
      const t = setTimeout(() => setTick((x) => x + 1), 1600 - age);
      return () => clearTimeout(t);
    }
  }, [game.history]);

  const n = game.players.length;
  const farCount = n === 2 ? 1 : Math.ceil(n / 2);
  const far = game.players.slice(0, farCount);
  // Near bank is reversed so seating runs clockwise around the table:
  // P1 top-left → P2 top-right → P3 bottom-right → P4 bottom-left.
  const near = game.players.slice(farCount).reverse();
  const farIds = useMemo(() => new Set(far.map((p) => p.id)), [game.players, farCount]);

  // The mini-map mirrors the on-screen banks so damage sources are found by
  // position rather than by reading names.
  const seatRows = [far, near];

  const counterChipsFor = (p) =>
    COUNTERS.filter((d) => ((p.counters && p.counters[d.k]) || 0) > 0)
      .map((d) => ({
        k: d.k, abbr: d.abbr, v: p.counters[d.k],
        lethal: d.lethalAt ? p.counters[d.k] >= d.lethalAt : false,
      }));

  const turns = game.turns || { enabled: false };
  // Tick once per second for the hub timer and the active-turn chip.
  const now = useNow(true);

  // Phone-sized screens get the simplified tiles in either orientation.
  const anyPhone = Math.min(vp.w, vp.h) < 520;

  // Offer the first-player roll only while the game is untouched — no modal,
  // just a hub button that retires itself once play begins.
  const freshRoll =
    !game.firstPlayerId &&
    !game.history.some((h) => h.kind === "life" || h.kind === "cmd");

  const lastEntry = game.history[game.history.length - 1];
  const freshFor = (pid) =>
    lastEntry && lastEntry.kind === "life" && lastEntry.playerId === pid &&
    Date.now() - lastEntry.ts < 1500
      ? lastEntry.delta
      : 0;

  const adjustLife = (pid, delta) =>
    dispatch({ type: "LIFE", playerId: pid, delta, ts: Date.now() });

  const runRoll = () => {
    setUi((u) => ({ ...u, roll: "running" }));
    const ids = game.players.filter((p) => !p.eliminated).map((p) => p.id);
    if (!ids.length) return;
    let i = Math.floor(Math.random() * ids.length);
    const steps = 16 + Math.floor(Math.random() * ids.length) + (Math.random() < 0.5 ? 1 : 0);
    let s = 0;
    const tick = () => {
      setSpot(ids[i % ids.length]);
      i += 1; s += 1;
      if (s < steps) {
        rollTimer.current = setTimeout(tick, 60 * Math.pow(1.13, s));
      } else {
        const winner = ids[(i - 1) % ids.length];
        setSpot(winner);
        dispatch({ type: "FIRST", playerId: winner, ts: Date.now() });
        setUi((u) => ({ ...u, roll: { winnerId: winner } }));
      }
    };
    tick();
  };

  const renderBank = (players, flipped) => {
    const cols = players.length;
    return (
      <div className="flex-1 flex gap-1.5 min-h-0">
        {players.map((p) => (
          <PlayerPanel
            key={p.id}
            p={p}
            flipped={flipped}
            cols={cols}
            spotlight={spot === p.id}
            isFirst={game.firstPlayerId === p.id}
            isMonarch={game.monarchId === p.id}
            isTurn={turns.enabled && turns.activeId === p.id}
            turnMs={turns.startedTs ? Math.max(0, now - turns.startedTs) : 0}
            freshDelta={freshFor(p.id)}
            seatRows={seatRows}
            counterChips={counterChipsFor(p)}
            onLife={(d) => adjustLife(p.id, d)}
            onOpenCmd={() => setUi((u) => ({ ...u, cmdFor: p.id }))}
            onOpenOptions={() => setUi((u) => ({ ...u, optionsFor: p.id }))}
            onMonarch={() =>
              dispatch({
                type: "MONARCH",
                playerId: game.monarchId === p.id ? null : p.id,
                ts: Date.now(),
              })
            }
            onRestore={() => dispatch({ type: "ELIM", playerId: p.id, ts: Date.now() })}
          />
        ))}
      </div>
    );
  };

  // Phone rows: same clockwise banks as the tablet, simpler tiles; the far
  // bank flips so numbers face the players seated across.
  const renderPhoneRow = (players, flipped) => (
    <div className="flex-1 flex gap-1.5 min-h-0">
      {players.map((p) => (
        <PhonePanel
          key={p.id}
          p={p}
          flipped={flipped}
          cols={players.length}
          spotlight={spot === p.id}
          isFirst={game.firstPlayerId === p.id}
          isMonarch={game.monarchId === p.id}
          isTurn={turns.enabled && turns.activeId === p.id}
          turnMs={turns.startedTs ? Math.max(0, now - turns.startedTs) : 0}
          freshDelta={freshFor(p.id)}
          counterChips={counterChipsFor(p)}
          anyLethal={Object.values(p.cmdDamage).some((v) => v >= 21)}
          onLife={(d) => adjustLife(p.id, d)}
          onOpenCmd={() => setUi((u) => ({ ...u, cmdFor: p.id }))}
          onOpenOptions={() => setUi((u) => ({ ...u, optionsFor: p.id }))}
          onMonarch={() =>
            dispatch({
              type: "MONARCH",
              playerId: game.monarchId === p.id ? null : p.id,
              ts: Date.now(),
            })
          }
          onRestore={() => dispatch({ type: "ELIM", playerId: p.id, ts: Date.now() })}
        />
      ))}
    </div>
  );

  const winnerName = (wid) => {
    const w = game.players.find((p) => p.id === wid);
    return w ? w.name : "";
  };
  const optionsPlayer = game.players.find((p) => p.id === ui.optionsFor);

  return (
    <div className="h-full flex flex-col gap-1.5 p-1.5">
      {anyPhone ? renderPhoneRow(far, true) : renderBank(far, true)}

      {/* Center hub — below the phone stack, or between the tablet banks so
          it never overlaps the panels' corner controls */}
      <div className="shrink-0 flex justify-center">
        <div className="flex items-center gap-1 p-1 rounded-full bg-black/70 ring-1 ring-white/15">
        {freshRoll && (
          <button
            onClick={runRoll}
            aria-label="Roll for first player"
            className="h-11 px-3 rounded-full bg-amber-300/90 text-slate-950 flex items-center gap-1.5 font-bold text-sm"
          >
            <Dices size={18} /> Roll
          </button>
        )}
        <button
          onClick={() => dispatch({ type: "UNDO" })}
          disabled={!game.undo.length}
          aria-label="Undo"
          className={`h-11 w-11 rounded-full flex items-center justify-center ${
            game.undo.length ? "bg-white/10" : "opacity-30"
          }`}
        >
          <Undo2 size={20} />
        </button>
        <button
          onClick={() => setUi((u) => ({ ...u, history: true }))}
          aria-label="History"
          className="h-11 w-11 rounded-full bg-white/10 flex items-center justify-center"
        >
          <History size={20} />
        </button>
        <button
          onClick={() => setUi((u) => ({ ...u, menu: true }))}
          aria-label="Menu and game timer"
          className="h-11 px-3 rounded-full bg-white/10 flex items-center gap-1.5"
        >
          <Settings size={20} />
          <span className={`text-xs font-semibold tabular-nums ${
            game.timer && game.timer.runningSince ? "text-slate-200" : "text-slate-500"
          }`}>
            {fmtMs(elapsedOf(game.timer, now))}
          </span>
        </button>
        {turns.enabled && (
          <button
            onClick={() => dispatch({ type: "TURN_NEXT", ts: Date.now() })}
            aria-label="Next turn"
            className="h-11 w-11 rounded-full bg-amber-300/90 text-slate-950 flex items-center justify-center"
          >
            <SkipForward size={20} />
          </button>
        )}
        </div>
      </div>

      {anyPhone ? renderPhoneRow(near, false) : renderBank(near, false)}

      {/* First-player roll flow */}
      {ui.roll === "running" && (
        <div className="fixed inset-0 z-40 flex items-end justify-center pb-10 pointer-events-auto">
          <div className="px-4 py-2 rounded-full bg-black/70 ring-1 ring-amber-300/40 text-amber-200 text-sm font-semibold">
            Rolling…
          </div>
        </div>
      )}
      {ui.roll && ui.roll.winnerId && (
        <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4 mtg-fade">
          <div className="bg-slate-900 ring-2 ring-amber-300/60 rounded-2xl p-6 text-center max-w-sm w-full mtg-rise">
            <div className="text-xs uppercase tracking-widest text-amber-300 mb-1">First player</div>
            <div className="mtg-serif italic text-3xl mb-5">{winnerName(ui.roll.winnerId)}</div>
            <div className="flex gap-3">
              <button onClick={runRoll}
                className="flex-1 h-12 rounded-xl bg-white/5 ring-1 ring-white/15 font-semibold">
                Roll again
              </button>
              <button
                onClick={() => { setSpot(null); setUi((u) => ({ ...u, roll: null })); }}
                className="flex-1 h-12 rounded-xl bg-amber-300 text-slate-950 font-bold"
              >
                Begin
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Overlays */}
      {ui.cmdFor && (
        <CmdDamageSheet
          game={game}
          defenderId={ui.cmdFor}
          seatRows={seatRows}
          flip={farIds.has(ui.cmdFor)}
          applyToLife={prefs.applyToLife}
          setApplyToLife={(v) => setPrefs((p) => ({ ...p, applyToLife: v }))}
          dispatch={dispatch}
          onClose={() => setUi((u) => ({ ...u, cmdFor: null }))}
        />
      )}
      {optionsPlayer && (
        <OptionsSheet
          player={optionsPlayer}
          isMonarch={game.monarchId === optionsPlayer.id}
          flip={farIds.has(optionsPlayer.id)}
          onLife={(d) => adjustLife(optionsPlayer.id, d)}
          onMonarch={() =>
            dispatch({
              type: "MONARCH",
              playerId: game.monarchId === optionsPlayer.id ? null : optionsPlayer.id,
              ts: Date.now(),
            })
          }
          onCounter={(key, delta) =>
            dispatch({ type: "COUNTER", playerId: optionsPlayer.id, key, delta, ts: Date.now() })
          }
          onEliminate={() => dispatch({ type: "ELIM", playerId: optionsPlayer.id, ts: Date.now() })}
          onClose={() => setUi((u) => ({ ...u, optionsFor: null }))}
        />
      )}
      {ui.history && <HistorySheet game={game} onClose={() => setUi((u) => ({ ...u, history: false }))} />}
      {ui.stats && <StatsSheet game={game} onClose={() => setUi((u) => ({ ...u, stats: false }))} />}
      {ui.menu && (
        <MenuSheet
          game={game}
          dispatch={dispatch}
          onStats={() => setUi((u) => ({ ...u, menu: false, stats: true }))}
          onRoll={runRoll}
          onReset={() =>
            setUi((u) => ({
              ...u, menu: false,
              confirm: {
                title: "Reset this game?",
                body: "Life totals, commander damage and history go back to the start. Players and commanders stay.",
                label: "Reset",
                onYes: () => dispatch({ type: "RESET", ts: Date.now() }),
              },
            }))
          }
          onNewGame={() =>
            setUi((u) => ({
              ...u, menu: false,
              confirm: {
                title: "Start a new game?",
                body: "You'll return to setup. The current game ends.",
                label: "New game",
                onYes: onNewGame,
              },
            }))
          }
          onClose={() => setUi((u) => ({ ...u, menu: false }))}
        />
      )}
      <ConfirmDialog cfg={ui.confirm} onClose={() => setUi((u) => ({ ...u, confirm: null }))} />
    </div>
  );
}

/* ---------------------------- 10. App shell --------------------------- */

// iOS standalone mode occasionally leaves the visual viewport scrolled or
// offset (after launch, rotation, or keyboard dismissal), which shows up as
// dead space at an edge. Snap back to origin whenever the viewport shifts.
function useViewportPin() {
  useEffect(() => {
    const reset = () => {
      if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
    };
    reset();
    window.addEventListener("pageshow", reset);
    window.addEventListener("focusout", reset);
    window.addEventListener("orientationchange", reset);
    window.visualViewport?.addEventListener("resize", reset);
    window.visualViewport?.addEventListener("scroll", reset);
    return () => {
      window.removeEventListener("pageshow", reset);
      window.removeEventListener("focusout", reset);
      window.removeEventListener("orientationchange", reset);
      window.visualViewport?.removeEventListener("resize", reset);
      window.visualViewport?.removeEventListener("scroll", reset);
    };
  }, []);
}

export default function App() {
  const [phase, setPhase] = useState("loading"); // loading | setup | game
  const [game, dispatch] = useReducer(gameReducer, null);
  const [prefs, setPrefs] = useState({
    recents: [], favorites: [], lastSetup: null, applyToLife: true,
  });

  useViewportPin();
  useWakeLock(phase === "game");

  // Restore on mount: active game resumes straight to the table.
  useEffect(() => {
    (async () => {
      try {
        const raw = await store.get(SAVE_KEY);
        if (raw) {
          const d = JSON.parse(raw);
          if (d.prefs) setPrefs((p) => ({ ...p, ...d.prefs }));
          if (d.phase === "game" && d.game) {
            dispatch({ type: "LOAD", state: d.game });
            setPhase("game");
            return;
          }
        }
      } catch (e) { /* corrupt save — start fresh */ }
      setPhase("setup");
    })();
  }, []);

  // Debounced persistence. Undo stack is dropped from the save to stay light.
  useEffect(() => {
    if (phase === "loading") return;
    const t = setTimeout(() => {
      const payload = {
        v: 1,
        phase: phase === "game" && game ? "game" : "setup",
        game: game ? { ...game, undo: [] } : null,
        prefs,
      };
      store.set(SAVE_KEY, JSON.stringify(payload));
    }, 400);
    return () => clearTimeout(t);
  }, [phase, game, prefs]);

  const onStart = (cfg) => {
    const g = buildGame(cfg);
    dispatch({ type: "INIT", game: g });
    setPrefs((p) => {
      const picked = cfg.players
        .flatMap((r) => [r.commander, r.partner])
        .filter((c) => c && !c.placeholder);
      const recents = [
        ...picked,
        ...(p.recents || []).filter((r) => !picked.some((c) => c.id === r.id)),
      ].slice(0, 8);
      return {
        ...p,
        recents,
        lastSetup: {
          count: cfg.count,
          life: cfg.life,
          players: cfg.players.map((r) => ({
            name: r.name, color: r.color, commander: r.commander, partner: r.partner,
          })),
        },
      };
    });
    setPhase("game");
  };

  return (
    <div className="mtg-root fixed inset-0 bg-slate-950 text-slate-100 overflow-hidden"
      style={{ touchAction: "manipulation" }}>
      <style>{CSS}</style>
      {phase === "loading" && (
        <div className="h-full flex items-center justify-center">
          <div className="mtg-serif italic text-2xl text-amber-200/70">Commander Life</div>
        </div>
      )}
      {phase === "setup" && <SetupScreen prefs={prefs} setPrefs={setPrefs} onStart={onStart} />}
      {phase === "game" && game && (
        <Table
          game={game}
          dispatch={dispatch}
          prefs={prefs}
          setPrefs={setPrefs}
          onNewGame={() => setPhase("setup")}
        />
      )}
    </div>
  );
}

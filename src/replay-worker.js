// Parses a .replay in a worker and packs it into transferable typed arrays.
import init, { get_replay_frames_data } from '../vendor/subtr-actor/rl_replay_subtr_actor.js';

const ready = init({ module_or_path: new URL('../vendor/subtr-actor/rl_replay_subtr_actor_bg.wasm', import.meta.url) });

const obj = m => (m instanceof Map ? Object.fromEntries(m) : m);
const key = id => JSON.stringify(obj(id));
const header = (meta, name) => (meta.all_headers.find(h => h[0] === name) || [])[1];

// Packs [x,y,z,qx,qy,qz,qw] per frame; returns validity mask.
function packBodies(frames, out, extra) {
  const valid = new Uint8Array(frames.length);
  frames.forEach((f, i) => {
    const d = f && f.Data;
    if (!d) return;
    const { location: p, rotation: q } = d.rigid_body;
    out.set([p.x, p.y, p.z, q.x, q.y, q.z, q.w], i * 7);
    valid[i] = 1;
    extra?.(d, i);
  });
  return valid;
}

function pack(bytes) {
  const d = get_replay_frames_data(bytes);
  const fd = d.frame_data, meta = d.meta, T = fd.metadata_frames.length;
  const time = Float32Array.from(fd.metadata_frames, m => m.time);
  const clock = Int16Array.from(fd.metadata_frames, m => m.seconds_remaining ?? 0);
  const ball = new Float32Array(T * 7);
  const ballValid = packBodies(fd.ball_data.frames, ball);

  const stats = new Map([...meta.team_zero, ...meta.team_one].map(p => [key(p.remote_id), p]));
  const players = fd.players.map(([id, { frames }]) => {
    const body = new Float32Array(T * 7), boost = new Uint8Array(T), flags = new Uint8Array(T);
    let name, team0;
    const valid = packBodies(frames, body, (f, i) => {
      name ??= f.player_name; team0 ??= f.is_team_0;
      boost[i] = f.boost_amount;
      flags[i] = f.boost_active | f.jump_active << 1 | f.double_jump_active << 2 | f.dodge_active << 3 | f.powerslide_active << 4;
    });
    const s = stats.get(key(id));
    return {
      id: key(id), name: name ?? s?.name ?? '?', team: team0 === false || s?.stats?.Team === 1 ? 1 : 0,
      hitbox: s?.car_hitbox_family ?? 'Octane', body, valid, boost, flags,
    };
  }).sort((a, b) => a.team - b.team || a.name.localeCompare(b.name));
  const pIndex = new Map(players.map((p, i) => [p.id, i]));

  const padIndex = new Map(d.boost_pads.map((p, i) => [p.pad_id, i]));
  const pads = d.boost_pads.map(p => ({ big: p.size === 'Big', pos: [p.position.x, p.position.y, p.position.z], events: [] }));
  for (const e of d.boost_pad_events) {
    const pad = pads[padIndex.get(e.pad_id)];
    pad?.events.push([e.frame, e.kind === 'Available' ? 1 : 0]);
  }
  pads.forEach(p => p.events.sort((a, b) => a[0] - b[0]));

  const goals = d.goal_events.map(g => ({
    frame: g.frame, team: g.scoring_team_is_team_0 ? 0 : 1,
    player: players[pIndex.get(key(g.player))]?.name, score: [g.team_zero_score, g.team_one_score],
  }));
  const demos = d.demolish_infos.map(x => ({
    frame: x.frame, pos: [x.victim_location.x, x.victim_location.y, x.victim_location.z],
    attacker: pIndex.get(key(x.attacker)), victim: pIndex.get(key(x.victim)),
  }));

  const transfer = [time.buffer, clock.buffer, ball.buffer, ballValid.buffer,
    ...players.flatMap(p => [p.body.buffer, p.valid.buffer, p.boost.buffer, p.flags.buffer])];
  return [{
    T, time, clock, ball, ballValid, players, pads, goals, demos,
    info: {
      map: header(meta, 'MapName'), date: header(meta, 'Date'), name: header(meta, 'ReplayName'),
      playlist: meta.game_type?.game_type, teamSize: header(meta, 'TeamSize'),
    },
  }, transfer];
}

onmessage = async ({ data: bytes }) => {
  try {
    await ready;
    const [replay, transfer] = pack(new Uint8Array(bytes));
    postMessage({ replay }, transfer);
  } catch (e) {
    postMessage({ error: String(e?.message ?? e) });
  }
};

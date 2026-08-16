import { getActiveSkillUse, getPlayer, getPlayableCards, getTargetOptions, requiredDiscards } from "./engine";
import { heroOf, matchesActiveSkillCardFilter, type ActiveSkillEffect } from "./heroes";
import type { DingAiMove, DingCard, DingDifficulty, DingPlayer, DingState, IdentityId, PendingTrick, PlayerId } from "./types";

export interface DingIdentityBelief {
  readonly lord: number;
  readonly loyalist: number;
  readonly rebel: number;
  readonly renegade: number;
}

function exactBelief(identity: DingPlayer["identity"]): DingIdentityBelief {
  return {
    lord: identity === "lord" ? 1 : 0,
    loyalist: identity === "loyalist" ? 1 : 0,
    rebel: identity === "rebel" ? 1 : 0,
    renegade: identity === "renegade" ? 1 : 0,
  };
}

/** 从公开日志中提取的身份信号：护主、援救/援护主君都会被记住。 */
function actionIdentityClues(state: DingState, targetId: PlayerId): Pick<DingIdentityBelief, "loyalist" | "rebel" | "renegade"> {
  const target = getPlayer(state.players, targetId);
  const lord = publicLord(state);
  const clues = { loyalist: 0, rebel: 0, renegade: 0 };
  if (!lord) return clues;
  for (const entry of state.log) {
    if (entry.text.includes(`${target.displayName}弃置`) && entry.text.includes("护主")) clues.loyalist += 1.5;
    if (entry.text.includes(`${target.displayName}用「疗元」援救`) && entry.text.includes(lord.displayName)) clues.loyalist += 0.8;
    if (entry.text.includes(`${target.displayName}的「援护」生效`) && entry.text.includes(`${lord.displayName}回复`)) clues.loyalist += 0.7;
  }
  return clues;
}

/**
 * 轻量身份信念：观察者自己的身份、公开主君、已揭示身份、当前牌面压力
 * 与日志中的行动信号共同构成信念；不直接读取任何隐藏身份。
 */
export function identityBelief(
  state: DingState,
  observerId: PlayerId,
  targetId: PlayerId,
): DingIdentityBelief {
  const observer = getPlayer(state.players, observerId);
  const target = getPlayer(state.players, targetId);
  if (target.id === observer.id || target.revealed || !target.alive) return exactBelief(target.identity);

  const pressure = Math.max(0, target.hp / target.maxHp)
    + Math.min(1, target.hand.length / 6)
    + (target.equipment.weapon ? 0.15 : 0);
  const lord = 0;
  let loyalist = pressure * 0.25;
  let rebel = pressure * 0.25;
  let renegade = pressure * 0.25;

  if (observer.identity === "lord" || observer.identity === "loyalist") {
    rebel += 0.4;
    renegade += 0.28;
    loyalist += 0.08;
  } else if (observer.identity === "rebel") {
    loyalist += 0.4;
    renegade += 0.3;
  } else {
    rebel += 0.35;
    loyalist += 0.35;
  }

  const clues = actionIdentityClues(state, target.id);
  loyalist += clues.loyalist;
  rebel += clues.rebel;
  renegade += clues.renegade;

  const total = lord + loyalist + rebel + renegade;
  return { lord, loyalist: loyalist / total, rebel: rebel / total, renegade: renegade / total };
}

function publicLord(state: DingState): DingPlayer | undefined {
  return state.players.find((player) => player.revealed && player.identity === "lord");
}

/**
 * 从观察者视角衡量另一名角色是否是盟友。隐藏身份只通过公开行动形成的
 * identityBelief 参与计算，绝不直接读取目标的 identity。
 */
function allyConfidence(state: DingState, observerId: PlayerId, targetId: PlayerId): number {
  if (observerId === targetId) return 4;
  const observer = getPlayer(state.players, observerId);
  const target = getPlayer(state.players, targetId);
  const publicIdentity = target.revealed ? target.identity : undefined;

  if (observer.identity === "lord" || observer.identity === "loyalist") {
    if (publicIdentity === "lord") return 3;
    if (publicIdentity === "loyalist") return 2;
    if (publicIdentity) return -3;
    const belief = identityBelief(state, observerId, targetId);
    return belief.loyalist - belief.rebel - belief.renegade;
  }

  if (observer.identity === "rebel") {
    // 四席身份各一，叛锋没有同阵营角色；除了自己以外不存在可援助的盟友。
    return -3;
  }

  // 流谋没有盟友；对主君的阶段性保护在具体的濒死/锦囊决策中处理。
  return -2;
}

function helpfulTarget(
  state: DingState,
  actorId: PlayerId,
  options: readonly PlayerId[],
): PlayerId | undefined {
  return options
    .map((id) => ({ id, confidence: allyConfidence(state, actorId, id) }))
    .filter(({ confidence }) => confidence > 0)
    .sort((left, right) => right.confidence - left.confidence
      || getPlayer(state.players, left.id).hp - getPlayer(state.players, right.id).hp
      || getPlayer(state.players, left.id).hand.length - getPlayer(state.players, right.id).hand.length
      || left.id.localeCompare(right.id))[0]?.id;
}

function threatScore(state: DingState, observerId: PlayerId, targetId: PlayerId): number {
  const belief = identityBelief(state, observerId, targetId);
  const observer = getPlayer(state.players, observerId);
  const target = getPlayer(state.players, targetId);
  if (observer.identity === "lord" || observer.identity === "loyalist") {
    return belief.rebel + belief.renegade - belief.loyalist;
  }
  if (observer.identity === "rebel") {
    if (target.revealed && target.identity === "lord") return Number.POSITIVE_INFINITY;
    return target.hp + target.hand.length;
  }
  // 流谋的目标顺序：先减少其他非主君存活者，再在只剩主君时收掉主君。
  const lord = publicLord(state);
  const otherLiving = state.players.filter((player) => player.alive && player.id !== observer.id);
  const nonLordLiving = otherLiving.filter((player) => player.id !== lord?.id);
  if (target.revealed && target.identity === "lord") {
    return nonLordLiving.length === 0 ? 10 : -10;
  }
  if (nonLordLiving.length === 0) return -target.hp;
  return -target.hp - target.hand.length;
}

function tacticalTarget(state: DingState, actorId: PlayerId, options: readonly PlayerId[]): PlayerId | undefined {
  const actor = getPlayer(state.players, actorId);
  const lord = publicLord(state);
  const otherNonLordAlive = actor.identity === "renegade" && lord
    ? state.players.some((player) => player.alive && player.id !== actorId && player.id !== lord.id)
    : false;
  return options
    .filter((id) => !(otherNonLordAlive && id === lord?.id))
    .map((id) => ({ id, score: threatScore(state, actorId, id) }))
    .sort((left, right) => right.score - left.score
      || getPlayer(state.players, left.id).hp - getPlayer(state.players, right.id).hp
      || left.id.localeCompare(right.id))[0]?.id;
}

function chooseAiSkillTarget(
  state: DingState,
  actorId: PlayerId,
  targetIds: readonly PlayerId[],
  effectKind: ActiveSkillEffect["kind"],
): PlayerId | undefined {
  if (effectKind === "draw-target") {
    return helpfulTarget(state, actorId, targetIds);
  }
  return tacticalTarget(state, actorId, targetIds);
}

const DISCARD_PRIORITY: Readonly<Record<DingCard["type"], number>> = {
  strike: 0,
  dismantle: 1,
  snatch: 2,
  duel: 3,
  horde: 4,
  volley: 5,
  focus: 6,
  aid: 7,
  weapon: 8,
  "minus-horse": 8,
  "plus-horse": 9,
  armor: 10,
  grove: 10,
  probe: 10,
  "delay-play": 11,
  "delay-draw": 12,
  "delay-burn": 13,
  nullify: 14,
  evade: 15,
  salve: 16,
};

function cardType(card: DingCard): DingCard["type"] {
  return card.type;
}

function sortForDiscard(cards: readonly DingCard[]): DingCard[] {
  return [...cards].sort((left, right) =>
    DISCARD_PRIORITY[cardType(left)] - DISCARD_PRIORITY[cardType(right)]
    || left.id.localeCompare(right.id),
  );
}

function topTrickFrame(state: DingState): PendingTrick | undefined {
  const top = state.stack.at(-1);
  return top?.kind === "trick" ? top : undefined;
}

function weakestTarget(state: DingState, options: readonly PlayerId[]): PlayerId | undefined {
  return options
    .map((id) => getPlayer(state.players, id))
    .sort((left, right) =>
      left.hp - right.hp
      || left.hand.length - right.hand.length
      || left.seat - right.seat,
    )[0]?.id;
}

function chooseStrikeTarget(
  state: DingState,
  actorId: PlayerId,
  card: DingCard,
  difficulty: DingDifficulty,
): PlayerId | undefined {
  const actor = getPlayer(state.players, actorId);
  const options = getTargetOptions(state, actorId, card);
  if (options.length === 0) return undefined;
  const useBelief = difficulty !== "relaxed";
  const bestId = useBelief
    ? tacticalTarget(state, actorId, options)
    : weakestTarget(state, options);
  if (!bestId) return undefined;
  const best = getPlayer(state.players, bestId);
  // AI 不读取其他角色的隐藏身份，只按体力和手牌压力施压；残局时
  // 不再囤刺击，避免双方互相回血造成极长拉锯。
  const livingCount = state.players.filter((entry) => entry.alive).length;
  const strikesInHand = actor.hand.filter((entry) => entry.type === "strike").length;
  if (difficulty === "relaxed") {
    return (best.hp <= 2 || livingCount <= 3 || strikesInHand >= 2)
      && (state.revision + actorId.length + bestId.length) % 2 === 0
      ? best.id
      : undefined;
  }
  const pressure = best.hp <= 2 || strikesInHand >= 2 || livingCount <= 3
    || (difficulty === "standard" && (actor.hand.length >= 4 || actor.hp >= 3))
    || (difficulty === "tactician" && actor.hand.length >= 3);
  return pressure ? best.id : undefined;
}

export function chooseAiMove(
  state: DingState,
  actorId: PlayerId,
  difficulty: DingDifficulty = state.difficulty,
): DingAiMove {
  const actor = getPlayer(state.players, actorId);
  if (state.status !== "playing" || state.phase !== "play" || state.stack.length > 0 || state.activePlayerId !== actorId) return { kind: "end" };
  const playable = getPlayableCards(state, actorId);
  const useBelief = difficulty !== "relaxed";

  const skillUse = getActiveSkillUse(state, actorId);
  if (skillUse) {
    const { skill } = skillUse;
    if (skill.target === "wounded") {
      const targetId = helpfulTarget(state, actorId, skillUse.targetIds);
      if (targetId && (difficulty !== "relaxed" || skill.cost.kind === "none" || targetId === actorId)) {
        return { kind: "skill", skillId: skill.id };
      }
    } else if (skill.target === "other") {
      const targetId = chooseAiSkillTarget(state, actorId, skillUse.targetIds, skill.effect.kind);
      if (targetId && (difficulty !== "relaxed" || skill.cost.kind === "none")) {
        return { kind: "skill", skillId: skill.id };
      }
    } else if (difficulty === "relaxed") {
      if (skill.cost.kind === "none") return { kind: "skill", skillId: skill.id };
    } else if (skill.cost.kind === "none") {
      return { kind: "skill", skillId: skill.id };
    } else if (skill.effect.kind === "draw" || skill.effect.kind === "draw-discard") {
      if (actor.hand.length <= 5) return { kind: "skill", skillId: skill.id };
    } else if (skill.effect.kind === "buff") {
      const enemiesAlive = state.players.some((player) => player.id !== actor.id && player.alive);
      if (skill.id === "pojun") {
        if (actor.hand.filter((card) => card.type === "strike").length >= 2) return { kind: "skill", skillId: skill.id };
      } else if (skill.id === "pojian") {
        if (actor.hand.filter((card) => card.type === "strike").length >= 2) return { kind: "skill", skillId: skill.id };
      } else if (skill.id === "jianbi") {
        if (actor.hp <= 3 || actor.hand.length >= 4) return { kind: "skill", skillId: skill.id };
      } else if (enemiesAlive && actor.hand.length >= 3) {
        return { kind: "skill", skillId: skill.id };
      }
    } else if (skill.effect.kind === "reset-strike") {
      if (actor.hand.filter((card) => card.type === "strike").length >= 2) return { kind: "skill", skillId: skill.id };
    }
  }

  const salve = playable.find((card) => card.type === "salve" && actor.hp < actor.maxHp);
  if (salve) return { kind: "play", cardUid: salve.id, targetId: actor.id };

  const aid = playable.find((card) => card.type === "aid");
  if (aid) {
    const options = getTargetOptions(state, actorId, aid);
    const targetId = helpfulTarget(state, actorId, options);
    if (targetId) return { kind: "play", cardUid: aid.id, targetId };
  }

  const focus = playable.find((card) => card.type === "focus");
  if (focus && actor.hand.length <= 5) return { kind: "play", cardUid: focus.id, targetId: actor.id };

  const grove = playable.find((card) => card.type === "grove");
  if (grove) {
    const lord = publicLord(state);
    const canHelpLord = actor.identity === "lord" || actor.identity === "loyalist";
    const lordWounded = Boolean(lord?.alive && lord.hp < lord.maxHp);
    if (actor.hp < actor.maxHp || (canHelpLord && lordWounded)) {
      return { kind: "play", cardUid: grove.id, targetId: actor.id };
    }
  }

  const equipment = playable.find((card) => card.type === "weapon" || card.type === "armor" || card.type === "minus-horse" || card.type === "plus-horse");
  if (equipment) return { kind: "play", cardUid: equipment.id, targetId: actor.id };

  const probe = playable.find((card) => card.type === "probe");
  if (probe) {
    const options = getTargetOptions(state, actorId, probe);
    const targetId = difficulty === "relaxed"
      ? options[0]
      : options
        .map((id) => ({ id, belief: identityBelief(state, actorId, id) }))
        .sort((left, right) =>
          Math.max(right.belief.loyalist, right.belief.rebel, right.belief.renegade)
          - Math.max(left.belief.loyalist, left.belief.rebel, left.belief.renegade)
          || left.id.localeCompare(right.id),
        )[0]?.id;
    if (targetId) return { kind: "play", cardUid: probe.id, targetId };
  }

  const duel = playable.find((card) => card.type === "duel");
  if (duel) {
    const options = getTargetOptions(state, actorId, duel);
    const targetId = useBelief
      ? tacticalTarget(state, actorId, options)
      : weakestTarget(state, options);
    const target = targetId ? getPlayer(state.players, targetId) : undefined;
    const strikesInHand = actor.hand.filter((card) => card.type === "strike").length;
    if (target && (target.hp <= 2 || strikesInHand >= 2 || difficulty === "tactician")) {
      return { kind: "play", cardUid: duel.id, targetId: target.id };
    }
  }

  // 叛锋与流谋更愿意把局面搅乱；主君方不使用无差别群体牌。
  if (actor.identity === "rebel" || actor.identity === "renegade") {
    const othersAlive = state.players.filter((player) => player.id !== actor.id && player.alive);
    const lord = actor.identity === "renegade" ? publicLord(state) : undefined;
    const wouldEndForRebels = Boolean(lord && lord.hp <= 1
      && othersAlive.some((player) => player.id !== lord.id));
    if (othersAlive.length >= 2 && !wouldEndForRebels) {
      const horde = playable.find((card) => card.type === "horde");
      if (horde) return { kind: "play", cardUid: horde.id, targetId: actor.id };
      const volley = playable.find((card) => card.type === "volley");
      if (volley) return { kind: "play", cardUid: volley.id, targetId: actor.id };
    }
  }

  const dismantle = playable.find((card) => card.type === "dismantle");
  if (dismantle) {
    const options = getTargetOptions(state, actorId, dismantle);
    const targetId = useBelief
      ? tacticalTarget(state, actorId, options)
      : options.find((id) => getPlayer(state.players, id).hand.length >= 3) ?? options[0];
    if (targetId) return { kind: "play", cardUid: dismantle.id, targetId };
  }

  const snatch = playable.find((card) => card.type === "snatch");
  if (snatch) {
    const options = getTargetOptions(state, actorId, snatch);
    const targetId = useBelief
      ? tacticalTarget(state, actorId, options)
      : options[0];
    if (targetId) return { kind: "play", cardUid: snatch.id, targetId };
  }

  const delayed = playable.find((card) => card.type === "delay-play" || card.type === "delay-draw" || card.type === "delay-burn");
  if (delayed) {
    const options = getTargetOptions(state, actorId, delayed);
    const targetId = useBelief
      ? tacticalTarget(state, actorId, options)
      : options[0];
    if (targetId) return { kind: "play", cardUid: delayed.id, targetId };
  }

  const strike = playable.find((card) => card.type === "strike");
  if (strike) {
    const targetId = chooseStrikeTarget(state, actorId, strike, difficulty);
    if (targetId) return { kind: "play", cardUid: strike.id, targetId };
  }

  return { kind: "end" };
}

export function chooseAiStrikeResponse(
  state: DingState,
  responderId: PlayerId,
  difficulty: DingDifficulty = state.difficulty,
): string | undefined {
  const pending = state.stack.at(-1);
  if (pending?.kind === "strike" && pending.unavoidable) return undefined;
  const responder = getPlayer(state.players, responderId);
  const evade = responder.hand.find((card) => card.type === "evade");
  if (!evade) return undefined;
  if (responder.hp <= 1) return evade.id;
  if (difficulty === "tactician") return responder.hp <= 2 ? evade.id : undefined;
  if (difficulty === "relaxed") return (state.revision + responderId.length) % 3 === 0 ? evade.id : undefined;
  const deterministic = (state.revision + responderId.length) % 4 === 0;
  return deterministic ? evade.id : undefined;
}

export function chooseAiDyingResponse(state: DingState, responderId: PlayerId): string | undefined {
  const pending = state.stack.at(-1);
  if (!pending || pending.kind !== "dying" || pending.responders[pending.cursor] !== responderId) return undefined;
  const responder = getPlayer(state.players, responderId);
  const salve = responder.hand.find((card) => card.type === "salve");
  if (!salve) return undefined;
  if (pending.targetId === responderId) return salve.id;

  const target = getPlayer(state.players, pending.targetId);
  if (responder.identity === "renegade") {
    const lord = publicLord(state);
    if (target.id !== lord?.id) return undefined;
    // 主君过早退场会令叛锋立即获胜；只剩流谋与主君时则应让主君倒下。
    const thirdPartyAlive = state.players.some((player) =>
      player.alive && player.id !== responderId && player.id !== target.id,
    );
    return thirdPartyAlive ? salve.id : undefined;
  }

  return allyConfidence(state, responderId, target.id) > 0 ? salve.id : undefined;
}

export function chooseAiDuelResponse(
  state: DingState,
  responderId: PlayerId,
  difficulty: DingDifficulty = state.difficulty,
): string | undefined {
  const responder = getPlayer(state.players, responderId);
  const strike = responder.hand.find((card) => card.type === "strike");
  if (!strike) return undefined;
  if (difficulty === "relaxed" && responder.hand.length <= 2) return undefined;
  return strike.id;
}

export function chooseAiHordeResponse(
  state: DingState,
  responderId: PlayerId,
  difficulty: DingDifficulty = state.difficulty,
): string | undefined {
  const responder = getPlayer(state.players, responderId);
  const strike = responder.hand.find((card) => card.type === "strike");
  if (!strike) return undefined;
  if (difficulty === "tactician") return responder.hp <= 3 || responder.hand.length >= 3 ? strike.id : undefined;
  if (difficulty === "relaxed") return responder.hp <= 1 ? strike.id : undefined;
  // 有富余时保留刺击也没意义：合围只消耗一张，挨一下通常更亏。
  if (responder.hp <= 2 || responder.hand.length >= 4) return strike.id;
  const deterministic = (state.revision + responderId.length) % 3 === 0;
  return deterministic ? strike.id : undefined;
}

export function chooseAiVolleyResponse(
  state: DingState,
  responderId: PlayerId,
  difficulty: DingDifficulty = state.difficulty,
): string | undefined {
  return chooseAiStrikeResponse(state, responderId, difficulty);
}

/**
 * 辅臣护主决策：主君会被这一击击退时必救；否则见习档倾向不暴露身份，
 * 标准档只在主君残血或自己手牌富余时出手，战术档更愿意弃低价值牌护主。
 */
export function chooseAiProtectResponse(
  state: DingState,
  protectorId: PlayerId,
  difficulty: DingDifficulty = state.difficulty,
): string | undefined {
  const pending = state.stack.at(-1);
  if (!pending || pending.kind !== "protect" || pending.protectorId !== protectorId) return undefined;
  const protector = getPlayer(state.players, protectorId);
  const lord = getPlayer(state.players, pending.targetId);
  const card = sortForDiscard(protector.hand)[0];
  if (!card) return undefined;
  if (lord.hp <= pending.damage) return card.id;
  if (difficulty === "relaxed") return undefined;
  if (difficulty === "standard") {
    return lord.hp <= 2 || protector.hand.length >= 4 ? card.id : undefined;
  }
  return card.id;
}

export function chooseAiProbeGuess(
  state: DingState,
  actorId: PlayerId,
): IdentityId | undefined {
  const pending = state.stack.at(-1);
  if (!pending || pending.kind !== "probe" || pending.actorId !== actorId) return undefined;
  const target = getPlayer(state.players, pending.targetId);
  if (target.revealed) return target.identity;
  const belief = identityBelief(state, actorId, target.id);
  const candidates: IdentityId[] = ["loyalist", "rebel", "renegade"];
  return candidates
    .sort((left, right) => belief[right] - belief[left] || left.localeCompare(right))[0];
}

/** 选择主动技消耗与目标。当前所有主动技只使用公开信息与自身阵营判断。 */
export function chooseAiSkillDecision(
  state: DingState,
  responderId: PlayerId,
): { readonly cardUid?: string; readonly targetId?: PlayerId } | undefined {
  const pending = state.stack.at(-1);
  if (!pending || pending.kind !== "skill" || pending.ownerId !== responderId) return undefined;
  const owner = getPlayer(state.players, responderId);
  const skill = heroOf(owner)?.activeSkill;
  if (!skill || skill.id !== pending.skillId) return undefined;

  const chooseCost = () => {
    if (skill.cost.kind === "none") return undefined;
    const filter = skill.cost.kind === "discard" ? skill.cost.filter : undefined;
    return sortForDiscard(owner.hand.filter((card) => matchesActiveSkillCardFilter(card, filter)))[0];
  };

  if (skill.target === "self") {
    const costCard = chooseCost();
    if (skill.cost.kind === "discard" && !costCard) return undefined;
    return costCard ? { cardUid: costCard.id } : {};
  }

  const costCard = chooseCost();
  if (skill.cost.kind === "discard" && !costCard) return undefined;
  const targetIds = [...pending.targetIds];
  const self = targetIds.find((id) => id === owner.id);
  if (self) return { cardUid: costCard?.id, targetId: self };

  if (skill.target === "other") {
    const targetId = chooseAiSkillTarget(state, owner.id, targetIds, skill.effect.kind);
    return targetId ? { cardUid: costCard?.id, targetId } : undefined;
  }

  const targetId = helpfulTarget(state, owner.id, targetIds);
  return targetId ? { cardUid: costCard?.id, targetId } : undefined;
}

function effectRelationScore(state: DingState, observerId: PlayerId, targetId: PlayerId): number {
  const observer = getPlayer(state.players, observerId);
  const target = getPlayer(state.players, targetId);
  const lord = publicLord(state);
  if (observer.identity === "renegade" && target.id === lord?.id) {
    const thirdPartyAlive = state.players.some((player) =>
      player.alive && player.id !== observerId && player.id !== targetId,
    );
    return thirdPartyAlive ? 1 : -2;
  }
  return allyConfidence(state, observerId, targetId);
}

const BENEFICIAL_TRICKS: ReadonlySet<PendingTrick["cardType"]> = new Set(["focus", "grove", "aid"]);
const TERMINAL_TRICK_VALUE = 100;

/** 正数表示希望锦囊生效，负数表示希望它被无懈抵消。 */
function trickValue(
  state: DingState,
  observerId: PlayerId,
  frame: PendingTrick,
  visited: ReadonlySet<number> = new Set(),
): number {
  if (visited.has(frame.frameId)) return 0;
  const nextVisited = new Set(visited).add(frame.frameId);
  if (frame.cardType === "nullify") {
    const target = state.stack.find((entry) =>
      entry.kind === "trick" && entry.frameId === frame.counterFrameId,
    );
    return target?.kind === "trick" ? -trickValue(state, observerId, target, nextVisited) : 0;
  }

  if (frame.cardType === "horde" || frame.cardType === "volley") {
    const observer = getPlayer(state.players, observerId);
    const lord = publicLord(state);
    const wouldDefeatLord = Boolean(lord?.alive && lord.hp <= 1 && frame.actorId !== lord.id);
    if (wouldDefeatLord && observer.identity === "rebel") return TERMINAL_TRICK_VALUE;
    if (wouldDefeatLord && observer.identity === "renegade" && lord) {
      const thirdPartyAlive = state.players.some((player) =>
        player.alive && player.id !== observerId && player.id !== lord.id,
      );
      return thirdPartyAlive ? -TERMINAL_TRICK_VALUE : TERMINAL_TRICK_VALUE;
    }
  }

  // 聚势、同袍和援护是主动施放的收益牌，使用者不会反过来抵消自己。
  if (frame.actorId === observerId && BENEFICIAL_TRICKS.has(frame.cardType)) return 5;

  const actorValue = effectRelationScore(state, observerId, frame.actorId);
  if (frame.cardType === "focus") return actorValue;
  if (frame.cardType === "aid") {
    return frame.targetId ? effectRelationScore(state, observerId, frame.targetId) : actorValue;
  }
  if (frame.cardType === "grove") {
    return state.players
      .filter((player) => player.alive && player.hp < player.maxHp)
      .reduce((total, player) => total + effectRelationScore(state, observerId, player.id), 0);
  }
  if (frame.cardType === "probe") {
    const targetValue = frame.targetId ? effectRelationScore(state, observerId, frame.targetId) : 0;
    return actorValue - targetValue;
  }
  if (frame.cardType === "horde" || frame.cardType === "volley") {
    const exposedValue = state.players
      .filter((player) => player.alive && player.id !== frame.actorId)
      .reduce((total, player) => total + effectRelationScore(state, observerId, player.id), 0);
    return actorValue - exposedValue;
  }
  if (frame.targetId) {
    return actorValue - effectRelationScore(state, observerId, frame.targetId);
  }
  return 0;
}

/**
 * 无懈可击按锦囊对自己的公开阵营收益判断；反制链会递归翻转原锦囊的
 * 收益，因此既不会抵消友方援护，也会保护被敌方无懈命中的有益牌。
 */
export function chooseAiNullifyResponse(
  state: DingState,
  responderId: PlayerId,
  difficulty: DingDifficulty = state.difficulty,
): string | undefined {
  const top = topTrickFrame(state);
  if (!top || !top.awaitingResponse || top.responders[top.cursor] !== responderId) return undefined;
  const responder = getPlayer(state.players, responderId);
  const nullify = responder.hand.find((card) => card.type === "nullify");
  if (!nullify) return undefined;

  if (trickValue(state, responderId, top) >= 0) return undefined;
  if (difficulty === "relaxed" && top.cardType !== "nullify" && top.targetId !== responderId) return undefined;
  return nullify.id;
}

export function chooseAiDiscards(state: DingState, actorId: PlayerId): string[] {
  const actor = getPlayer(state.players, actorId);
  const required = requiredDiscards(state, actorId);
  if (required <= 0) return [];
  return sortForDiscard(actor.hand)
    .slice(0, required)
    .map((card) => card.id);
}

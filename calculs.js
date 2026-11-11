/* ==========================================================================
   Budget Intérim · calculs (sans interface, sans Firebase)
   --------------------------------------------------------------------------
   Toutes les règles de calcul belges sont ici : impôt (IPP), ONSS, bonus à
   l'emploi, prime de fin d'année, pécule de vacances, bilan fiscal.
   Ces fonctions ne touchent ni à la page ni aux données en ligne : elles
   reçoivent des valeurs et renvoient un résultat. C'est ce qui permet de les
   tester automatiquement (dossier tests/, commande : npm test).
   ========================================================================== */

/* ---------- outils ---------- */
/** Texte en minuscules sans accents (pour comparer des libellés). */
export const nrm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
/** Somme d'un tableau selon une fonction ; les valeurs non numériques comptent 0. */
export const sum = (a, f) => a.reduce((t, x) => t + (+f(x) || 0), 0);

/* ---------- ONSS ---------- */
export const ONSS = { taux: 0.1307, baseOuvrier: 1.08 };
/** ONSS personnel attendu sur un brut : 13,07 %, sur 108 % du brut pour un ouvrier. */
export const onssAttendu = (brut, ouvrier = true) => (+brut || 0) * ONSS.taux * (ouvrier ? ONSS.baseOuvrier : 1);
/**
 * Contrôle de l'ONSS retenu sur une fiche de paie.
 * "haut" = plus que le taux normal, "bas" = nettement moins (bonus à l'emploi), "ok" sinon.
 * On accepte les deux bases (108 % et 100 %) parce que les agences ne l'indiquent pas toujours.
 */
export function verifOnss(montant, brut, ouvrier = true) {
  const att = onssAttendu(brut, ouvrier), att2 = onssAttendu(brut, false);
  if (montant > Math.max(att, att2) * 1.04 + 2) return { etat: "haut", attendu: att };
  if (montant < Math.min(att, att2) * 0.9 - 2) return { etat: "bas", attendu: att };
  return { etat: "ok", attendu: att };
}

/* ---------- prime de fin d'année (Fonds social des intérimaires) ---------- */
export const PRIME = { jours: 65, heures: 494, pct: 0.0833, netApprox: 0.66 };
/** Droit à la prime sur la période 1/7 → 30/6 : 65 jours OU 494 heures ; prime = 8,33 % du brut. */
export function primeFinAnnee({ jours = 0, heures = 0, brut = 0 } = {}) {
  const okJ = jours >= PRIME.jours, okH = heures >= PRIME.heures;
  return {
    ok: okJ || okH, okJ, okH,
    progression: Math.min(100, Math.max(jours / PRIME.jours, heures / PRIME.heures) * 100),
    joursManquants: Math.max(0, PRIME.jours - jours), heuresManquantes: Math.max(0, PRIME.heures - heures),
    brut: brut * PRIME.pct, net: brut * PRIME.pct * PRIME.netApprox
  };
}

/* ---------- pécule de vacances ---------- */
export const PECULE = { ouvrier: 0.1538, employe: 0.1534 };
/** Pécule d'un ouvrier (ONVA) : 15,38 % du brut de l'année précédente porté à 108 %. */
export const peculeOuvrier = brut => (+brut || 0) * ONSS.baseOuvrier * PECULE.ouvrier;

/* ---------- impôt des personnes physiques (IPP) ---------- */
// Paramètres IPP revenus 2025 (exercice 2026). Revalorisés chaque année d'environ 2 % : l'estimation reste proche.
export const IPP = {
  tranches: [[16320, .25], [28800, .40], [49840, .45], [Infinity, .50]], quotite: 10910, fraisPct: .30, fraisMax: 5930,
  enfants: [0, 1980, 5110, 11440, 18510], enfantSuivant: 7070,   // supplément de quotité exemptée (cumulé) pour 0, 1, 2, 3, 4 enfants, puis par enfant en plus
  parentSeul: 1980, enfantMoins3: 750, quotientPct: .30, quotientMax: 13470,
  // plafond de ressources nettes pour rester à charge de ses parents (approximatif, revenus 2025) : parents ensemble / parent seul
  chargeParents: 3950, chargeParentSeul: 5700,
  // bonus à l'emploi fiscal = réduction d'impôt de 33,14 % du bonus à l'emploi social (volet A ; 52,54 % pour le volet B), plafonnée (approximatif)
  bonusFiscPct: .3314, bonusFiscMax: 1120
};
/** Impôt selon le barème progressif, sans quotité exemptée. */
export function bareme(r) { let prev = 0, t = 0; for (const [lim, taux] of IPP.tranches) { if (r > prev) t += (Math.min(r, lim) - prev) * taux; prev = lim } return t }
/** Frais professionnels forfaitaires : 30 % plafonnés. */
export const fraisForf = imp => Math.min(Math.max(0, imp) * IPP.fraisPct, IPP.fraisMax);
/** Supplément de quotité exemptée pour n enfants à charge (montant cumulé). */
export function supplEnfants(n) { n = Math.max(0, Math.floor(+n || 0)); return n <= 4 ? IPP.enfants[n] : IPP.enfants[4] + (n - 4) * IPP.enfantSuivant }
/** Impôt d'une personne : barème sur le revenu net, moins l'impôt sur sa quotité exemptée (limitée au revenu). */
export function impotPersonne(net, quotite) { return Math.max(0, bareme(net) - bareme(Math.min(net, quotite))) }
/**
 * Impôt du foyer. R = situation : fiscSit "isole" | "parents" | "couple", fiscEnf (enfants à charge), fiscEnf3 (dont moins de 3 ans),
 * fiscConj (brut imposable annuel du conjoint, après ONSS), fiscCommune (taxe communale en %).
 * bonusSocial = bonus à l'emploi social de l'année (réduction ONSS), qui donne droit au bonus fiscal.
 */
export function impotBelge(imposable, R = {}, bonusSocial = 0) {
  const couple = R.fiscSit === "couple", nEnf = Math.max(0, +R.fiscEnf || 0), n3 = Math.min(nEnf, Math.max(0, +R.fiscEnf3 || 0));
  const communal = (R.fiscCommune === "" || R.fiscCommune == null ? 7 : +R.fiscCommune) / 100;
  const frais = fraisForf(imposable); let net = Math.max(0, imposable - frais);
  const conjImp = couple ? Math.max(0, +R.fiscConj || 0) : 0, fraisC = fraisForf(conjImp); let netC = Math.max(0, conjImp - fraisC);
  // quotient conjugal : le conjoint qui gagne le moins reçoit jusqu'à 30 % des revenus du couple (plafonné)
  let quotient = 0;
  if (couple) {
    const tot = net + netC, bas = Math.min(net, netC); quotient = Math.max(0, Math.min(IPP.quotientPct * tot - bas, IPP.quotientMax));
    if (quotient) { if (net >= netC) { net -= quotient; netC += quotient } else { netC -= quotient; net += quotient } }
  }
  // suppléments pour enfants (+ parent seul) : au conjoint qui a le plus de revenus
  const suppl = supplEnfants(nEnf) + n3 * IPP.enfantMoins3 + (!couple && nEnf ? IPP.parentSeul : 0);
  const moiPlus = !couple || net >= netC;
  const qMoi = IPP.quotite + (moiPlus ? suppl : 0), qConj = IPP.quotite + (moiPlus ? 0 : suppl);
  let tMoi = impotPersonne(net, qMoi); const tConj = couple ? impotPersonne(netC, qConj) : 0;
  const bonusFisc = Math.min(Math.max(0, +bonusSocial || 0) * IPP.bonusFiscPct, IPP.bonusFiscMax, tMoi); tMoi -= bonusFisc;
  const base = tMoi + tConj;
  // supplément de quotité non utilisé faute de revenus (crédit d'impôt remboursable pour enfants, non calculé ici)
  const perdu = !!suppl && ((moiPlus ? net : netC) < (moiPlus ? qMoi : qConj));
  return { frais, fraisC, net: Math.max(0, imposable - frais), netC: couple ? Math.max(0, conjImp - fraisC) : 0, quotient, suppl, base, communal: base * communal, communalPct: communal, total: base * (1 + communal), couple, nEnf, perdu, bonusFisc };
}

/** À charge de ses parents ? ressources nettes = brut imposable − frais forfaitaires, comparées au plafond. */
export function chargeParents(imposable, parentSeul = false) {
  const ressources = Math.max(0, imposable - fraisForf(imposable)), plafond = parentSeul ? IPP.chargeParentSeul : IPP.chargeParents;
  return { ressources, plafond, depasse: ressources > plafond, reste: Math.max(0, plafond - ressources) };
}

/* ---------- bilan fiscal d'une année ---------- */
export const RX_ONSS = /onss|rsz|cotis.*(soc|pers)|securite sociale|sec\.? ?soc/, RX_PP = /precompte|voorheffing|bedrijfsvoorh|impot|prof\.? ?voorh/;
export const RX_BONUS = /bonus.{0,6}emploi|werkbonus|bas(ses)? salaires?/;
/**
 * Bilan d'une année à partir de l'état S de l'appli (paies, missions, fiches281, reglages).
 * Les fiches 281.10 de l'année, si elles existent, remplacent les fiches de paie (chiffres officiels).
 */
export function bilanFiscal(S, y) {
  const R = S.reglages || {}, P = (S.paies || []).filter(p => !p.autre && (p.date || "").startsWith(y));
  const ouv = (R.statut || "ouvrier") === "ouvrier";
  let brut = 0, onss = 0, pp = 0, net = 0, nDet = 0, nEst = 0, nSans = 0, bonusP = 0;
  P.forEach(p => {
    net += +p.montant || 0; const d = p.detail;
    if (!d || !+d.brut) { nSans++; return }
    const L = Array.isArray(d.lignes) ? d.lignes : [], ret = L.filter(l => l.type === "retenue");
    let on = ret.filter(l => RX_ONSS.test(nrm(l.libelle))).reduce((t, l) => t + (+l.montant || 0), 0);
    const pr = ret.filter(l => RX_PP.test(nrm(l.libelle))).reduce((t, l) => t + (+l.montant || 0), 0);
    const bl = L.filter(l => RX_BONUS.test(nrm(l.libelle))).reduce((t, l) => t + (+l.montant || 0), 0);
    const att = onssAttendu(d.brut, ouv);
    brut += +d.brut;
    if (on) {
      if (bl && on >= att * .97) { on = Math.max(0, on - bl); bonusP += bl }   // ONSS plein + ligne « bonus à l'emploi » à part
      else if (bl) bonusP += bl;                                               // ONSS déjà réduit, bonus affiché pour info
      else if (on < att * .97) bonusP += att - on;                             // ONSS plus bas que 13,07 % = bonus à l'emploi
      onss += on; nDet++
    }
    else { onss += att; nEst++ }
    pp += pr
  });
  // fiches 281.10 de l'année : chiffres officiels, prioritaires sur les fiches de paie
  const F = (S.fiches281 || []).filter(f => String(f.annee) === String(y)), src = F.length ? "281" : "paies";
  const imposable = src === "281" ? sum(F, f => (+f.remu || 0) + (+f.autres || 0)) : brut - onss;
  const ppMoi = src === "281" ? sum(F, f => f.pp) : pp, bonusSocial = src === "281" ? sum(F, f => f.bonus) : bonusP;
  const ipp = impotBelge(imposable, R, bonusSocial);
  const ppConj = ipp.couple ? Math.max(0, +R.fiscConjPP || 0) : 0;
  // agences avec des paies cette année mais sans fiche 281.10
  const mot = x => nrm(x).replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(w => w.length > 2);
  const agences = [...new Set(P.map(p => ((S.missions || []).find(m => m.id === p.mission) || {}).agence).filter(Boolean))];
  const manquantes = F.length ? agences.filter(a => !F.some(f => mot(a).some(w => mot(f.employeur).includes(w)))) : [];
  return { P, F, src, brut, onss, pp: ppMoi, ppConj, net, nDet, nEst, nSans, imposable, ipp, bonusSocial, manquantes, solde: ppMoi + ppConj - ipp.total };
}

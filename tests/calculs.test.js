// Tests automatiques des calculs de l'appli. Lancer : npm test (ou node --test)
// Rien à installer : on utilise le testeur intégré à Node.js.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  nrm, sum, onssAttendu, verifOnss, primeFinAnnee, peculeOuvrier,
  IPP, bareme, fraisForf, supplEnfants, impotBelge, chargeParents, bilanFiscal
} from "../calculs.js";

const proche = (reel, attendu, marge = 0.5, msg) =>
  assert.ok(Math.abs(reel - attendu) <= marge, `${msg || ""} attendu ≈ ${attendu}, obtenu ${reel}`);

describe("outils", () => {
  test("nrm enlève accents et majuscules", () => {
    assert.equal(nrm("  Précompte Professionnel "), "precompte professionnel");
    assert.equal(nrm(null), "");
  });
  test("sum ignore les valeurs vides", () => {
    assert.equal(sum([{ v: 2 }, { v: "3" }, { v: null }, {}], x => x.v), 5);
  });
});

describe("ONSS", () => {
  test("13,07 % sur 108 % du brut pour un ouvrier, 13,07 % pour un employé", () => {
    proche(onssAttendu(1000, true), 141.156, 0.001);
    proche(onssAttendu(1000, false), 130.7, 0.001);
  });
  test("contrôle d'une fiche : normal, trop haut, bonus à l'emploi", () => {
    assert.equal(verifOnss(141.16, 1000, true).etat, "ok");
    assert.equal(verifOnss(130.70, 1000, true).etat, "ok"); // base 100 % acceptée aussi
    assert.equal(verifOnss(170, 1000, true).etat, "haut");
    assert.equal(verifOnss(80, 1000, true).etat, "bas");
  });
});

describe("prime de fin d'année", () => {
  test("droit ouvert avec 65 jours ou 494 heures", () => {
    assert.equal(primeFinAnnee({ jours: 65, heures: 0 }).ok, true);
    assert.equal(primeFinAnnee({ jours: 10, heures: 494 }).ok, true);
    assert.equal(primeFinAnnee({ jours: 64, heures: 493 }).ok, false);
  });
  test("prime = 8,33 % du brut, progression plafonnée à 100 %", () => {
    const p = primeFinAnnee({ jours: 100, heures: 700, brut: 20000 });
    proche(p.brut, 1666, 0.01);
    assert.equal(p.progression, 100);
    assert.equal(primeFinAnnee({ jours: 13, heures: 0 }).joursManquants, 52);
  });
});

describe("pécule de vacances (ouvrier)", () => {
  test("15,38 % du brut porté à 108 %", () => {
    proche(peculeOuvrier(20000), 3322.08, 0.01);
    assert.equal(peculeOuvrier(0), 0);
  });
});

describe("impôt (IPP)", () => {
  test("barème progressif", () => {
    assert.equal(bareme(0), 0);
    assert.equal(bareme(16320), 4080);
    proche(bareme(19070), 5180, 0.01);
  });
  test("frais forfaitaires : 30 %, plafonnés", () => {
    assert.equal(fraisForf(10000), 3000);
    assert.equal(fraisForf(100000), IPP.fraisMax);
    assert.equal(fraisForf(-5), 0);
  });
  test("supplément pour enfants", () => {
    assert.equal(supplEnfants(0), 0);
    assert.equal(supplEnfants(2), 5110);
    assert.equal(supplEnfants(6), 18510 + 2 * 7070);
  });
  test("isolé, 25 000 € imposables, taxe communale 7 %", () => {
    proche(impotBelge(25000, {}).total, 2624.18, 0.01);
  });
  test("taxe communale à 0 %", () => {
    proche(impotBelge(25000, { fiscCommune: 0 }).total, 2452.5, 0.01);
  });
  test("pas d'impôt sous la quotité exemptée", () => {
    assert.equal(impotBelge(8000, {}).total, 0);
  });
  test("parent seul avec 2 enfants paie moins", () => {
    const r = impotBelge(25000, { fiscEnf: 2 });
    assert.equal(r.suppl, 5110 + IPP.parentSeul);
    proche(r.total, 457.96, 0.01);
  });
  test("couple : quotient conjugal quand le conjoint n'a pas de revenus", () => {
    const r = impotBelge(25000, { fiscSit: "couple", fiscConj: 0 });
    proche(r.quotient, 5721, 0.01);
    proche(r.total, 652.43, 0.01);
  });
  test("couple : pas de quotient quand les deux gagnent pareil", () => {
    const r = impotBelge(25000, { fiscSit: "couple", fiscConj: 25000 });
    assert.equal(r.quotient, 0);
    proche(r.total, 2 * 2624.18, 0.02);
  });
  test("revenus trop bas pour tout le supplément enfants : signalé", () => {
    assert.equal(impotBelge(12000, { fiscEnf: 3 }).perdu, true);
    assert.equal(impotBelge(40000, { fiscEnf: 1 }).perdu, false);
  });
  test("bonus à l'emploi fiscal : 33,14 % du bonus social, jamais plus que l'impôt ni le plafond", () => {
    const sans = impotBelge(18000, {}), avec = impotBelge(18000, {}, 900);
    proche(avec.bonusFisc, 298.26, 0.01);
    proche(avec.total, (sans.base - 298.26) * 1.07, 0.01);
    assert.equal(impotBelge(30000, {}, 10000).bonusFisc, IPP.bonusFiscMax);
    assert.equal(impotBelge(9000, {}, 900).bonusFisc, 0);
  });
});

describe("à charge des parents", () => {
  test("sous le plafond / au-dessus", () => {
    assert.equal(chargeParents(4000).depasse, false);
    assert.equal(chargeParents(9000).depasse, true);
    assert.equal(chargeParents(6500, true).depasse, false); // plafond plus haut pour un parent seul
  });
});

describe("bilan fiscal d'une année", () => {
  const fiche = (brut, lignes, mission = "m1") => ({ date: "2026-03-06", montant: brut * 0.8, mission, detail: { brut, lignes } });
  const base = () => ({
    reglages: { statut: "ouvrier" },
    missions: [{ id: "m1", agence: "Randstad" }, { id: "m2", agence: "Adecco" }],
    fiches281: [],
    paies: [
      fiche(2000, [{ libelle: "Cotisations ONSS", montant: 200, type: "retenue" }, { libelle: "Précompte professionnel", montant: 90, type: "retenue" }]),
      fiche(2000, [{ libelle: "ONSS 13,07 %", montant: 282.31, type: "retenue" }, { libelle: "Bonus à l'emploi", montant: 80, type: "gain" }, { libelle: "Précompte prof.", montant: 90, type: "retenue" }])
    ]
  });

  test("depuis les fiches de paie : ONSS, précompte et bonus à l'emploi retrouvés", () => {
    const b = bilanFiscal(base(), "2026");
    assert.equal(b.src, "paies");
    proche(b.brut, 4000, 0.001);
    proche(b.onss, 402.31, 0.01);
    proche(b.bonusSocial, 162.31, 0.01);
    assert.equal(b.pp, 180);
    proche(b.imposable, 3597.69, 0.01);
  });

  test("paie sans détail : comptée à part, pas dans le calcul", () => {
    const S = base(); S.paies.push({ date: "2026-04-01", montant: 500 });
    const b = bilanFiscal(S, "2026");
    assert.equal(b.nSans, 1);
    proche(b.brut, 4000, 0.001);
  });

  test("ONSS absent de la fiche : estimé", () => {
    const S = base(); S.paies = [fiche(1000, [])];
    const b = bilanFiscal(S, "2026");
    assert.equal(b.nEst, 1);
    proche(b.onss, 141.156, 0.001);
  });

  test("les fiches 281.10 remplacent les fiches de paie, agence manquante signalée", () => {
    const S = base();
    S.paies.push(fiche(600, [], "m2"));
    S.fiches281 = [{ id: "x", annee: 2026, employeur: "RANDSTAD BELGIUM SA", remu: 18000, autres: 0, pp: 1500, bonus: 900 }];
    const b = bilanFiscal(S, "2026");
    assert.equal(b.src, "281");
    assert.equal(b.imposable, 18000);
    assert.equal(b.pp, 1500);
    assert.deepEqual(b.manquantes, ["Adecco"]);
    proche(b.solde, 1500 - b.ipp.total, 0.001);
  });

  test("une fiche 281.10 d'une autre année ne compte pas", () => {
    const S = base(); S.fiches281 = [{ id: "x", annee: 2025, employeur: "Randstad", remu: 18000, pp: 1500 }];
    assert.equal(bilanFiscal(S, "2026").src, "paies");
  });

  test("couple : le précompte du conjoint compte dans le solde", () => {
    const S = base(); Object.assign(S.reglages, { fiscSit: "couple", fiscConj: 20000, fiscConjPP: 2500 });
    const b = bilanFiscal(S, "2026");
    assert.equal(b.ppConj, 2500);
    proche(b.solde, 180 + 2500 - b.ipp.total, 0.001);
  });
});

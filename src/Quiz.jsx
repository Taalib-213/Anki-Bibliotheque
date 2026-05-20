import { useState, useEffect, useMemo, useCallback, useRef } from 'react'

/* ============================================================
   Mode Quizz — vocabulaire arabe
   ------------------------------------------------------------
   - Charge dynamiquement le vocabulaire de tous les cours.
   - Génère des questions aléatoires à partir de 8 catégories :
       arabicFromNounTranslation, singular, plural,
       past, present, masdar, arabicFromVerbTranslation,
       harfJarr  ← spécial : 1+ bonnes réponses possibles
   - Pour chaque question : 1 bonne réponse + 7 distracteurs
     appartenant strictement à la même catégorie.
   - Permet de filtrer la SOURCE de la bonne réponse à un seul
     deck/cours (les distracteurs viennent toujours de tous).
   ============================================================ */

/* --- Helpers texte --- */
function hasText(v) {
  return typeof v === 'string' && v.trim() !== ''
}

// Mêmes règles que App.jsx : retire tachkīl arabe + accents latins.
// Utilisé pour comparer "إلى" et "إِلَى" comme le même harf jar.
const ARABIC_DIACRITICS = /[\u064B-\u0652\u0670\u0640]/g
function normalize(s) {
  if (!s) return ''
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(ARABIC_DIACRITICS, '')
    .trim()
}

// Sépare un champ harfJarr qui peut contenir plusieurs harf
// (ex : "إِلَى – فِي", "إلى / في", "إلى, في").
const HARF_SEPARATORS = /\s*(?:[-–—/,،]|\bou\b|\bأو\b)\s*/i
function splitHarfJarr(s) {
  if (!hasText(s)) return []
  return s.split(HARF_SEPARATORS).map(x => x.trim()).filter(Boolean)
}

// Sépare une traduction française qui peut contenir plusieurs sens.
//  - "Chaleur / Température" → ["Chaleur", "Température"]
//  - "Milieu (fém.)"          → ["Milieu"]
//  - "Étranger (langue non-arabe)" → ["Étranger"]
// On découpe sur "/", ",", " ou ", puis on retire les parenthèses contextuelles.
const TRANSLATION_SEPARATORS = /\s*(?:\/|,|\bou\b)\s*/i
const PARENTHESES = /\s*\([^)]*\)\s*/g
function splitTranslation(s) {
  if (!hasText(s)) return []
  const cleaned = s.replace(PARENTHESES, ' ').trim()
  return cleaned.split(TRANSLATION_SEPARATORS).map(x => x.trim()).filter(Boolean)
}

// Liste de harf jar arabes courants, utilisée UNIQUEMENT comme source
// supplémentaire de distracteurs si la base ne contient pas encore assez
// de harf différents pour proposer 7 mauvaises réponses. Ils ne sont
// jamais utilisés comme bonne réponse — la bonne réponse vient toujours
// du champ harfJarr d'un verbe réel de la base.
const COMMON_HARF_JARR_FALLBACK = [
  'إِلَى', 'عَلَى', 'فِي', 'عَنْ', 'مِنْ',
  'بِ', 'لِ', 'مَعَ', 'حَتَّى', 'كَ', 'عِنْدَ',
]

/* --- Définitions des catégories de questions ---
   Deux modes :
   1. Mode "valeur unique" (les 7 premières catégories) :
        getAnswer(row) renvoie UNE chaîne. Comparaison par égalité stricte.
   2. Mode "harf jar" : getAnswerSet(row) renvoie un Set de FORMES
        NORMALISÉES (sans tachkīl). Toute option dont la forme normalisée
        est dans ce set est acceptée. Les valeurs affichées sont prises
        dans un pool global de harf canoniques (forme la plus diacritée).
*/
const QUESTION_TYPES = [
  {
    key: 'singular',
    shortLabel: 'Singulier',
    badgeLabel: 'SINGULIER',
    promptLabel: 'Quel est le singulier de :',
    getPrompt: row => row.translation,
    getAnswer: row => row.singular,
    eligible: row => row.type === 'nom' && hasText(row.translation) && hasText(row.singular),
  },
  {
    key: 'plural',
    shortLabel: 'Pluriel',
    badgeLabel: 'PLURIEL',
    promptLabel: 'Quel est le pluriel de :',
    getPrompt: row => row.translation,
    getAnswer: row => row.plural,
    eligible: row => row.type === 'nom' && hasText(row.translation) && hasText(row.plural),
  },
  {
    key: 'past',
    shortLabel: 'Passé',
    badgeLabel: 'PASSÉ',
    promptLabel: 'Quel est le verbe au passé pour :',
    getPrompt: row => row.translation,
    getAnswer: row => row.past,
    eligible: row => row.type === 'verbe' && hasText(row.translation) && hasText(row.past),
  },
  {
    key: 'present',
    shortLabel: 'Présent',
    badgeLabel: 'PRÉSENT',
    promptLabel: 'Quel est le verbe au présent pour :',
    getPrompt: row => row.translation,
    getAnswer: row => row.present,
    eligible: row => row.type === 'verbe' && hasText(row.translation) && hasText(row.present),
  },
  {
    key: 'masdar',
    shortLabel: 'Masdar',
    badgeLabel: 'MASDAR',
    promptLabel: 'Quel est le masdar de :',
    getPrompt: row => row.translation,
    getAnswer: row => row.masdar,
    eligible: row => row.type === 'verbe' && hasText(row.translation) && hasText(row.masdar),
  },
  {
    key: 'arabicFromVerbTranslation',
    shortLabel: 'FR → AR (verbe)',
    badgeLabel: 'TRADUCTION AR',
    promptLabel: 'Quel est le verbe arabe correspondant à :',
    getPrompt: row => row.translation,
    getAnswer: row => row.arabic,
    eligible: row => row.type === 'verbe' && hasText(row.translation) && hasText(row.arabic),
  },
  // ---- Traduction inverse : arabe → français ----
  // Une seule catégorie qui couvre noms et verbes. Le prompt est la forme
  // arabe la plus canonique (singular pour les noms, past pour les verbes,
  // sinon arabic en fallback). La réponse est la translation, et plusieurs
  // sens séparés par "/" sont tous acceptés.
  {
    key: 'frenchFromArabic',
    shortLabel: 'AR → FR',
    badgeLabel: 'TRADUCTION FR',
    promptLabel: 'Quelle est la traduction française de :',
    getPrompt: row => {
      if (row.type === 'nom') return row.singular || row.arabic
      if (row.type === 'verbe') return row.past || row.arabic
      return row.arabic
    },
    // Set des formes normalisées acceptées (chaque sens séparé par "/" est une variante)
    getAnswerSet: row => new Set(splitTranslation(row.translation).map(normalize)),
    // L'affichage de la "bonne réponse" : la translation telle quelle (avec les "/")
    getAnswerDisplay: row => row.translation,
    eligible: row =>
      hasText(row.translation) &&
      (
        (row.type === 'nom'   && (hasText(row.singular) || hasText(row.arabic))) ||
        (row.type === 'verbe' && (hasText(row.past)     || hasText(row.arabic)))
      ),
    // Marqué pour que le rendu utilise la police arabe sur le prompt
    isArabicPrompt: true,
    // Marqué pour que la comparaison se fasse par forme normalisée (multi-réponses)
    isFrenchAnswer: true,
  },
  // ---- Mode spécial : harf jar ----
  {
    key: 'harfJarr',
    shortLabel: 'Harf jar',
    badgeLabel: 'HARF JAR',
    promptLabel: 'Quel harf jar utilise-t-on avec ce verbe ?',
    // Le prompt est le verbe en arabe
    getPrompt: row => row.arabic,
    // Renvoie le Set des FORMES NORMALISÉES acceptées (1 ou plusieurs)
    getAnswerSet: row => new Set(splitHarfJarr(row.harfJarr).map(normalize)),
    eligible: row => row.type === 'verbe' && hasText(row.arabic) && hasText(row.harfJarr),
    isHarfMode: true,
  },
]

// Toutes les clés de types possibles — utilisé pour initialiser le filtre.
const ALL_TYPE_KEYS = QUESTION_TYPES.map(t => t.key)

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

function sampleWithoutReplacement(arr, n) {
  if (arr.length <= n) return [...arr]
  const copy = [...arr]
  const out = []
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(Math.random() * copy.length)
    out.push(copy[idx])
    copy.splice(idx, 1)
  }
  return out
}

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/**
 * Construit un dictionnaire canonique des harf jar disponibles :
 *   { [formeNormalisée]: formeAffichée }
 * Sources :
 *   1. Tous les harf trouvés dans le champ harfJarr de la base.
 *   2. En complément, les harf courants de COMMON_HARF_JARR_FALLBACK
 *      (seulement ceux qui ne sont pas déjà présents).
 * Pour chaque forme normalisée, on retient la version la plus diacritée
 * trouvée, pour un rendu pédagogique.
 */
function buildHarfDictionary(fullPool) {
  function countDiacritics(s) {
    const m = s.match(/[\u064B-\u0652\u0670]/g)
    return m ? m.length : 0
  }
  const dict = new Map()
  function add(piece) {
    const norm = normalize(piece)
    if (!norm) return
    const current = dict.get(norm)
    if (!current || countDiacritics(piece) > countDiacritics(current)) {
      dict.set(norm, piece)
    }
  }
  // 1. Harf trouvés dans la base
  for (const { row } of fullPool) {
    if (row.type !== 'verbe' || !hasText(row.harfJarr)) continue
    for (const piece of splitHarfJarr(row.harfJarr)) {
      add(piece)
    }
  }
  // 2. Complément avec les harf courants
  for (const piece of COMMON_HARF_JARR_FALLBACK) {
    add(piece)
  }
  return dict
}

/**
 * Construit un index d'auto-complétion :
 *   { [typeKey]: Array<{ display: string, norm: string }> }
 * Pour chaque catégorie, la liste des réponses possibles (sans doublon par
 * forme normalisée). Sert au mode "Question/Réponse".
 *
 * Pour `harfJarr`, on utilise directement les valeurs du harfDict (forme
 * canonique la plus diacritée).
 */
function buildSuggestionsIndex(fullPool, harfDict) {
  const index = {}

  for (const qt of QUESTION_TYPES) {
    if (qt.key === 'harfJarr') {
      const out = []
      const seen = new Set()
      for (const [norm, display] of harfDict.entries()) {
        if (seen.has(norm)) continue
        seen.add(norm)
        out.push({ display, norm })
      }
      index[qt.key] = out
      continue
    }

    // Catégorie "AR → FR" : chaque traduction peut contenir plusieurs sens
    // séparés par "/". On propose chaque variante individuellement, dédupliquée
    // par forme normalisée. On nettoie les parenthèses au passage.
    if (qt.isFrenchAnswer) {
      const seenFr = new Map()
      for (const { row } of fullPool) {
        if (!qt.eligible(row)) continue
        for (const variant of splitTranslation(row.translation)) {
          const n = normalize(variant)
          if (!n) continue
          if (!seenFr.has(n)) seenFr.set(n, variant)
        }
      }
      const out = []
      for (const [norm, display] of seenFr.entries()) {
        out.push({ display, norm })
      }
      index[qt.key] = out
      continue
    }

    // Catégories standard : on parcourt le pool, on prend getAnswer(row),
    // et on déduplique par forme normalisée. Quand plusieurs entrées ont
    // la même forme normalisée, on garde celle qui a le plus de diacritiques.
    function countDiacritics(s) {
      const m = s.match(/[\u064B-\u0652\u0670]/g)
      return m ? m.length : 0
    }
    const seen = new Map() // norm → display
    for (const { row } of fullPool) {
      if (!qt.eligible(row)) continue
      const v = qt.getAnswer(row)
      if (!hasText(v)) continue
      const n = normalize(v)
      if (!n) continue
      const current = seen.get(n)
      if (!current || countDiacritics(v) > countDiacritics(current)) {
        seen.set(n, v)
      }
    }
    const out = []
    for (const [norm, display] of seen.entries()) {
      out.push({ display, norm })
    }
    index[qt.key] = out
  }
  return index
}

/**
 * Trouve les suggestions à proposer pour une saisie donnée.
 *  - Match par préfixe normalisé (sans tachkīl).
 *  - Si rien ne match en préfixe, on tente un match par "contient".
 *  - Limite : maxResults.
 */
function findSuggestions(query, typeKey, suggestionsIndex, maxResults = 8) {
  const list = suggestionsIndex[typeKey] || []
  const q = normalize(query)
  if (!q) return list.slice(0, maxResults)

  const prefix = []
  const contains = []
  for (const item of list) {
    if (item.norm.startsWith(q)) prefix.push(item)
    else if (item.norm.includes(q)) contains.push(item)
  }
  // Tri : par longueur croissante pour faire remonter les matches "courts" en premier
  prefix.sort((a, b) => a.norm.length - b.norm.length)
  contains.sort((a, b) => a.norm.length - b.norm.length)
  return [...prefix, ...contains].slice(0, maxResults)
}

/**
 * Construit la question.
 *
 * @param {Array<{row, courseId}>} sourcePool   Pool pour la BONNE réponse.
 * @param {Array<{row, courseId}>} fullPool     Pool global pour les distracteurs.
 * @param {Map<string,string>} harfDict         Dictionnaire des harf canoniques.
 * @param {Set<string>} allowedTypeKeys         Clés des types autorisés par l'utilisateur.
 */
/**
 * Construit la question.
 *
 * @param {Array<{row, courseId, uid}>} sourcePool   Pool pour la BONNE réponse (avec uid).
 * @param {Array<{row, courseId, uid}>} fullPool     Pool global pour les distracteurs.
 * @param {Map<string,string>} harfDict              Dictionnaire des harf canoniques.
 * @param {Set<string>} allowedTypeKeys              Clés des types autorisés par l'utilisateur.
 * @param {Set<string>} excludedKeys                 Clés "uid|typeKey" déjà réussies dans le cycle.
 * @param {'qcm'|'typed'} mode                       Mode de quizz.
 */
function buildQuestion(sourcePool, fullPool, harfDict, allowedTypeKeys, excludedKeys, mode) {
  // 1. Restreindre aux types autorisés par le filtre utilisateur
  let candidates = QUESTION_TYPES.filter(qt => allowedTypeKeys.has(qt.key))
  if (candidates.length === 0) return null

  // 2. Garder uniquement les catégories qui ont au moins UNE ligne éligible
  //    dans le sourcePool ET qui n'est pas déjà exclue.
  candidates = candidates.filter(qt =>
    sourcePool.some(({ row, uid }) =>
      qt.eligible(row) && !excludedKeys.has(`${uid}|${qt.key}`)
    )
  )
  if (candidates.length === 0) return null

  // 3. Pour le mode harf jar (QCM uniquement), vérifier qu'on a assez de harf
  //    distincts pour 7 distracteurs uniques.
  if (mode === 'qcm') {
    candidates = candidates.filter(qt => {
      if (qt.key !== 'harfJarr') return true
      return harfDict.size >= 8
    })
    if (candidates.length === 0) return null
  }

  const qType = pickRandom(candidates)

  if (mode === 'qcm') {
    if (qType.isHarfMode) {
      return buildHarfJarrQuestion(qType, sourcePool, harfDict, excludedKeys)
    }
    if (qType.isFrenchAnswer) {
      return buildFrenchAnswerQcmQuestion(qType, sourcePool, fullPool, excludedKeys)
    }
    return buildStandardQuestion(qType, sourcePool, fullPool, excludedKeys)
  } else {
    return buildTypedQuestion(qType, sourcePool, harfDict, excludedKeys)
  }
}

// Choisit une entrée non encore exclue dans le sourcePool pour le type donné
function pickEligibleEntry(qType, sourcePool, excludedKeys) {
  const eligible = sourcePool.filter(({ row, uid }) =>
    qType.eligible(row) && !excludedKeys.has(`${uid}|${qType.key}`)
  )
  if (eligible.length === 0) return null
  return pickRandom(eligible)
}

function buildStandardQuestion(qType, sourcePool, fullPool, excludedKeys) {
  const correctEntry = pickEligibleEntry(qType, sourcePool, excludedKeys)
  if (!correctEntry) return null
  const correctAnswer = qType.getAnswer(correctEntry.row)
  const prompt = qType.getPrompt(correctEntry.row)

  // Pool de distracteurs : valeurs uniques de la même catégorie, hors bonne réponse
  const distractorValues = new Set()
  for (const { row } of fullPool) {
    if (!qType.eligible(row)) continue
    const v = qType.getAnswer(row)
    if (!hasText(v)) continue
    if (v === correctAnswer) continue
    distractorValues.add(v)
  }
  const distractorsArr = Array.from(distractorValues)

  const wanted = 7
  const chosenDistractors = sampleWithoutReplacement(distractorsArr, wanted)
  if (chosenDistractors.length < wanted) return null

  const options = shuffle([correctAnswer, ...chosenDistractors])
  return {
    typeKey: qType.key,
    badgeLabel: qType.badgeLabel,
    promptLabel: qType.promptLabel,
    prompt,
    correctAnswers: new Set([correctAnswer]),
    correctDisplay: correctAnswer,
    correctKey: `${correctEntry.uid}|${qType.key}`,
    note: correctEntry.row.note,
    options,
  }
}

function buildHarfJarrQuestion(qType, sourcePool, harfDict, excludedKeys) {
  const correctEntry = pickEligibleEntry(qType, sourcePool, excludedKeys)
  if (!correctEntry) return null
  const prompt = qType.getPrompt(correctEntry.row) // verbe arabe
  const correctNorms = qType.getAnswerSet(correctEntry.row) // formes normalisées acceptées

  const correctDisplayForms = []
  for (const norm of correctNorms) {
    const display = harfDict.get(norm)
    if (display) correctDisplayForms.push(display)
  }
  if (correctDisplayForms.length === 0) return null

  const chosenCorrectDisplay = pickRandom(correctDisplayForms)

  const distractorDisplays = []
  for (const [norm, display] of harfDict.entries()) {
    if (correctNorms.has(norm)) continue
    distractorDisplays.push(display)
  }

  const wanted = 7
  const chosenDistractors = sampleWithoutReplacement(distractorDisplays, wanted)
  if (chosenDistractors.length < wanted) return null

  const options = shuffle([chosenCorrectDisplay, ...chosenDistractors])

  return {
    typeKey: qType.key,
    badgeLabel: qType.badgeLabel,
    promptLabel: qType.promptLabel,
    prompt,
    correctNorms,
    correctDisplay: chosenCorrectDisplay,
    correctKey: `${correctEntry.uid}|${qType.key}`,
    note: correctEntry.row.note,
    options,
    isHarfMode: true,
  }
}

// QCM pour "Traduction française" : la bonne réponse est une translation (qui peut
// contenir plusieurs sens séparés par /). On affiche la translation complète comme
// option, et les distracteurs sont d'autres translations complètes du fullPool.
// La comparaison se fait sur le `display` de l'option pour éviter qu'un sens commun
// (rare avec des phrases complètes) ne fasse passer un distracteur pour correct.
function buildFrenchAnswerQcmQuestion(qType, sourcePool, fullPool, excludedKeys) {
  const correctEntry = pickEligibleEntry(qType, sourcePool, excludedKeys)
  if (!correctEntry) return null
  const prompt = qType.getPrompt(correctEntry.row)         // forme arabe (singular/past)
  const correctDisplay = qType.getAnswerDisplay(correctEntry.row) // translation complète
  // Formes normalisées acceptées (chaque sens séparé). En QCM la bonne option
  // est strictement `correctDisplay`, mais on garde correctNorms par cohérence.
  const correctNorms = qType.getAnswerSet(correctEntry.row)
  if (!hasText(correctDisplay)) return null

  // Pool de distracteurs : autres translations distinctes (par texte complet),
  // qui n'ont AUCUN sens commun avec la bonne réponse (sinon le distracteur
  // pourrait techniquement être correct).
  const distractorSet = new Set()
  for (const { row } of fullPool) {
    if (!qType.eligible(row)) continue
    const t = qType.getAnswerDisplay(row)
    if (!hasText(t)) continue
    if (t === correctDisplay) continue
    // Vérifier qu'aucune des variantes de ce distracteur ne tombe dans correctNorms
    const tNorms = splitTranslation(t).map(normalize)
    if (tNorms.some(n => correctNorms.has(n))) continue
    distractorSet.add(t)
  }
  const distractorsArr = Array.from(distractorSet)
  const wanted = 7
  const chosenDistractors = sampleWithoutReplacement(distractorsArr, wanted)
  if (chosenDistractors.length < wanted) return null

  const options = shuffle([correctDisplay, ...chosenDistractors])

  return {
    typeKey: qType.key,
    badgeLabel: qType.badgeLabel,
    promptLabel: qType.promptLabel,
    prompt,
    // Pour le QCM, accepter exactement la display complète OU n'importe laquelle
    // des formes normalisées (au cas où un distracteur passerait à travers).
    correctAnswers: new Set([correctDisplay]),
    correctNorms,
    correctDisplay,
    correctKey: `${correctEntry.uid}|${qType.key}`,
    note: correctEntry.row.note,
    options,
    isFrenchAnswer: true,
    isArabicPrompt: true,
  }
}

// Mode "Question/Réponse" : pas de QCM, juste une question + une réponse à taper.
function buildTypedQuestion(qType, sourcePool, harfDict, excludedKeys) {
  const correctEntry = pickEligibleEntry(qType, sourcePool, excludedKeys)
  if (!correctEntry) return null
  const prompt = qType.getPrompt(correctEntry.row)

  if (qType.isHarfMode) {
    const correctNorms = qType.getAnswerSet(correctEntry.row)
    const correctDisplayForms = []
    for (const norm of correctNorms) {
      const display = harfDict.get(norm)
      if (display) correctDisplayForms.push(display)
    }
    if (correctDisplayForms.length === 0) return null
    return {
      typeKey: qType.key,
      badgeLabel: qType.badgeLabel,
      promptLabel: qType.promptLabel,
      prompt,
      correctNorms,
      // On garde la version la plus diacritée comme affichage de référence
      correctDisplay: correctDisplayForms[0],
      // Si plusieurs harf acceptés, on peut tous les afficher en correction
      correctDisplayAll: correctDisplayForms.join(' / '),
      correctKey: `${correctEntry.uid}|${qType.key}`,
      note: correctEntry.row.note,
      isHarfMode: true,
      isTyped: true,
    }
  }

  // Catégorie "AR → FR" : plusieurs sens acceptés, comparaison normalisée
  // (insensible à la casse, aux accents, etc.).
  if (qType.isFrenchAnswer) {
    const correctNorms = qType.getAnswerSet(correctEntry.row)
    const correctDisplay = qType.getAnswerDisplay(correctEntry.row)
    if (correctNorms.size === 0 || !hasText(correctDisplay)) return null
    return {
      typeKey: qType.key,
      badgeLabel: qType.badgeLabel,
      promptLabel: qType.promptLabel,
      prompt,
      correctNorms,
      correctDisplay,
      correctDisplayAll: correctDisplay, // déjà toutes les variantes séparées par "/"
      correctKey: `${correctEntry.uid}|${qType.key}`,
      note: correctEntry.row.note,
      isFrenchAnswer: true,
      isArabicPrompt: true,
      isTyped: true,
    }
  }

  const correctAnswer = qType.getAnswer(correctEntry.row)
  return {
    typeKey: qType.key,
    badgeLabel: qType.badgeLabel,
    promptLabel: qType.promptLabel,
    prompt,
    // En mode typed, la comparaison se fait par forme normalisée pour
    // être tolérante au tachkīl. On stocke donc l'ensemble normalisé.
    correctNorms: new Set([normalize(correctAnswer)]),
    correctDisplay: correctAnswer,
    correctDisplayAll: correctAnswer,
    correctKey: `${correctEntry.uid}|${qType.key}`,
    note: correctEntry.row.note,
    isTyped: true,
  }
}

// Détermine si une réponse est correcte pour la question donnée.
// - QCM standard (arabe, harf jar) : comparaison par forme normalisée avec correctNorms.
// - QCM "AR → FR" : égalité stricte avec correctAnswers (le display complet,
//   ex "Chaleur / Température"), car normaliser la chaîne entière ne matcherait
//   pas les variantes individuelles dans correctNorms.
// - Typed : comparaison par forme normalisée avec correctNorms.
function isAnswerCorrect(answer, question) {
  if (!question) return false
  // QCM français : la bonne option est l'affichage complet — comparaison stricte.
  if (question.isFrenchAnswer && question.correctAnswers) {
    return question.correctAnswers.has(answer)
  }
  if (question.correctNorms) {
    return question.correctNorms.has(normalize(answer))
  }
  return question.correctAnswers.has(answer)
}

/* ============================================================
   Composant principal : Quiz
   ============================================================ */
export default function Quiz({ courses, vocabCache, loadVocab, onClose }) {
  const [selectedDeck, setSelectedDeck] = useState('all')
  const [allowedTypes, setAllowedTypes] = useState(() => new Set(ALL_TYPE_KEYS))
  const [mode, setMode] = useState('qcm') // 'qcm' | 'typed'
  // Set de clés "uid|typeKey" déjà répondues correctement dans le cycle en cours.
  // Réinitialisé quand tout a été vu, ou quand le deck/types/mode changent.
  const [excludedKeys, setExcludedKeys] = useState(() => new Set())
  const [question, setQuestion] = useState(null)
  const [chosenOption, setChosenOption] = useState(null)
  const [typedValue, setTypedValue] = useState('')   // saisie en mode typed
  const [phase, setPhase] = useState('playing') // 'playing' | 'revealed'
  const [score, setScore] = useState({ correct: 0, total: 0 })
  const [loading, setLoading] = useState(true)
  const [warning, setWarning] = useState(null)
  const [cycleCompleted, setCycleCompleted] = useState(false) // flag éphémère pour info

  const nextTimerRef = useRef(null)
  const inputRef = useRef(null)

  // 1. Pré-charger tous les vocabulaires
  useEffect(() => {
    let cancelled = false
    async function loadAll() {
      setLoading(true)
      await Promise.all(
        courses.map(async c => {
          if (vocabCache[c.id]) return
          try {
            await loadVocab(c)
          } catch (e) {
            console.warn('Quiz : impossible de charger', c.id, e)
          }
        })
      )
      if (!cancelled) setLoading(false)
    }
    loadAll()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courses])

  // 2. Pool global (avec uid stable : "courseId:index")
  const fullPool = useMemo(() => {
    const out = []
    for (const c of courses) {
      const list = vocabCache[c.id]
      if (!Array.isArray(list)) continue
      list.forEach((row, idx) => {
        out.push({ row, courseId: c.id, uid: `${c.id}:${idx}` })
      })
    }
    return out
  }, [courses, vocabCache])

  // 3. Dictionnaire global des harf jar
  const harfDict = useMemo(() => buildHarfDictionary(fullPool), [fullPool])

  // 4. Index d'auto-complétion (pour le mode typed)
  const suggestionsIndex = useMemo(
    () => buildSuggestionsIndex(fullPool, harfDict),
    [fullPool, harfDict]
  )

  // 5. Pool source selon le deck choisi
  const sourcePool = useMemo(() => {
    if (selectedDeck === 'all') return fullPool
    return fullPool.filter(item => item.courseId === selectedDeck)
  }, [fullPool, selectedDeck])

  // Quand le deck, les types autorisés, ou le mode changent → on remet
  // le cycle à zéro pour repartir d'une situation "tout à découvrir".
  // ATTENTION : on ne fait QUE reset ici. La génération de la nouvelle
  // question se fait dans l'effet ci-dessous, qui dépend aussi de
  // excludedKeys et donc s'exécutera APRÈS la mise à jour du Set.
  useEffect(() => {
    setExcludedKeys(prev => prev.size === 0 ? prev : new Set())
    setCycleCompleted(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDeck, allowedTypes, mode])

  // 6. Générer une nouvelle question
  const nextQuestion = useCallback((excludedOverride) => {
    setChosenOption(null)
    setTypedValue('')
    setPhase('playing')
    setWarning(null)

    if (allowedTypes.size === 0) {
      setQuestion(null)
      return
    }

    const excluded = excludedOverride || excludedKeys
    let q = buildQuestion(sourcePool, fullPool, harfDict, allowedTypes, excluded, mode)

    // Si on n'a rien trouvé alors que le cycle a déjà commencé, c'est que
    // toutes les combinaisons éligibles ont été réussies → on réinitialise.
    if (!q && excluded.size > 0) {
      const freshExcluded = new Set()
      setExcludedKeys(freshExcluded)
      setCycleCompleted(true)
      q = buildQuestion(sourcePool, fullPool, harfDict, allowedTypes, freshExcluded, mode)
    } else {
      setCycleCompleted(false)
    }

    // Fallback : si avec ce deck on n'a toujours rien, retomber sur "Tous"
    if (!q && selectedDeck !== 'all') {
      setWarning("Ce deck ne contient pas assez de mots exploitables pour les types choisis. Retour à « Tous les decks ».")
      setSelectedDeck('all')
      q = buildQuestion(fullPool, fullPool, harfDict, allowedTypes, new Set(), mode)
    }

    setQuestion(q)
    // Focus l'input en mode typed
    if (q && mode === 'typed') {
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [sourcePool, fullPool, harfDict, selectedDeck, allowedTypes, mode, excludedKeys])

  // On garde une ref vers la dernière version de nextQuestion. Comme ça, les
  // useEffect peuvent appeler la version la plus récente sans avoir à mettre
  // nextQuestion lui-même dans leurs dépendances (ce qui créerait des boucles).
  // Indispensable pour que le switch de mode utilise bien la closure avec le
  // nouveau mode — sinon on génèrerait une question typée pour un rendu QCM
  // (ou l'inverse), ce qui plante l'affichage.
  const nextQuestionRef = useRef(nextQuestion)
  useEffect(() => { nextQuestionRef.current = nextQuestion }, [nextQuestion])

  useEffect(() => {
    if (loading) return
    // Quand l'un de ces déclencheurs change (deck, types, mode, pool), on
    // démarre un nouveau cycle. On force un excluded vide en argument pour
    // ne pas dépendre de la valeur (potentiellement stale) dans la closure
    // de `nextQuestion` — l'effet qui reset `excludedKeys` peut ne pas avoir
    // été flushé au moment où on arrive ici.
    nextQuestionRef.current(new Set())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, selectedDeck, fullPool, allowedTypes, mode])

  useEffect(() => {
    return () => {
      if (nextTimerRef.current) clearTimeout(nextTimerRef.current)
    }
  }, [])

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // 7. Validation d'une réponse (commune QCM / typed)
  const handleAnswer = useCallback((answer) => {
    if (phase !== 'playing') return
    if (!question) return

    const isCorrect = isAnswerCorrect(answer, question)
    setChosenOption(answer)
    setPhase('revealed')
    setScore(s => ({
      correct: s.correct + (isCorrect ? 1 : 0),
      total: s.total + 1,
    }))

    // Mémoriser uniquement les bonnes réponses dans le set d'exclusion
    let nextExcluded = excludedKeys
    if (isCorrect && question.correctKey) {
      nextExcluded = new Set(excludedKeys)
      nextExcluded.add(question.correctKey)
      setExcludedKeys(nextExcluded)
    }

    // Délai de base : court si la réponse est correcte, plus long si fausse
    // (pour laisser voir la bonne réponse). Si le mot a une note, on rallonge
    // pour laisser le temps de la lire. Heuristique : ~250 mots/min de lecture
    // = ~24 caractères/seconde, avec un minimum confortable de 2.5 s. La pop-up
    // apparaît après 700 ms (le temps de l'animation rouge/verte), donc on
    // ajoute ces 700 ms au temps de lecture.
    const NOTE_POPUP_DELAY = 700
    const baseDelay = isCorrect ? 900 : 1700
    let delay = baseDelay
    if (hasText(question.note)) {
      const noteLength = question.note.trim().length
      const readingMs = Math.max(2500, Math.min(8000, noteLength * 55))
      delay = Math.max(baseDelay, NOTE_POPUP_DELAY + readingMs)
    }
    nextTimerRef.current = setTimeout(() => {
      // Passer l'override pour que buildQuestion voie la mise à jour
      // (sinon le state pourrait être stale dans certaines situations).
      nextQuestion(nextExcluded)
    }, delay)
  }, [phase, question, excludedKeys, nextQuestion])

  const deckUsableCount = useMemo(() => {
    return sourcePool.filter(({ row }) =>
      QUESTION_TYPES.some(qt => qt.eligible(row))
    ).length
  }, [sourcePool])

  // Pour chaque type, indique s'il y a au moins une question possible
  // dans le pool source. En mode QCM on exige aussi 8 harf pour harfJarr.
  const typeAvailability = useMemo(() => {
    const out = {}
    for (const qt of QUESTION_TYPES) {
      let available = sourcePool.some(({ row }) => qt.eligible(row))
      if (qt.key === 'harfJarr' && available && mode === 'qcm') {
        available = harfDict.size >= 8
      }
      out[qt.key] = available
    }
    return out
  }, [sourcePool, harfDict, mode])

  const toggleType = useCallback((key) => {
    setAllowedTypes(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const setAllTypes = useCallback(() => {
    setAllowedTypes(new Set(ALL_TYPE_KEYS))
  }, [])

  const allTypesActive = allowedTypes.size === ALL_TYPE_KEYS.length

  // Combien de combinaisons (mot, type) restent à découvrir dans le cycle ?
  const progress = useMemo(() => {
    let total = 0
    for (const item of sourcePool) {
      for (const qt of QUESTION_TYPES) {
        if (!allowedTypes.has(qt.key)) continue
        if (!qt.eligible(item.row)) continue
        if (qt.key === 'harfJarr' && mode === 'qcm' && harfDict.size < 8) continue
        total++
      }
    }
    const done = excludedKeys.size
    return { done: Math.min(done, total), total }
  }, [sourcePool, allowedTypes, excludedKeys, mode, harfDict])

  return (
    <div
      className="quiz-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      role="dialog"
      aria-modal="true"
      aria-label="Quizz de vocabulaire"
    >
      <div className="quiz-modal">
        <button
          type="button"
          className="quiz-close"
          onClick={onClose}
          aria-label="Fermer le quizz"
        >
          ×
        </button>

        <header className="quiz-header">
          <h2 className="quiz-title">Quizz</h2>
          <div className="quiz-meta">
            <span className="quiz-score">
              Score : <strong>{score.correct}</strong> / {score.total}
            </span>
          </div>
        </header>

        <div className="quiz-filter-row">
          <label className="quiz-filter-label" htmlFor="quiz-deck-select">
            Deck / cours
          </label>
          <select
            id="quiz-deck-select"
            className="quiz-deck-select"
            value={selectedDeck}
            onChange={(e) => setSelectedDeck(e.target.value)}
            disabled={loading}
          >
            <option value="all">Tous les decks</option>
            {courses.map(c => (
              <option key={c.id} value={c.id}>{c.title}</option>
            ))}
          </select>
          {!loading && selectedDeck !== 'all' && (
            <span className="quiz-deck-info">{deckUsableCount} mot(s) utilisable(s)</span>
          )}
        </div>

        <div className="quiz-types-row">
          <span className="quiz-filter-label">Types de question</span>
          <div className="quiz-types-chips">
            <button
              type="button"
              className={`quiz-type-chip quiz-type-chip-all ${allTypesActive ? 'active' : ''}`}
              onClick={setAllTypes}
              disabled={loading || allTypesActive}
              title="Activer tous les types"
            >
              Tous
            </button>
            {QUESTION_TYPES.map(qt => {
              const isActive = allowedTypes.has(qt.key)
              const isAvailable = typeAvailability[qt.key]
              return (
                <button
                  key={qt.key}
                  type="button"
                  className={`quiz-type-chip ${isActive ? 'active' : ''} ${!isAvailable ? 'unavailable' : ''}`}
                  onClick={() => toggleType(qt.key)}
                  disabled={loading}
                  title={isAvailable
                    ? (isActive ? 'Cliquer pour exclure ce type' : 'Cliquer pour inclure ce type')
                    : 'Aucun mot disponible pour ce type avec les paramètres actuels'}
                  aria-pressed={isActive}
                >
                  {qt.shortLabel}
                </button>
              )
            })}
          </div>
        </div>

        <div className="quiz-mode-row">
          <span className="quiz-filter-label">Mode</span>
          <div className="quiz-mode-switch" role="tablist">
            <button
              type="button"
              role="tab"
              className={`quiz-mode-btn ${mode === 'qcm' ? 'active' : ''}`}
              onClick={() => setMode('qcm')}
              disabled={loading}
              aria-selected={mode === 'qcm'}
            >
              QCM
            </button>
            <button
              type="button"
              role="tab"
              className={`quiz-mode-btn ${mode === 'typed' ? 'active' : ''}`}
              onClick={() => setMode('typed')}
              disabled={loading}
              aria-selected={mode === 'typed'}
            >
              Question / Réponse
            </button>
          </div>
          {progress.total > 0 && (
            <span className="quiz-progress" title="Mots restants dans le cycle">
              {progress.done} / {progress.total}
              {cycleCompleted && <span className="quiz-progress-flag"> · nouveau cycle</span>}
            </span>
          )}
        </div>

        {warning && <p className="quiz-warning">{warning}</p>}

        {loading ? (
          <div className="quiz-loading">
            <div className="quiz-spinner" />
            <p>Chargement du vocabulaire…</p>
          </div>
        ) : !question ? (
          <p className="quiz-empty">
            {allowedTypes.size === 0
              ? "Sélectionne au moins un type de question pour démarrer."
              : "Aucune question ne peut être générée avec ces paramètres. Essaie d'élargir le deck ou les types."}
          </p>
        ) : (
          <>
            <div className="quiz-prompt-zone">
              <span className={`quiz-badge quiz-badge-${question.typeKey}`}>
                {question.badgeLabel}
              </span>
              <p className="quiz-prompt-label">{question.promptLabel}</p>
              <p className={
                (question.isHarfMode || question.isArabicPrompt)
                  ? 'quiz-prompt-word arabic-text'
                  : 'quiz-prompt-word'
              }>
                {question.prompt}
              </p>
            </div>

            {mode === 'qcm' && question.options ? (
              <div className="quiz-options">
                {question.options.map((opt, idx) => {
                  const optionIsCorrect = isAnswerCorrect(opt, question)
                  const isChosen = opt === chosenOption
                  const revealed = phase === 'revealed'

                  let stateClass = ''
                  if (revealed) {
                    if (optionIsCorrect) stateClass = 'is-correct'
                    else if (isChosen) stateClass = 'is-wrong'
                    else stateClass = 'is-dim'
                  }

                  return (
                    <button
                      key={`${opt}-${idx}`}
                      type="button"
                      className={`quiz-option ${stateClass} ${question.isFrenchAnswer ? 'is-french' : ''}`}
                      onClick={() => handleAnswer(opt)}
                      disabled={revealed}
                    >
                      <span className={question.isFrenchAnswer ? '' : 'arabic-text'}>{opt}</span>
                    </button>
                  )
                })}
              </div>
            ) : mode === 'typed' && question.isTyped ? (
              <TypedAnswer
                question={question}
                phase={phase}
                chosenOption={chosenOption}
                typedValue={typedValue}
                setTypedValue={setTypedValue}
                inputRef={inputRef}
                suggestionsIndex={suggestionsIndex}
                onAnswer={handleAnswer}
              />
            ) : (
              // Cas transitoire : le mode vient de changer mais la question
              // n'a pas encore été régénérée pour le nouveau mode. On affiche
              // un petit indicateur très bref plutôt qu'un écran vide.
              <div className="quiz-loading quiz-loading-inline">
                <div className="quiz-spinner" />
              </div>
            )}

            {/* Note du mot affichée après réponse, quels que soient le mode
                et la justesse de la réponse. */}
            <QuizNote note={question.note} phase={phase} />
          </>
        )}
      </div>
    </div>
  )
}

/* ============================================================
   Sous-composant : pop-up centrée affichant la note d'un mot
   après réponse. Apparaît après l'animation rouge/verte (~700 ms),
   reste visible jusqu'au passage à la question suivante.
   ============================================================ */
function QuizNote({ note, phase }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (phase !== 'revealed' || !hasText(note)) {
      setVisible(false)
      return
    }
    // Laisser jouer l'animation rouge/verte avant d'afficher la pop-up
    const t = setTimeout(() => setVisible(true), 700)
    return () => clearTimeout(t)
  }, [phase, note])

  if (!visible || !hasText(note)) return null

  return (
    <div className="quiz-note-overlay" aria-live="polite">
      <div className="quiz-note-popup" role="note">
        <span className="quiz-note-icon" aria-hidden="true">
          <svg viewBox="0 0 20 20" width="20" height="20">
            <circle cx="10" cy="10" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="10" cy="6"  r="1.1" fill="currentColor" />
            <rect   x="9.05" y="8.6" width="1.9" height="6.4" rx="0.95" fill="currentColor" />
          </svg>
        </span>
        <p className="quiz-note-text">{note}</p>
      </div>
    </div>
  )
}

/* ============================================================
   Sous-composant : zone de réponse en mode "Question / Réponse"
   ============================================================ */
function TypedAnswer({
  question, phase, chosenOption, typedValue, setTypedValue,
  inputRef, suggestionsIndex, onAnswer
}) {
  const [highlightIdx, setHighlightIdx] = useState(-1)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const revealed = phase === 'revealed'

  // Réinitialiser quand la question change
  useEffect(() => {
    setHighlightIdx(-1)
    setShowSuggestions(false)
  }, [question])

  const suggestions = useMemo(() => {
    if (revealed) return []
    return findSuggestions(typedValue, question.typeKey, suggestionsIndex, 8)
  }, [typedValue, question.typeKey, suggestionsIndex, revealed])

  const wasCorrect = revealed && chosenOption != null && isAnswerCorrect(chosenOption, question)
  const wasWrong = revealed && !wasCorrect

  const submit = useCallback((value) => {
    if (revealed) return
    const v = (value ?? typedValue).trim()
    if (!hasText(v)) return
    onAnswer(v)
  }, [revealed, typedValue, onAnswer])

  const onKeyDown = (e) => {
    if (revealed) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (suggestions.length === 0) return
      setShowSuggestions(true)
      setHighlightIdx(i => Math.min(i + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightIdx(i => Math.max(i - 1, -1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (highlightIdx >= 0 && suggestions[highlightIdx]) {
        submit(suggestions[highlightIdx].display)
      } else {
        submit()
      }
    } else if (e.key === 'Escape') {
      setShowSuggestions(false)
      setHighlightIdx(-1)
    }
  }

  // Si la réponse attendue est française, on adapte l'input (LTR, placeholder
  // FR, pas de police arabe). Sinon comportement par défaut : arabe RTL.
  const expectsFrench = !!question.isFrenchAnswer

  return (
    <div className="quiz-typed-zone">
      <div className="quiz-typed-input-row">
        <input
          ref={inputRef}
          type="text"
          dir={expectsFrench ? 'ltr' : 'rtl'}
          lang={expectsFrench ? 'fr' : 'ar'}
          className={`quiz-typed-input ${expectsFrench ? '' : 'arabic-text'} ${wasCorrect ? 'is-correct' : ''} ${wasWrong ? 'is-wrong' : ''}`}
          placeholder={expectsFrench ? 'Tape la traduction en français…' : 'اكتب الجواب هنا…'}
          value={revealed ? (chosenOption || '') : typedValue}
          onChange={(e) => {
            setTypedValue(e.target.value)
            setShowSuggestions(true)
            setHighlightIdx(-1)
          }}
          onFocus={() => setShowSuggestions(true)}
          onKeyDown={onKeyDown}
          disabled={revealed}
          autoComplete="off"
          spellCheck="false"
        />
        <button
          type="button"
          className="btn btn-primary quiz-typed-submit"
          onClick={() => submit()}
          disabled={revealed || !hasText(typedValue)}
        >
          Valider
        </button>
      </div>

      {showSuggestions && !revealed && suggestions.length > 0 && (
        <ul className="quiz-suggestions" role="listbox">
          {suggestions.map((s, i) => (
            <li
              key={s.norm}
              role="option"
              aria-selected={i === highlightIdx}
              className={`quiz-suggestion ${i === highlightIdx ? 'highlighted' : ''}`}
              onMouseDown={(e) => {
                // mousedown plutôt que click pour ne pas perdre le focus
                e.preventDefault()
                submit(s.display)
              }}
              onMouseEnter={() => setHighlightIdx(i)}
            >
              <span className={expectsFrench ? '' : 'arabic-text'}>{s.display}</span>
            </li>
          ))}
        </ul>
      )}

      {revealed && (
        <div className={`quiz-typed-feedback ${wasCorrect ? 'is-correct' : 'is-wrong'}`}>
          {wasCorrect ? (
            <span>✓ Bonne réponse !</span>
          ) : (
            <>
              <span className="quiz-typed-label">Bonne réponse :</span>
              <span className={`${expectsFrench ? '' : 'arabic-text'} quiz-typed-answer`}>
                {question.correctDisplayAll || question.correctDisplay}
              </span>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/* ============================================================
   Bouton flottant "Quizz"
   ============================================================ */
export function QuizFloatingButton({ onClick }) {
  return (
    <button
      type="button"
      className="quiz-fab"
      onClick={onClick}
      aria-label="Ouvrir le quizz"
    >
      <span className="quiz-fab-icon" aria-hidden="true">?</span>
      <span className="quiz-fab-label">Quizz</span>
    </button>
  )
}

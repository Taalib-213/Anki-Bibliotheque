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
    key: 'arabicFromNounTranslation',
    shortLabel: 'Nom (arabe)',
    promptLabel: 'Quel est le mot arabe correspondant à :',
    getPrompt: row => row.translation,
    getAnswer: row => row.arabic,
    eligible: row => row.type === 'nom' && hasText(row.translation) && hasText(row.arabic),
  },
  {
    key: 'singular',
    shortLabel: 'Singulier',
    promptLabel: 'Quel est le singulier de :',
    getPrompt: row => row.translation,
    getAnswer: row => row.singular,
    eligible: row => row.type === 'nom' && hasText(row.translation) && hasText(row.singular),
  },
  {
    key: 'plural',
    shortLabel: 'Pluriel',
    promptLabel: 'Quel est le pluriel de :',
    getPrompt: row => row.translation,
    getAnswer: row => row.plural,
    eligible: row => row.type === 'nom' && hasText(row.translation) && hasText(row.plural),
  },
  {
    key: 'past',
    shortLabel: 'Passé',
    promptLabel: 'Quel est le verbe au passé pour :',
    getPrompt: row => row.translation,
    getAnswer: row => row.past,
    eligible: row => row.type === 'verbe' && hasText(row.translation) && hasText(row.past),
  },
  {
    key: 'present',
    shortLabel: 'Présent',
    promptLabel: 'Quel est le verbe au présent pour :',
    getPrompt: row => row.translation,
    getAnswer: row => row.present,
    eligible: row => row.type === 'verbe' && hasText(row.translation) && hasText(row.present),
  },
  {
    key: 'masdar',
    shortLabel: 'Masdar',
    promptLabel: 'Quel est le masdar de :',
    getPrompt: row => row.translation,
    getAnswer: row => row.masdar,
    eligible: row => row.type === 'verbe' && hasText(row.translation) && hasText(row.masdar),
  },
  {
    key: 'arabicFromVerbTranslation',
    shortLabel: 'Verbe (arabe)',
    promptLabel: 'Quel est le verbe arabe correspondant à :',
    getPrompt: row => row.translation,
    getAnswer: row => row.arabic,
    eligible: row => row.type === 'verbe' && hasText(row.translation) && hasText(row.arabic),
  },
  // ---- Mode spécial : harf jar ----
  {
    key: 'harfJarr',
    shortLabel: 'Harf jar',
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
 * Construit la question.
 *
 * @param {Array<{row, courseId}>} sourcePool   Pool pour la BONNE réponse.
 * @param {Array<{row, courseId}>} fullPool     Pool global pour les distracteurs.
 * @param {Map<string,string>} harfDict         Dictionnaire des harf canoniques.
 * @param {Set<string>} allowedTypeKeys         Clés des types autorisés par l'utilisateur.
 */
function buildQuestion(sourcePool, fullPool, harfDict, allowedTypeKeys) {
  // 1. Restreindre aux types autorisés par le filtre utilisateur
  let candidates = QUESTION_TYPES.filter(qt => allowedTypeKeys.has(qt.key))
  if (candidates.length === 0) return null

  // 2. Garder uniquement les catégories qui ont au moins UNE ligne éligible
  //    dans le sourcePool.
  candidates = candidates.filter(qt =>
    sourcePool.some(({ row }) => qt.eligible(row))
  )
  if (candidates.length === 0) return null

  // 3. Pour le mode harf jar, vérifier qu'on a assez de harf distincts
  //    dans la base pour proposer 7 distracteurs uniques.
  candidates = candidates.filter(qt => {
    if (qt.key !== 'harfJarr') return true
    return harfDict.size >= 8
  })
  if (candidates.length === 0) return null

  const qType = pickRandom(candidates)

  if (qType.isHarfMode) {
    return buildHarfJarrQuestion(qType, sourcePool, harfDict)
  }
  return buildStandardQuestion(qType, sourcePool, fullPool)
}

function buildStandardQuestion(qType, sourcePool, fullPool) {
  const eligibleSource = sourcePool.filter(({ row }) => qType.eligible(row))
  const correctEntry = pickRandom(eligibleSource)
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
    promptLabel: qType.promptLabel,
    prompt,
    correctAnswers: new Set([correctAnswer]),
    options,
  }
}

function buildHarfJarrQuestion(qType, sourcePool, harfDict) {
  // 1. Choisir un verbe dans le sourcePool
  const eligibleSource = sourcePool.filter(({ row }) => qType.eligible(row))
  const correctEntry = pickRandom(eligibleSource)
  const prompt = qType.getPrompt(correctEntry.row) // verbe arabe
  const correctNorms = qType.getAnswerSet(correctEntry.row) // formes normalisées acceptées

  // 2. Formes AFFICHABLES correspondant aux bonnes réponses
  //    (forme la plus diacritée trouvée dans la base).
  const correctDisplayForms = []
  for (const norm of correctNorms) {
    const display = harfDict.get(norm)
    if (display) correctDisplayForms.push(display)
  }
  if (correctDisplayForms.length === 0) return null

  // 3. On insère UNE bonne réponse dans les options (suffisant : si le
  //    verbe accepte plusieurs harf, n'importe lequel comptera juste
  //    grâce à la comparaison par forme normalisée).
  const chosenCorrectDisplay = pickRandom(correctDisplayForms)

  // 4. Distracteurs : tous les harf canoniques dont la forme normalisée
  //    n'est PAS acceptée par le verbe.
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
    promptLabel: qType.promptLabel,
    prompt,
    // Comparaison par forme normalisée
    correctNorms,
    primaryCorrectDisplay: chosenCorrectDisplay,
    options,
    isHarfMode: true,
  }
}

// Détermine si une option est une bonne réponse pour la question donnée.
// - Mode standard : égalité stricte avec correctAnswers.
// - Mode harf jar : comparaison par forme normalisée avec correctNorms.
function isOptionCorrect(option, question) {
  if (!question) return false
  if (question.isHarfMode) {
    return question.correctNorms.has(normalize(option))
  }
  return question.correctAnswers.has(option)
}

/* ============================================================
   Composant principal : Quiz
   ============================================================ */
export default function Quiz({ courses, vocabCache, loadVocab, onClose }) {
  const [selectedDeck, setSelectedDeck] = useState('all')
  // Ensemble des types autorisés. Par défaut, tous.
  const [allowedTypes, setAllowedTypes] = useState(() => new Set(ALL_TYPE_KEYS))
  const [question, setQuestion] = useState(null)
  const [chosenOption, setChosenOption] = useState(null)
  const [phase, setPhase] = useState('playing') // 'playing' | 'revealed'
  const [score, setScore] = useState({ correct: 0, total: 0 })
  const [loading, setLoading] = useState(true)
  const [warning, setWarning] = useState(null)

  const nextTimerRef = useRef(null)

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

  // 2. Pool global
  const fullPool = useMemo(() => {
    const out = []
    for (const c of courses) {
      const list = vocabCache[c.id]
      if (!Array.isArray(list)) continue
      for (const row of list) {
        out.push({ row, courseId: c.id })
      }
    }
    return out
  }, [courses, vocabCache])

  // 3. Dictionnaire global des harf jar (forme normalisée → forme affichée)
  const harfDict = useMemo(() => buildHarfDictionary(fullPool), [fullPool])

  // 4. Pool source selon le deck choisi
  const sourcePool = useMemo(() => {
    if (selectedDeck === 'all') return fullPool
    return fullPool.filter(item => item.courseId === selectedDeck)
  }, [fullPool, selectedDeck])

  // 5. Générer une nouvelle question
  const nextQuestion = useCallback(() => {
    setChosenOption(null)
    setPhase('playing')
    setWarning(null)

    // Si l'utilisateur a tout décoché, on ne peut rien faire
    if (allowedTypes.size === 0) {
      setQuestion(null)
      return
    }

    let q = buildQuestion(sourcePool, fullPool, harfDict, allowedTypes)

    // Fallback 1 : si avec ce deck + ces types on n'a rien, essayer tous les decks
    //              (les types restent ceux choisis par l'utilisateur)
    if (!q && selectedDeck !== 'all') {
      setWarning("Ce deck ne contient pas assez de mots exploitables pour les types choisis. Retour à « Tous les decks ».")
      setSelectedDeck('all')
      q = buildQuestion(fullPool, fullPool, harfDict, allowedTypes)
    }

    setQuestion(q)
  }, [sourcePool, fullPool, harfDict, selectedDeck, allowedTypes])

  useEffect(() => {
    if (loading) return
    nextQuestion()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, selectedDeck, fullPool, allowedTypes])

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

  // 6. Clic sur une option
  const handleAnswer = (option) => {
    if (phase !== 'playing') return
    if (!question) return

    const isCorrect = isOptionCorrect(option, question)
    setChosenOption(option)
    setPhase('revealed')
    setScore(s => ({
      correct: s.correct + (isCorrect ? 1 : 0),
      total: s.total + 1,
    }))

    const delay = isCorrect ? 900 : 1600
    nextTimerRef.current = setTimeout(() => {
      nextQuestion()
    }, delay)
  }

  const deckUsableCount = useMemo(() => {
    return sourcePool.filter(({ row }) =>
      QUESTION_TYPES.some(qt => qt.eligible(row))
    ).length
  }, [sourcePool])

  // Pour chaque type, indique s'il y a au moins une question possible
  // dans le pool source (et, pour harf jar, assez de harf dans la base).
  // Utilisé pour griser les chips qui ne mèneraient à rien.
  const typeAvailability = useMemo(() => {
    const out = {}
    for (const qt of QUESTION_TYPES) {
      let available = sourcePool.some(({ row }) => qt.eligible(row))
      if (qt.key === 'harfJarr' && available) {
        available = harfDict.size >= 8
      }
      out[qt.key] = available
    }
    return out
  }, [sourcePool, harfDict])

  // Toggle un type dans le filtre
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
              <p className="quiz-prompt-label">{question.promptLabel}</p>
              <p className={
                question.isHarfMode
                  ? 'quiz-prompt-word arabic-text'
                  : 'quiz-prompt-word'
              }>
                {question.prompt}
              </p>
            </div>

            <div className="quiz-options">
              {question.options.map((opt, idx) => {
                const optionIsCorrect = isOptionCorrect(opt, question)
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
                    className={`quiz-option ${stateClass}`}
                    onClick={() => handleAnswer(opt)}
                    disabled={revealed}
                  >
                    <span className="arabic-text">{opt}</span>
                  </button>
                )
              })}
            </div>
          </>
        )}
      </div>
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

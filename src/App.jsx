import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import Quiz, { QuizFloatingButton } from './Quiz.jsx'

/* Application du thème AU PLUS TÔT, avant le premier rendu React, pour
   éviter qu'on voie brièvement le thème par défaut avant celui choisi. */
if (typeof document !== 'undefined') {
  try {
    const saved = window.localStorage?.getItem('arabic-vocab-theme')
    if (saved && ['nuit', 'jour', 'encre'].includes(saved)) {
      document.documentElement.setAttribute('data-theme', saved)
    }
  } catch { /* localStorage indisponible (mode privé), pas grave */ }
}

const PAGE_SIZE = 50

// Normalise un texte pour la recherche :
// - minuscules
// - retire les diacritiques arabes (tachkīl) pour que "فتح" trouve "فَتَحَ"
// - retire les accents français (à → a, é → e, etc.)
const ARABIC_DIACRITICS = /[\u064B-\u0652\u0670\u0640]/g
function normalize(s) {
  if (!s) return ''
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // accents latins
    .replace(ARABIC_DIACRITICS, '')    // tachkīl arabe
}

// Hook simple pour "debouncer" la frappe (évite de filtrer à chaque touche
// quand il y a beaucoup de mots)
function useDebounced(value, delay = 200) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return v
}

/* ============================================================
   THÈMES — liste des thèmes disponibles avec leurs vignettes
   de couleurs (utilisées pour l'aperçu dans le sélecteur).
   ============================================================ */
const THEMES = [
  {
    id: 'nuit',
    label: 'Nuit',
    description: 'Bleu nuit, or et émeraude',
    swatch: ['#0e2e2a', '#d4af37', '#10b981'],
  },
  {
    id: 'jour',
    label: 'Jour',
    description: 'Crème, or foncé, lecture confortable',
    swatch: ['#f7f3e8', '#a17a1e', '#0d8059'],
  },
  {
    id: 'encre',
    label: 'Encre',
    description: 'Noir intense, or vif, turquoise',
    swatch: ['#050608', '#fbbf24', '#14b8a6'],
  },
]
const THEME_IDS = THEMES.map(t => t.id)
const DEFAULT_THEME = 'nuit'
const THEME_STORAGE_KEY = 'arabic-vocab-theme'

/* useTheme : lit/écrit le thème dans localStorage et l'applique sur <html>. */
function useTheme() {
  const [theme, setThemeState] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_THEME
    try {
      const saved = window.localStorage.getItem(THEME_STORAGE_KEY)
      if (saved && THEME_IDS.includes(saved)) return saved
    } catch { /* localStorage indisponible (mode privé, etc.) */ }
    return DEFAULT_THEME
  })

  useEffect(() => {
    if (typeof document === 'undefined') return
    document.documentElement.setAttribute('data-theme', theme)
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme)
    } catch { /* ignore */ }
  }, [theme])

  const setTheme = useCallback((id) => {
    if (THEME_IDS.includes(id)) setThemeState(id)
  }, [])

  return [theme, setTheme]
}

/* ============================================================
   ThemeSwitcher — petit bouton flottant en haut à droite qui
   ouvre un menu d'aperçu des thèmes disponibles. La sélection
   est mémorisée dans localStorage et appliquée immédiatement.
   ============================================================ */
function ThemeSwitcher() {
  const [theme, setTheme] = useTheme()
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef(null)

  // Fermer si on clique ailleurs ou si on appuie sur Échap
  useEffect(() => {
    if (!open) return
    function onDocPointer(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false)
    }
    function onKey(e) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onDocPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDocPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="theme-switcher" ref={wrapperRef}>
      <button
        type="button"
        className="theme-switcher-btn"
        onClick={() => setOpen(o => !o)}
        aria-label="Choisir un thème de couleur"
        aria-expanded={open}
        title="Thème de couleur"
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          {/* Petite palette stylisée : disque divisé en 3 quartiers */}
          <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M12 2 A10 10 0 0 1 20.66 7 L12 12 Z" fill="currentColor" opacity="0.85"/>
          <path d="M20.66 7 A10 10 0 0 1 20.66 17 L12 12 Z" fill="currentColor" opacity="0.55"/>
          <path d="M20.66 17 A10 10 0 0 1 12 22 L12 12 Z" fill="currentColor" opacity="0.3"/>
        </svg>
      </button>
      {open && (
        <div className="theme-switcher-menu" role="menu">
          <div className="theme-switcher-title">Thème</div>
          {THEMES.map(t => (
            <button
              key={t.id}
              type="button"
              role="menuitemradio"
              aria-checked={theme === t.id}
              className={`theme-option ${theme === t.id ? 'is-active' : ''}`}
              onClick={() => { setTheme(t.id); setOpen(false) }}
            >
              <span className="theme-swatch" aria-hidden="true">
                {t.swatch.map((c, i) => (
                  <span key={i} className="theme-swatch-dot" style={{ background: c }} />
                ))}
              </span>
              <span className="theme-option-text">
                <span className="theme-option-label">{t.label}</span>
                <span className="theme-option-desc">{t.description}</span>
              </span>
              {theme === t.id && (
                <svg className="theme-check" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
                  <path d="M5 10 L9 14 L15 6" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}


/* ============================================================
   useIsTouch — détecte si l'utilisateur est sur un appareil tactile
   (pas de souris hover). Utilisé pour basculer entre hover (desktop)
   et tap (mobile/tablette) sur le NoteBadge.
   ============================================================ */
function useIsTouch() {
  const [isTouch, setIsTouch] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia?.('(hover: none)').matches ?? false
  })
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(hover: none)')
    const handler = (e) => setIsTouch(e.matches)
    if (mq.addEventListener) {
      mq.addEventListener('change', handler)
      return () => mq.removeEventListener('change', handler)
    } else if (mq.addListener) {
      // Safari ancien
      mq.addListener(handler)
      return () => mq.removeListener(handler)
    }
  }, [])
  return isTouch
}

/* ============================================================
   NoteBadge — petite icône info qui apparaît à côté d'un mot
   ayant une note. Pour exposer la note :
   - Desktop (hover) : on survole la cellule entière du tableau
     OU la carte mobile → la bulle apparaît.
   - Mobile/touch    : on tape sur l'icône → la bulle apparaît,
     tape ailleurs ou Échap pour fermer.

   Implémentation : la bulle est en `position: fixed` calculée à
   l'ouverture, pour ne pas être clippée par les overflow:hidden
   ou auto des conteneurs parents (notamment .table-wrapper).
   ============================================================ */
function NoteBadge({ note, hoverTargetRef }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ left: 0, top: 0, placement: 'top' })
  const iconRef = useRef(null)
  const bubbleRef = useRef(null)
  const isTouch = useIsTouch()

  // Recalcule la position de la bulle par rapport à l'icône
  const updatePosition = useCallback(() => {
    const icon = iconRef.current
    const bubble = bubbleRef.current
    if (!icon || !bubble) return
    const r = icon.getBoundingClientRect()
    const bw = bubble.offsetWidth
    const bh = bubble.offsetHeight
    const margin = 8
    // Centrer horizontalement sur l'icône, mais clamper aux bords du viewport
    let left = r.left + r.width / 2 - bw / 2
    left = Math.max(margin, Math.min(left, window.innerWidth - bw - margin))
    // Placer au-dessus par défaut ; sinon en dessous si pas la place
    let top = r.top - bh - margin
    let placement = 'top'
    if (top < margin) {
      top = r.bottom + margin
      placement = 'bottom'
    }
    setPos({ left, top, placement })
  }, [])

  // Repositionner à l'ouverture et à chaque scroll/resize tant que c'est ouvert
  useEffect(() => {
    if (!open) return
    // Premier calcul après que la bulle ait été montée
    updatePosition()
    const handler = () => updatePosition()
    window.addEventListener('scroll', handler, true)
    window.addEventListener('resize', handler)
    return () => {
      window.removeEventListener('scroll', handler, true)
      window.removeEventListener('resize', handler)
    }
  }, [open, updatePosition])

  // Fermer si on tape/clique ailleurs (mobile) ou si Échap
  useEffect(() => {
    if (!open) return
    function onDocPointer(e) {
      const inIcon = iconRef.current?.contains(e.target)
      const inBubble = bubbleRef.current?.contains(e.target)
      if (!inIcon && !inBubble) setOpen(false)
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDocPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDocPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Survol du conteneur cible (rangée du tableau / carte mobile) :
  // ouvre la bulle UNIQUEMENT sur desktop (hover possible).
  useEffect(() => {
    if (isTouch) return
    const target = hoverTargetRef?.current
    if (!target) return
    const onEnter = () => setOpen(true)
    const onLeave = (e) => {
      // Ne pas fermer si on entre dans la bulle (qui est en position fixed,
      // donc hors du target). En pratique, comme on revient sur la bulle via
      // un mouvement vers le haut, on tolère un petit délai.
      // → on ferme directement : la bulle reste affichée tant que le pointer
      // est sur la cellule. Si l'utilisateur veut interagir avec la bulle,
      // il doit la garder ouverte via tap (mode touch).
      setOpen(false)
    }
    target.addEventListener('mouseenter', onEnter)
    target.addEventListener('mouseleave', onLeave)
    return () => {
      target.removeEventListener('mouseenter', onEnter)
      target.removeEventListener('mouseleave', onLeave)
    }
  }, [hoverTargetRef, isTouch])

  if (!note || !String(note).trim()) return null

  return (
    <>
      <button
        ref={iconRef}
        type="button"
        className="note-badge"
        aria-label="Voir la note de ce mot"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation()
          setOpen(o => !o)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setOpen(o => !o)
          }
        }}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <circle cx="10" cy="10" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="10" cy="6"  r="1.1" fill="currentColor" />
          <rect   x="9.05" y="8.6" width="1.9" height="6.4" rx="0.95" fill="currentColor" />
        </svg>
      </button>
      {open && createPortal(
        <span
          ref={bubbleRef}
          className={`note-bubble note-bubble-${pos.placement}`}
          role="tooltip"
          style={{ left: `${pos.left}px`, top: `${pos.top}px` }}
        >
          {note}
        </span>,
        document.body
      )}
    </>
  )
}

export default function App() {
  const [courses, setCourses] = useState([])
  const [loadingCourses, setLoadingCourses] = useState(true)
  const [errorCourses, setErrorCourses] = useState(null)

  const [globalQuery, setGlobalQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState('Tous')

  // Cache du vocabulaire déjà chargé { [courseId]: array }
  const [vocabCache, setVocabCache] = useState({})
  // Cours dont le tableau est ouvert
  const [openCourseId, setOpenCourseId] = useState(null)
  // Statut de chargement par cours { [courseId]: 'loading' | 'error' | 'ok' }
  const [vocabStatus, setVocabStatus] = useState({})

  // État pour le quizz
  const [quizOpen, setQuizOpen] = useState(false)

  // 1. Charger courses.json au démarrage
  useEffect(() => {
    fetch('/data/courses.json')
      .then(r => {
        if (!r.ok) throw new Error('Impossible de charger la liste des cours')
        return r.json()
      })
      .then(data => {
        setCourses(data)
        setLoadingCourses(false)
      })
      .catch(err => {
        setErrorCourses(err.message)
        setLoadingCourses(false)
      })
  }, [])

  // 2. Liste des catégories construite automatiquement
  const categories = useMemo(() => {
    const set = new Set(courses.map(c => c.category).filter(Boolean))
    return ['Tous', ...Array.from(set).sort()]
  }, [courses])

  // 3. Filtrage des cours selon recherche + catégorie
  const debouncedGlobal = useDebounced(globalQuery, 150)
  const filteredCourses = useMemo(() => {
    const q = normalize(debouncedGlobal)
    return courses.filter(c => {
      if (activeCategory !== 'Tous' && c.category !== activeCategory) return false
      if (!q) return true
      return (
        normalize(c.title).includes(q) ||
        normalize(c.category).includes(q) ||
        normalize(c.description).includes(q) ||
        normalize(c.level).includes(q)
      )
    })
  }, [courses, debouncedGlobal, activeCategory])

  // Fonction réutilisable : charge le vocabulaire d'un cours (et met en cache).
  // Utilisée à la fois par toggleCourse et par le composant Quiz.
  const loadVocab = useCallback(async (course) => {
    if (vocabCache[course.id]) return vocabCache[course.id]
    setVocabStatus(s => ({ ...s, [course.id]: 'loading' }))
    try {
      const res = await fetch(course.vocabularyFile)
      if (!res.ok) throw new Error('Fichier vocabulaire introuvable')
      const data = await res.json()
      setVocabCache(c => ({ ...c, [course.id]: data }))
      setVocabStatus(s => ({ ...s, [course.id]: 'ok' }))
      return data
    } catch (err) {
      console.error(err)
      setVocabStatus(s => ({ ...s, [course.id]: 'error' }))
      throw err
    }
  }, [vocabCache])

  // 4. Ouvrir / fermer un tableau
  const toggleCourse = useCallback(async (course) => {
    // Refermer si déjà ouvert
    if (openCourseId === course.id) {
      setOpenCourseId(null)
      return
    }
    setOpenCourseId(course.id)
    // Déjà chargé ? on s'arrête
    if (vocabCache[course.id]) return
    try {
      await loadVocab(course)
    } catch {
      /* l'état d'erreur est déjà géré dans loadVocab */
    }
  }, [openCourseId, vocabCache, loadVocab])

  return (
    <div className="app">
      <Header
        globalQuery={globalQuery}
        setGlobalQuery={setGlobalQuery}
        totalCourses={courses.length}
        categories={categories}
        activeCategory={activeCategory}
        setActiveCategory={setActiveCategory}
      />

      <main className="container">
        {loadingCourses && <p className="info-message">Chargement des cours…</p>}
        {errorCourses && <p className="error-message">Erreur : {errorCourses}</p>}

        {!loadingCourses && !errorCourses && filteredCourses.length === 0 && (
          <p className="info-message">Aucun cours ne correspond à votre recherche.</p>
        )}

        <div className="courses-grid">
          {filteredCourses.map(course => (
            <CourseCard
              key={course.id}
              course={course}
              isOpen={openCourseId === course.id}
              onToggle={() => toggleCourse(course)}
              vocab={vocabCache[course.id]}
              status={vocabStatus[course.id]}
            />
          ))}
        </div>
      </main>

      <footer className="footer">
        <p>Bibliothèque Anki — vocabulaire arabe</p>
      </footer>

      {/* Bouton flottant et modale Quizz */}
      {!quizOpen && !loadingCourses && !errorCourses && courses.length > 0 && (
        <QuizFloatingButton onClick={() => setQuizOpen(true)} />
      )}
      {quizOpen && (
        <Quiz
          courses={courses}
          vocabCache={vocabCache}
          loadVocab={loadVocab}
          onClose={() => setQuizOpen(false)}
        />
      )}

      {/* Sélecteur de thème (flottant, haut-droite) */}
      <ThemeSwitcher />
    </div>
  )
}

function Header({ globalQuery, setGlobalQuery, totalCourses, categories, activeCategory, setActiveCategory }) {
  return (
    <header className="site-header">
      <div className="container">
        <h1 className="site-title">Bibliothèque Anki</h1>
        <p className="site-subtitle">
          Télécharge tes paquets Anki et consulte les tableaux de vocabulaire associés.
        </p>

        <div className="header-controls">
          <input
            type="search"
            className="search-input"
            placeholder="Rechercher un cours, une catégorie, un niveau…"
            value={globalQuery}
            onChange={e => setGlobalQuery(e.target.value)}
            aria-label="Recherche globale"
          />
          <span className="course-count">
            {totalCourses} cours disponible{totalCourses > 1 ? 's' : ''}
          </span>
        </div>

        <div className="category-filter" role="tablist">
          {categories.map(cat => (
            <button
              key={cat}
              className={`category-btn ${activeCategory === cat ? 'active' : ''}`}
              onClick={() => setActiveCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>
    </header>
  )
}

function CourseCard({ course, isOpen, onToggle, vocab, status }) {
  return (
    <article className="course-card">
      <header className="card-head">
        <h2 className="card-title">{course.title}</h2>
        <div className="card-meta">
          {course.category && <span className="badge badge-cat">{course.category}</span>}
          {course.level && <span className="badge badge-level">{course.level}</span>}
          {vocab && <span className="badge badge-count">{vocab.length} mots</span>}
        </div>
      </header>

      {course.description && <p className="card-desc">{course.description}</p>}

      <div className="card-actions">
        {course.ankiFiles?.map((f, i) => (
          <a key={i} href={f.file} download className="btn btn-primary">
            ⬇ {f.title}
          </a>
        ))}
        <button className="btn btn-secondary" onClick={onToggle}>
          {isOpen ? 'Masquer le tableau' : 'Voir le tableau'}
        </button>
      </div>

      {isOpen && (
        <div className="vocab-zone">
          {status === 'loading' && <p className="info-message">Chargement du vocabulaire…</p>}
          {status === 'error' && <p className="error-message">Erreur lors du chargement du vocabulaire.</p>}
          {vocab && <VocabTable vocab={vocab} />}
        </div>
      )}
    </article>
  )
}

function VocabTable({ vocab }) {
  const [query, setQuery] = useState('')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const debouncedQuery = useDebounced(query, 200)
  const [showScrollTop, setShowScrollTop] = useState(false)
  const containerRef = useRef(null)

  // Réinitialiser la pagination quand la recherche change
  useEffect(() => { setVisibleCount(PAGE_SIZE) }, [debouncedQuery])

  // Afficher le bouton dès que le haut du conteneur sort de l'écran
  useEffect(() => {
    function onScroll() {
      const container = containerRef.current
      if (!container) return
      setShowScrollTop(container.getBoundingClientRect().top < -100)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  function scrollToTop() {
    containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const filtered = useMemo(() => {
    const q = normalize(debouncedQuery)
    if (!q) return vocab
    return vocab.filter(row => {
      // Champs cherchables (on ignore les vides)
      const fields = [
        row.arabic, row.translation, row.past, row.present, row.masdar,
        row.singular, row.plural, row.synonym, row.opposite, row.harfJarr,
        row.note
      ]
      return fields.some(f => f && normalize(f).includes(q))
    })
  }, [vocab, debouncedQuery])

  const visible = filtered.slice(0, visibleCount)
  const hasMore = visibleCount < filtered.length

  return (
    <div className="vocab-container" ref={containerRef}>
      {showScrollTop && createPortal(
        <button
          className="scroll-top-btn"
          onClick={scrollToTop}
          aria-label="Remonter en haut du tableau"
          title="Remonter en haut"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="18 15 12 9 6 15"/>
          </svg>
        </button>,
        document.body
      )}
      <div className="vocab-toolbar">
        <input
          type="search"
          className="search-input small"
          placeholder="Rechercher dans ce tableau (arabe ou français)…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          aria-label="Recherche dans le tableau"
        />
        <span className="vocab-count">
          {filtered.length} mot{filtered.length > 1 ? 's' : ''}
          {filtered.length !== vocab.length && ` sur ${vocab.length}`}
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className="info-message">Aucun mot ne correspond à votre recherche.</p>
      ) : (
        <>
          {/* Vue tableau pour écrans larges */}
          <div className="table-wrapper">
            <table className="vocab-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Arabe</th>
                  <th>Traduction</th>
                  <th>Détails</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row, i) => <VocabRow key={i} row={row} />)}
              </tbody>
            </table>
          </div>

          {/* Vue cartes pour mobile */}
          <div className="vocab-cards">
            {visible.map((row, i) => <VocabMobileCard key={i} row={row} />)}
          </div>

          {hasMore && (
            <div className="load-more-zone">
              <button
                className="btn btn-secondary"
                onClick={() => setVisibleCount(c => c + PAGE_SIZE)}
              >
                Afficher {Math.min(PAGE_SIZE, filtered.length - visibleCount)} mots de plus
              </button>
              <span className="load-more-info">
                {visibleCount} / {filtered.length}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// Petit helper : renvoie une liste de paires [label, value] non vides
function detailsFor(row) {
  if (row.type === 'verbe') {
    return [
      ['Passé', row.past],
      ['Présent', row.present],
      ['Masdar', row.masdar],
      ['Harf Jarr', row.harfJarr],
    ].filter(([, v]) => v && v.trim() !== '')
  }
  // nom / adjectif
  return [
    ['Singulier', row.singular],
    ['Pluriel', row.plural],
    ['Synonyme', row.synonym],
    ['Contraire', row.opposite],
  ].filter(([, v]) => v && v.trim() !== '')
}

function VocabRow({ row }) {
  const details = detailsFor(row)
  const rowRef = useRef(null)
  return (
    <tr ref={rowRef}>
      <td><span className={`type-pill type-${row.type}`}>{row.type}</span></td>
      <td>
        <span className="arabic-with-note">
          <span className="arabic-text">{row.arabic}</span>
          <NoteBadge note={row.note} hoverTargetRef={rowRef} />
        </span>
      </td>
      <td className="translation-cell">{row.translation}</td>
      <td>
        <div className="detail-grid">
          {details.map(([label, value]) => (
            <div key={label} className="detail-item">
              <span className="detail-label">{label}</span>
              <span className={value.match(/[\u0600-\u06FF]/) ? 'arabic-text small' : 'detail-value'}>
                {value}
              </span>
            </div>
          ))}
        </div>
      </td>
    </tr>
  )
}

function VocabMobileCard({ row }) {
  const details = detailsFor(row)
  const cardRef = useRef(null)
  return (
    <div className="vocab-mobile-card" ref={cardRef}>
      <div className="vmc-head">
        <span className="arabic-with-note">
          <span className="arabic-text">{row.arabic}</span>
          <NoteBadge note={row.note} hoverTargetRef={cardRef} />
        </span>
        <span className={`type-pill type-${row.type}`}>{row.type}</span>
      </div>
      <div className="vmc-translation">{row.translation}</div>
      {details.length > 0 && (
        <div className="detail-grid">
          {details.map(([label, value]) => (
            <div key={label} className="detail-item">
              <span className="detail-label">{label}</span>
              <span className={value.match(/[\u0600-\u06FF]/) ? 'arabic-text small' : 'detail-value'}>
                {value}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
